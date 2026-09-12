import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const outDir = await mkdtemp(join(process.cwd(), '.tmp/aster-declarative-runtime-'));
try {
  const program = ts.createProgram({
    rootNames: [
      'src/core/asterCore.ts', 'src/core/declarativePlugin.ts', 'src/core/documentRepository.ts',
      'src/core/types.ts', 'src/core/aiProviders.ts', 'src/core/markdown.ts', 'src/core/relations.ts',
      'src/core/builtinScenePlugins.ts', 'src/core/overviewPlugin.ts', 'src/core/libraryPlugin.ts',
      'src/core/readerPlugin.ts', 'src/core/aiPlugin.ts', 'src/core/markdownPlugin.ts',
      'src/platform/nativeApi.ts', 'src/data/seedDocuments.ts',
    ],
    options: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      outDir,
      rootDir: 'src',
      strict: true,
      skipLibCheck: true,
      declaration: false,
      sourceMap: false,
    },
  });
  const emit = program.emit();
  const diagnostics = ts.getPreEmitDiagnostics(program).concat(emit.diagnostics);
  if (diagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => '\n',
  }));
  await patchImportsRecursively(outDir);

  const { createAsterCore } = await import(pathToFileURL(join(outDir, 'core/asterCore.js')));
  const { seedDocuments, baseScenes } = await import(pathToFileURL(join(outDir, 'data/seedDocuments.js')));
  const aster = createAsterCore(seedDocuments, baseScenes, { load: () => null, save: () => undefined });
  const manifest = {
    id: 'demo.scene.plugin',
    name: 'Demo Scene Plugin',
    version: '1.0.0',
    distribution: 'local',
    permissions: ['scenes', 'workbench', 'settings', 'resources'],
    integritySha256: 'a'.repeat(64),
    signature: 'verified-by-host',
    signer: 'test-signer',
  };
  const payload = {
    schema: 1,
    scenes: [{
      scene: { id: 'demo.scene', label: '示例场景', icon: 'D', key: 'D', sidebarMode: 'workspace' },
      view: { kind: 'declarative', title: '示例视图', blocks: [{ type: 'paragraph', text: '运行时已接入' }] },
      sidebar: { id: 'plugin:demo.scene.sidebar', renderer: { kind: 'declarative', blocks: [{ type: 'list', items: ['项目'] }] } },
      panels: [{ id: 'plugin:demo.scene.panel', area: 'right', commandId: 'demo.openPanel', titleKey: 'demo.panel', icon: 'D', order: 1, context: 'workspace', defaultOpen: true, renderer: { kind: 'declarative', blocks: [{ type: 'text', text: '面板' }] } }],
      settings: [{ id: 'demo.scene.mode', title: '显示模式', defaultValue: 'compact' }],
      resourceOpeners: [{
        id: 'plugin:demo.scene.resource',
        kind: 'demo-resource',
        title: '示例资源',
        tabKind: 'plugin:demo.scene',
        priority: 25,
        extensions: ['.demo', 'DEMO'],
        schemes: ['demo:'],
        renderer: { kind: 'declarative', title: '资源视图', blocks: [{ type: 'paragraph', text: '资源已接入' }] },
      }],
    }],
  };

  aster.registerDeclarativePlugin(manifest, payload);
  assert.equal(aster.plugins.has(manifest.id), true);
  assert.equal(aster.scenes.list().find((scene) => scene.id === 'demo.scene').defaultSidebarPanel, 'plugin:demo.scene.sidebar');
  assert.equal(aster.scenes.list().find((scene) => scene.id === 'demo.scene').sidebarMode, 'workspace');
  assert.equal(aster.sceneViews.get('demo.scene').renderer.title, '示例视图');
  assert.equal(aster.sceneSidebars.get('plugin:demo.scene.sidebar').sceneId, 'demo.scene');
  assert.equal(aster.workbenchPanels.list().find((panel) => panel.id === 'plugin:demo.scene.panel').sceneId, 'demo.scene');
  assert.equal(aster.settings.get('demo.scene.mode').sceneId, 'demo.scene');
  assert.equal(aster.resourceOpeners.get('plugin:demo.scene.resource').renderer.title, '资源视图');
  const resourceOpeners = aster.resourceOpeners.list().filter((opener) => opener.kind === 'demo-resource');
  assert.equal(resourceOpeners[0].id, 'plugin:demo.scene.resource', 'resource opener must be discoverable by kind');
  assert.deepEqual(resourceOpeners[0].extensions, ['demo'], 'resource opener extensions must be normalized');
  assert.deepEqual(resourceOpeners[0].schemes, ['demo'], 'resource opener schemes must be normalized');

  aster.setPluginEnabled(manifest.id, false);
  assert.equal(aster.scenes.list().some((scene) => scene.id === 'demo.scene'), false);
  assert.equal(aster.sceneViews.list().some((view) => view.sceneId === 'demo.scene'), false);
  assert.equal(aster.sceneSidebars.list().some((sidebar) => sidebar.sceneId === 'demo.scene'), false);
  assert.equal(aster.workbenchPanels.list().some((panel) => panel.id === 'plugin:demo.scene.panel'), false);
  assert.equal(aster.settings.has('demo.scene.mode'), false);
  assert.equal(aster.resourceOpeners.has('plugin:demo.scene.resource'), false);
  aster.setPluginEnabled(manifest.id, true);
  assert.equal(aster.scenes.list().some((scene) => scene.id === 'demo.scene'), true);
  assert.equal(aster.resourceOpeners.has('plugin:demo.scene.resource'), true);

  const updatedPayload = { ...payload, scenes: [{ ...payload.scenes[0], scene: { ...payload.scenes[0].scene, label: '更新后的示例场景' } }] };
  aster.reloadDeclarativePlugin(manifest, updatedPayload);
  assert.equal(aster.scenes.list().find((scene) => scene.id === 'demo.scene').label, '更新后的示例场景');
  assert.throws(() => aster.registerDeclarativePlugin({ ...manifest, id: 'overview.core' }, payload), /不能覆盖内置插件/);

  const brokenPayload = { schema: 1, scenes: [payload.scenes[0], payload.scenes[0]] };
  assert.throws(() => aster.reloadDeclarativePlugin(manifest, brokenPayload), /Scene already registered/);
  assert.equal(aster.plugins.has(manifest.id), true, 'failed reload must restore the old plugin');
  assert.equal(aster.scenes.list().find((scene) => scene.id === 'demo.scene').label, '更新后的示例场景');

  assert.throws(() => aster.registerDeclarativePlugin(manifest, {
    schema: 1,
    scenes: [{ scene: { id: 'invalid.scene', label: 'Invalid', icon: 'I', key: 'I', defaultSidebarPanel: 'missing' } }],
  }), /未定义的默认侧栏/);
  console.log('Declarative plugin runtime verification passed');
} finally {
  await rm(outDir, { recursive: true, force: true });
}

async function patchImportsRecursively(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      await patchImportsRecursively(filePath);
      continue;
    }
    if (!entry.name.endsWith('.js')) continue;
    const source = await readFile(filePath, 'utf8');
    await writeFile(filePath, source.replace(/from '([^']+)'/g, (match, specifier) => {
      if (!specifier.startsWith('.') || specifier.endsWith('.js')) return match;
      return `from '${specifier}.js'`;
    }));
  }
}
