import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const outDir = await mkdtemp(join(process.cwd(), '.tmp/aster-resource-views-'));
try {
  const program = ts.createProgram({
    rootNames: ['src/workbench/resourceViews.tsx', 'src/core/types.ts', 'src/core/workspace.ts'],
    options: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.ReactJSX,
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

  const { createResourceViewRegistry, resolveResourceViewContributions } = await import(pathToFileURL(join(outDir, 'workbench/resourceViews.js')));
  const active = new Set(['reader.core', 'demo.plugin']);
  const isActive = (pluginId) => active.has(pluginId);
  const renderDeclarative = (renderer) => ({ renderer });
  const tab = { id: 'tab-1', key: 'resource:test', kind: 'pdf', title: 'Test', state: {} };

  const builtinOpener = { id: 'reader.pdf', kind: 'pdf', title: 'PDF', sceneId: 'reader', pluginId: 'reader.core' };
  const trustedView = { id: 'reader.pdf.view', openerId: 'reader.pdf', pluginId: 'reader.core', render: () => 'trusted-adapter' };
  const builtinResolution = resolveResourceViewContributions([builtinOpener], [trustedView], isActive, renderDeclarative);
  assert.deepEqual(builtinResolution.views, [trustedView], 'built-in opener must bind its trusted adapter');
  assert.equal(builtinResolution.missingResourceViewIds.length, 0);
  assert.equal(builtinResolution.views[0].render({ opener: builtinOpener, tab, sceneId: 'reader' }), 'trusted-adapter');

  const declarativeRenderer = { kind: 'declarative', title: 'Demo resource', blocks: [{ type: 'paragraph', text: 'Connected' }] };
  const declarativeOpener = { id: 'plugin:demo.resource', kind: 'demo-resource', title: 'Demo', sceneId: 'demo', pluginId: 'demo.plugin', renderer: declarativeRenderer };
  const declarativeResolution = resolveResourceViewContributions([declarativeOpener], [], isActive, renderDeclarative);
  assert.equal(declarativeResolution.views[0].openerId, declarativeOpener.id);
  assert.equal(declarativeResolution.views[0].pluginId, declarativeOpener.pluginId);
  assert.deepEqual(declarativeResolution.views[0].render({ opener: declarativeOpener, tab, sceneId: 'demo' }), { renderer: declarativeRenderer }, 'declarative opener must receive a host renderer');

  active.delete('demo.plugin');
  const disabledResolution = resolveResourceViewContributions([declarativeOpener], [trustedView], isActive, renderDeclarative);
  assert.deepEqual(disabledResolution.views, [], 'disabled plugin must not expose a resource view');
  assert.deepEqual(disabledResolution.missingResourceViewIds, [declarativeOpener.id]);
  assert.deepEqual(disabledResolution.diagnostics, [], 'disabled contributions should not report active-host diagnostics');

  active.add('demo.plugin');
  const missingOpener = { id: 'plugin:demo.missing', kind: 'demo-missing', title: 'Missing', pluginId: 'demo.plugin' };
  const missingResolution = resolveResourceViewContributions([missingOpener], [], isActive, renderDeclarative);
  assert.match(missingResolution.diagnostics[0], /plugin:demo\.missing/);

  const registry = createResourceViewRegistry();
  const dispose = registry.register(trustedView);
  assert.equal(registry.get('reader.pdf'), trustedView);
  assert.throws(() => registry.register({ ...trustedView, id: 'reader.pdf.other' }), /already registered for opener/);
  dispose();
  assert.equal(registry.get('reader.pdf'), undefined, 'disposing a view must release its opener claim');

  console.log('Resource view verification passed');
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
