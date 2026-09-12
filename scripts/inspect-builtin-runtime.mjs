import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const outDir = await mkdtemp(join(process.cwd(), '.tmp/aster-inspect-'));
try {
  const program = ts.createProgram({
    rootNames: [
      'src/core/asterCore.ts', 'src/core/documentRepository.ts', 'src/core/types.ts',
      'src/core/aiProviders.ts', 'src/core/markdown.ts', 'src/core/relations.ts',
      'src/core/builtinScenePlugins.ts', 'src/core/overviewPlugin.ts', 'src/core/libraryPlugin.ts',
      'src/core/readerPlugin.ts', 'src/core/aiPlugin.ts', 'src/core/markdownPlugin.ts',
      'src/platform/nativeApi.ts', 'src/data/seedDocuments.ts',
    ],
    options: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022, moduleResolution: ts.ModuleResolutionKind.Bundler, outDir, rootDir: 'src', strict: true, skipLibCheck: true, declaration: false },
  });
  const emit = program.emit();
  const diagnostics = ts.getPreEmitDiagnostics(program).concat(emit.diagnostics);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n' }));
  await patchImportsRecursively(outDir);
  const { createAsterCore } = await import(pathToFileURL(join(outDir, 'core/asterCore.js')));
  const { seedDocuments, baseScenes } = await import(pathToFileURL(join(outDir, 'data/seedDocuments.js')));
  const aster = createAsterCore(seedDocuments, baseScenes, { load: () => null, save: () => undefined });
  const pluginIds = [...aster.plugins.keys()];
  const sceneIds = aster.scenes.list().map(({ id }) => id);
  assert.deepEqual(pluginIds, ['overview.core', 'library.core', 'reader.core', 'ai.core', 'markdown.core']);
  assert.deepEqual(sceneIds, ['overview', 'library', 'reader', 'aiChat', 'markdown']);
  for (const scene of aster.scenes.list()) {
    assert.ok(scene.pluginId, `${scene.id} must have a plugin owner`);
    assert.equal(aster.plugins.has(scene.pluginId), true, `${scene.id} owner must be active`);
    assert.equal(aster.sceneViews.get(scene.id)?.pluginId, scene.pluginId, `${scene.id} must have an active view adapter identity`);
    if (scene.defaultSidebarPanel) {
      assert.equal(aster.sceneSidebars.get(scene.defaultSidebarPanel)?.pluginId, scene.pluginId, `${scene.id} must have an active sidebar adapter identity`);
    }
  }
  console.log(JSON.stringify({
    plugins: [...aster.plugins.keys()],
    scenes: aster.scenes.list().map(({ id, pluginId, source }) => ({ id, pluginId, source })),
    views: aster.sceneViews.list(),
    sidebars: aster.sceneSidebars.list(),
    panels: aster.workbenchPanels.list().map(({ id, sceneId, source }) => ({ id, sceneId, source })),
    openers: aster.resourceOpeners.list().map(({ id, sceneId, pluginId }) => ({ id, sceneId, pluginId })),
  }, null, 2));
} finally {
  await rm(outDir, { recursive: true, force: true });
}

async function patchImportsRecursively(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) { await patchImportsRecursively(filePath); continue; }
    if (!entry.name.endsWith('.js')) continue;
    const source = await readFile(filePath, 'utf8');
    await writeFile(filePath, source.replace(/from '([^']+)'/g, (match, specifier) => specifier.startsWith('.') && !specifier.endsWith('.js') ? `from '${specifier}.js'` : match));
  }
}
