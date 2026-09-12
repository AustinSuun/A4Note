import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

await mkdir('.tmp', { recursive: true });
const outDir = await mkdtemp(join(process.cwd(), '.tmp/aster-core-smoke-'));

try {
  const program = ts.createProgram({
    rootNames: [
      'src/core/asterCore.ts',
      'src/core/documentRepository.ts',
      'src/core/types.ts',
      'src/core/aiProviders.ts',
      'src/core/markdown.ts',
      'src/core/relations.ts',
      'src/platform/nativeApi.ts',
      'src/data/seedDocuments.ts',
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
  if (diagnostics.length) {
    const formatted = ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => '\n',
    });
    throw new Error(formatted);
  }

  await patchRelativeImports(join(outDir, 'core/asterCore.js'));
  await patchRelativeImports(join(outDir, 'core/builtinScenePlugins.js'));
  await patchRelativeImports(join(outDir, 'core/overviewPlugin.js'));
  await patchRelativeImports(join(outDir, 'core/readerPlugin.js'));
  await patchRelativeImports(join(outDir, 'core/aiPlugin.js'));
  await patchRelativeImports(join(outDir, 'core/libraryPlugin.js'));
  await patchRelativeImports(join(outDir, 'core/markdownPlugin.js'));
  await patchRelativeImports(join(outDir, 'core/aiProviders.js'));
  await patchRelativeImports(join(outDir, 'core/relations.js'));
  await patchRelativeImports(join(outDir, 'platform/nativeApi.js'));
  await patchRelativeImports(join(outDir, 'data/seedDocuments.js'));

  const core = await import(pathToFileURL(join(outDir, 'core/asterCore.js')));
  const aiProviders = await import(pathToFileURL(join(outDir, 'core/aiProviders.js')));
  const markdown = await import(pathToFileURL(join(outDir, 'core/markdown.js')));
  const relations = await import(pathToFileURL(join(outDir, 'core/relations.js')));
  const nativeApi = await import(pathToFileURL(join(outDir, 'platform/nativeApi.js')));
  const seed = await import(pathToFileURL(join(outDir, 'data/seedDocuments.js')));
  const seedSource = await readFile('src/data/seedDocuments.ts', 'utf8');
  const nativeApiSource = await readFile('src/platform/nativeApi.ts', 'utf8');
  const tauriSource = await readFile('src-tauri/src/library_import.rs', 'utf8');
  assert.doesNotMatch(seedSource, /鏂|闃|瀵|绗|€|�/);
  assert.match(nativeApiSource, /loadPaperFileBytes\(request: \{ paperId: string; kind: PaperFileKind; fileId\?: string \}/);
  assert.match(nativeApiSource, /file_id: request\.fileId \|\| null/);
  assert.match(tauriSource, /file_id: Option<String>/);
  /* Written whitespace-tolerantly on purpose: rustfmt wraps a signature this long
     over several lines, and what matters here is that the file id still travels all
     the way down to the path lookup, not how the parameters are laid out. */
  assert.match(
    tauriSource,
    /fn paper_file_path_from_database\(\s*database_path: &Path,\s*paper_id: &str,\s*kind: &str,\s*file_id: Option<&str>,?\s*\)/,
  );

  const saved = [];
  const repository = {
    load: () => null,
    save: (documents) => saved.push(JSON.parse(JSON.stringify(documents))),
  };
  const aster = core.createAsterCore(seed.seedDocuments, seed.baseScenes, repository);

  assert.deepEqual(
    aster.scenes.list().map((scene) => scene.id),
    ['overview', 'library', 'reader', 'aiChat', 'markdown'],
  );
  for (const pluginId of ['overview.core', 'library.core', 'reader.core', 'ai.core', 'markdown.core']) {
    assert.ok(aster.plugins.has(pluginId), `built-in scene plugin missing: ${pluginId}`);
  }
  assert.deepEqual(
    aster.sceneViews.list().map((view) => view.id),
    ['ai.core.view', 'library.core.view', 'markdown.core.view', 'overview.core.view', 'reader.core.view'],
    'every built-in scene must expose a live view contribution',
  );
  assert.deepEqual(
    aster.sceneSidebars.list().map((sidebar) => sidebar.id),
    ['ai.sessions', 'library.documents', 'markdown.files', 'reader.documents'],
    'every contextual scene must expose its live sidebar contribution',
  );
  assert.equal(aster.setPluginEnabled('overview.core', false), true);
  assert.equal(aster.sceneViews.list().some((view) => view.sceneId === 'overview'), false);
  assert.equal(aster.setPluginEnabled('overview.core', true), true);
  assert.equal(aster.sceneViews.list().some((view) => view.id === 'overview.core.view'), true);
  for (const scene of aster.scenes.list()) {
    assert.ok(scene.pluginId, `scene ${scene.id} must have a plugin owner`);
    assert.match(scene.source, /^plugin:/, `scene ${scene.id} must be registered through a plugin`);
  }
  assert.equal(aster.scenes.list().find((scene) => scene.id === 'reader').supportsOpenItems, true);
  for (const sceneId of ['library', 'reader', 'aiChat', 'markdown']) {
    assert.equal(aster.scenes.list().find((scene) => scene.id === sceneId).sidebarMode, 'workspace');
  }
  const emptySeedCore = core.createAsterCore([], [], repository);
  assert.deepEqual(emptySeedCore.scenes.list().map((scene) => scene.id), ['overview', 'library', 'reader', 'aiChat', 'markdown']);
  assert.equal(aster.setPluginEnabled('reader.core', false), true);
  assert.equal(aster.scenes.list().some((scene) => scene.id === 'reader'), false);
  assert.equal(aster.setPluginEnabled('reader.core', true), true);
  assert.equal(aster.scenes.list().some((scene) => scene.id === 'reader'), true);
  assert.ok(aster.plugins.has('markdown.core'));
  assert.ok(aster.commands.list().some((command) => command.id === 'document.importFromDraft'));
  assert.ok(aster.metadataSources.has('crossref'));
  assert.ok(aster.metadataSources.has('arxiv'));
  assert.ok(aster.translationSources.has('manual-pdf-binding'));
  assert.ok(aster.aiProviders.has('local-context-assistant'));
  assert.equal(aster.aiProviders.get('local-context-assistant').kind, 'local');
  assert.equal(aster.aiProviders.get('local-context-assistant').status, 'available');
  assert.equal(aster.aiProviders.get('codex-cli').status, 'planned');
  assert.equal(aster.aiProviders.get('claude-code-cli').kind, 'cli');
  const localAiResult = await aiProviders.runAiProvider({
    provider: aster.aiProviders.get('local-context-assistant'),
    paper: seed.seedDocuments[0],
    graph: relations.buildPaperKnowledgeGraph(seed.seedDocuments[0]),
    prompt: 'summary',
  });
  assert.equal(localAiResult.providerId, 'local-context-assistant');
  assert.equal(localAiResult.fallbackUsed, false);
  assert.equal(localAiResult.usedContext.paperId, seed.seedDocuments[0].paperId);
  assert.equal(localAiResult.usedContext.rootObjectId, `paper:${seed.seedDocuments[0].paperId}`);
  assert.ok(localAiResult.usedContext.objectIds.length > 1);
  assert.ok(localAiResult.usedContext.relationIds.length > 1);
  const plannedAiResult = await aiProviders.runAiProvider({
    provider: aster.aiProviders.get('codex-cli'),
    paper: seed.seedDocuments[0],
    graph: relations.buildPaperKnowledgeGraph(seed.seedDocuments[0]),
    prompt: 'summary',
  });
  assert.equal(plannedAiResult.fallbackUsed, true);
  assert.match(plannedAiResult.content, /暂时使用本地上下文助手/);
  assert.ok(aster.workbenchPanels.list().some((panel) => panel.id === 'library.details'));
  assert.ok(aster.resourceOpeners.has('library.pdf'));
  assert.ok(aster.workbenchPanels.list().some((panel) => panel.id === 'reader.annotations'));

  // Contribution ownership is enforced at the plugin context boundary. A
  // plugin may only register identities that it can later dispose itself;
  // otherwise disabling one plugin could leave another plugin's UI alive.
  const ownershipPlugin = aster.registerPlugin({
    id: 'owner-boundary',
    name: 'Owner Boundary Plugin',
    manifest: {
      id: 'owner-boundary',
      name: 'Owner Boundary Plugin',
      version: '1.0.0',
      distribution: 'builtin',
      permissions: ['scenes', 'resources', 'settings', 'workbench'],
    },
    activate: (context) => {
      assert.throws(() => context.scenes.register({ id: 'owner-boundary.invalid-scene', label: 'Invalid', icon: '!', key: 'x', pluginId: 'another.plugin' }), /cannot register scene owned by another\.plugin/);
      context.scenes.register({ id: 'owner-boundary.scene', label: 'Boundary', icon: 'B', key: '9', pluginId: 'owner-boundary' });
      assert.throws(() => context.sceneViews.register({ id: 'owner-boundary.invalid-view', sceneId: 'owner-boundary.scene', pluginId: 'another.plugin' }), /cannot register scene view owned by another\.plugin/);
      context.sceneViews.register({ id: 'owner-boundary.view', sceneId: 'owner-boundary.scene', pluginId: 'owner-boundary' });
      assert.throws(() => context.sceneSidebars.register({ id: 'owner-boundary.invalid-sidebar', sceneId: 'owner-boundary.scene', pluginId: 'another.plugin' }), /cannot register scene sidebar owned by another\.plugin/);
      context.sceneSidebars.register({ id: 'owner-boundary.sidebar', sceneId: 'owner-boundary.scene', pluginId: 'owner-boundary' });
      assert.throws(() => context.settings.register({ id: 'owner-boundary.invalid-setting', title: 'Invalid', defaultValue: false, pluginId: 'another.plugin' }), /cannot register setting owned by another\.plugin/);
      context.settings.register({ id: 'owner-boundary.setting', title: 'Boundary', defaultValue: true, pluginId: 'owner-boundary' });
      assert.throws(() => context.workbenchPanels.register({ id: 'plugin:owner-boundary.invalid-panel', sceneId: 'owner-boundary.scene', area: 'right', commandId: 'owner-boundary.invalid', titleKey: 'invalid', icon: 'x', order: 1, source: 'plugin:another.plugin', context: 'global' }), /cannot register workbench panel owned by plugin:another\.plugin/);
      context.workbenchPanels.register({ id: 'plugin:owner-boundary.panel', sceneId: 'owner-boundary.scene', area: 'right', commandId: 'owner-boundary.open', titleKey: 'boundary', icon: 'B', order: 1, source: 'plugin:owner-boundary', context: 'global' });
      assert.throws(() => context.resourceOpeners.register({ id: 'owner-boundary.invalid-opener', kind: 'boundary', title: 'Invalid', pluginId: 'another.plugin' }), /cannot register resource opener owned by another\.plugin/);
      context.resourceOpeners.register({ id: 'owner-boundary.opener', kind: 'boundary', title: 'Boundary', pluginId: 'owner-boundary' });
    },
  });
  assert.ok(aster.scenes.list().some((scene) => scene.id === 'owner-boundary.scene'));
  assert.equal(aster.sceneViews.get('owner-boundary.scene')?.pluginId, 'owner-boundary');
  assert.equal(aster.sceneSidebars.get('owner-boundary.sidebar')?.pluginId, 'owner-boundary');
  assert.equal(aster.settings.get('owner-boundary.setting')?.pluginId, 'owner-boundary');
  assert.ok(aster.workbenchPanels.list().some((panel) => panel.id === 'plugin:owner-boundary.panel'));
  assert.equal(aster.resourceOpeners.get('owner-boundary.opener')?.pluginId, 'owner-boundary');
  ownershipPlugin.dispose();
  assert.equal(aster.scenes.list().some((scene) => scene.id === 'owner-boundary.scene'), false);
  assert.equal(aster.sceneViews.get('owner-boundary.scene'), undefined);
  assert.equal(aster.sceneSidebars.get('owner-boundary.sidebar'), undefined);
  assert.equal(aster.settings.get('owner-boundary.setting'), undefined);
  assert.equal(aster.workbenchPanels.list().some((panel) => panel.id === 'plugin:owner-boundary.panel'), false);
  assert.equal(aster.resourceOpeners.get('owner-boundary.opener'), undefined);

  let observedImport = null;
  const plugin = aster.registerPlugin({
    id: 'sample.local-plugin',
    name: 'Sample Local Plugin',
    manifest: { id: 'sample.local-plugin', name: 'Sample Local Plugin', version: '1.0.0', distribution: 'builtin', permissions: ['commands', 'events', 'settings', 'workbench', 'providers'] },
    activate: (context) => {
      assert.ok(context.permissions.has('commands'));
      assert.equal(context.permissions.has('resources'), false);
      context.settings.set('sample.enabled', {
        id: 'sample.enabled',
        title: 'Sample plugin enabled',
        defaultValue: true,
      });
      context.metadataSources.set('sample-metadata', {
        id: 'sample-metadata',
        name: 'Sample Metadata Source',
        enabledByDefault: false,
      });
      context.translationSources.set('sample-translation', {
        id: 'sample-translation',
        name: 'Sample Translation Source',
        enabledByDefault: false,
      });
      context.aiProviders.set('sample-ai', {
        id: 'sample-ai',
        name: 'Sample AI Provider',
        kind: 'api',
        status: 'planned',
      });
      context.commands.register({
        id: 'sample.echo',
        title: 'Echo from sample plugin',
        run: (payload) => `echo:${payload.text}`,
      });
      context.commands.register({
        id: 'sample.paletteCommand',
        title: 'Sample palette command',
        group: 'Sample Plugin',
        visibleInPalette: true,
        run: () => 'palette-ok',
      });
      context.workbenchPanels.register({
        id: 'plugin:sample.local-plugin.context',
        sceneId: 'reader',
        area: 'right',
        commandId: 'sample.openContextPanel',
        titleKey: 'sample.contextPanel',
        icon: 'plugin',
        order: 90,
        source: 'plugin:sample.local-plugin',
        context: 'paper',
      });
      context.events.on('document.imported', (paper) => {
        observedImport = paper.paperId;
      });
    },
  });

  assert.equal(plugin.id, 'sample.local-plugin');
  assert.ok(aster.plugins.has('sample.local-plugin'));
  assert.equal(aster.settings.get('sample.enabled').defaultValue, true);
  assert.ok(aster.metadataSources.has('sample-metadata'));
  assert.ok(aster.translationSources.has('sample-translation'));
  assert.ok(aster.aiProviders.has('sample-ai'));
  assert.equal(aster.commands.execute('sample.echo', { text: 'ok' }), 'echo:ok');
  const paletteCommand = aster.commands.list().find((command) => command.id === 'sample.paletteCommand');
  assert.equal(paletteCommand.visibleInPalette, true);
  assert.equal(paletteCommand.source, 'plugin:sample.local-plugin');
  assert.equal(aster.commands.execute('sample.paletteCommand'), 'palette-ok');
  assert.ok(aster.workbenchPanels.list().some((panel) => panel.id === 'plugin:sample.local-plugin.context'));

  assert.throws(() => aster.registerPlugin({
    id: 'invalid.manifest',
    name: 'Invalid Manifest',
    manifest: { id: 'invalid.manifest', name: 'Invalid Manifest', version: 'development', distribution: 'builtin', permissions: [] },
    activate: () => undefined,
  }), /Invalid plugin version/);

  assert.throws(() => aster.registerPlugin({
    id: 'failing.plugin',
    name: 'Failing Plugin',
    manifest: { id: 'failing.plugin', name: 'Failing Plugin', version: '1.0.0', distribution: 'builtin', permissions: ['commands'] },
    activate: (context) => {
      context.commands.register({ id: 'failing.command', title: 'Temporary', run: () => null });
      throw new Error('activation failed');
    },
  }), /activation failed/);
  assert.equal(aster.plugins.has('failing.plugin'), false);
  assert.equal(aster.commands.list().some((command) => command.id === 'failing.command'), false);

  const draft = core.createImportDraft(String.raw`D:\papers\Aster E2E Sample Paper 2026.pdf`);
  assert.equal(draft.title, 'Aster E2E Sample Paper 2026');
  assert.equal(draft.year, 2026);
  assert.equal(draft.originalPath, String.raw`D:\papers\Aster E2E Sample Paper 2026.pdf`);

  const imported = aster.commands.execute('document.importFromDraft', {
    ...draft,
    doi: '10.1234/aster.smoke',
    tags: [],
    sourceFileId: 'file-smoke',
    libraryPath: 'AsterData/files/papers/paper-smoke/source.pdf',
  });
  assert.equal(imported.sourceFileId, 'file-smoke');
  assert.equal(imported.sourcePdf, 'AsterData/files/papers/paper-smoke/source.pdf');
  assert.deepEqual(imported.tags, ['未分类']);
  assert.equal(observedImport, imported.paperId);
  assert.equal(aster.documents.search('10.1234/aster.smoke')[0].paperId, imported.paperId);
  assert.equal(aster.documents.search('2026')[0].paperId, imported.paperId);

  const taggedImport = aster.commands.execute('document.importFromDraft', {
    ...draft,
    title: 'Tagged Smoke Paper',
    tags: ['  AI  ', '', 'ai', '阅读', '未分类', 'AI'],
    sourceFileId: 'file-tagged-smoke',
    libraryPath: 'AsterData/files/papers/paper-tagged-smoke/source.pdf',
  });
  assert.deepEqual(taggedImport.tags, ['AI', '阅读']);

  const noteDocument = aster.commands.execute('document.updatePrimaryNote', {
    paperId: imported.paperId,
    content: '# Smoke note\n\n- live preview\n- bound to paper',
  });
  assert.equal(noteDocument.notes[0].paperId, imported.paperId);
  assert.equal(noteDocument.notes[0].format, 'markdown');

  const firstNoteId = noteDocument.notes[0].id;
  const secondNote = aster.commands.execute('document.upsertNote', {
    paperId: imported.paperId,
    title: 'Second reading note',
    content: '# Second note',
  });
  assert.ok(secondNote.id !== firstNoteId);
  assert.equal(aster.documents.get(imported.paperId).notes.length, 2);
  const updatedFirstNote = aster.commands.execute('document.upsertNote', {
    paperId: imported.paperId,
    noteId: firstNoteId,
    title: 'Updated primary note',
    content: '# Updated first note',
  });
  assert.equal(updatedFirstNote.id, firstNoteId);
  assert.equal(aster.documents.get(imported.paperId).notes.find((note) => note.id === secondNote.id).content, '# Second note');
  assert.equal(aster.documents.get(imported.paperId).notes.find((note) => note.id === firstNoteId).content, '# Updated first note');

  const fixedNote = aster.commands.execute('document.upsertNote', {
    paperId: imported.paperId, noteId: 'note-fixed-from-native', title: '  exact title  ', content: 'fixed identity',
  });
  assert.equal(fixedNote.id, 'note-fixed-from-native');
  assert.equal(fixedNote.title, '  exact title  ');
  aster.commands.execute('document.upsertNote', { paperId: imported.paperId, noteId: fixedNote.id, title: fixedNote.title, content: 'second write' });
  assert.equal(aster.documents.get(imported.paperId).notes.filter((note) => note.id === fixedNote.id).length, 1);

  const annotation = aster.commands.execute('document.addAnnotation', {
    paperId: imported.paperId,
    annotation: {
      type: 'highlight',
      color: 'yellow',
      quote: 'quoted',
      comment: '',
      positionJson: { x: 10, y: 20, width: 30, height: 4 },
    },
  });
  assert.equal(annotation.paperId, imported.paperId);
  assert.equal(annotation.fileId, aster.documents.get(imported.paperId).sourceFileId);
  assert.deepEqual(annotation.positionJson, { x: 10, y: 20, width: 30, height: 4 });

  const graphPaper = aster.documents.get(imported.paperId);
  const graph = relations.buildPaperKnowledgeGraph(graphPaper);
  assert.equal(graph.rootObjectId, `paper:${imported.paperId}`);
  assert.ok(graph.objects.some((object) => object.type === 'paper' && object.id === graph.rootObjectId));
  assert.ok(graph.objects.some((object) => object.type === 'pdf_file' && object.metadata.fileKind === 'source'));
  assert.ok(graph.objects.some((object) => object.type === 'note'));
  assert.ok(graph.objects.some((object) => object.type === 'annotation'));
  assert.ok(graph.relations.some((relation) => relation.type === 'attached_file'));
  assert.ok(graph.relations.some((relation) => relation.type === 'has_note'));
  assert.ok(graph.relations.some((relation) => relation.type === 'annotates' && relation.metadata.page === 1));
  const aiContextGraph = relations.buildPaperKnowledgeGraph(graphPaper, {
    aiThreadContexts: [
      {
        threadId: 'thread-context-smoke',
        providerId: 'local-context-assistant',
        prompt: 'explain context',
        objectIds: [graph.rootObjectId, `annotation:${annotation.id}`],
        relationIds: graph.relations.map((relation) => relation.id),
      },
    ],
  });
  assert.ok(aiContextGraph.objects.some((object) => object.id === 'ai_thread:thread-context-smoke'));
  assert.ok(aiContextGraph.relations.some((relation) => relation.type === 'discusses' && relation.sourceObjectId === 'ai_thread:thread-context-smoke'));
  assert.ok(aiContextGraph.relations.some((relation) => relation.type === 'generated_from' && relation.targetObjectId === `annotation:${annotation.id}`));
  const graphIndex = relations.createKnowledgeGraphIndex(graph);
  assert.equal(relations.getObject(graphIndex, graph.rootObjectId).title, graphPaper.title);
  const relatedFiles = relations.getRelatedObjects(graphIndex, graph.rootObjectId, {
    direction: 'source',
    types: ['attached_file'],
    objectTypes: ['pdf_file'],
  });
  assert.equal(relatedFiles.length, 1);
  assert.equal(relatedFiles[0].object.metadata.originalId, aster.documents.get(imported.paperId).sourceFileId);
  const relatedNotes = relations.getRelatedObjects(graphIndex, graph.rootObjectId, {
    direction: 'source',
    types: ['has_note'],
    objectTypes: ['note'],
  });
  assert.equal(relatedNotes.length, graphPaper.notes.length);
  assert.deepEqual(
    new Set(relatedNotes.map((item) => item.object.metadata.originalId)),
    new Set(graphPaper.notes.map((note) => note.id)),
  );
  const relatedAnnotations = relations.getRelatedObjects(graphIndex, `pdf_file:${annotation.fileId}`, {
    direction: 'target',
    types: ['annotates'],
    objectTypes: ['annotation'],
  });
  assert.equal(relatedAnnotations[0].object.metadata.originalId, annotation.id);
  const graphRelations = relations.getGraphRelations(graphIndex, { excludeTypes: ['tagged_with'] });
  assert.ok(graphRelations.every((relation) => relation.type !== 'tagged_with'));
  const trace = relations.getAnnotationTrace(graphIndex, `annotation:${annotation.id}`);
  assert.equal(trace.annotation.metadata.originalId, annotation.id);
  assert.equal(trace.sourceFile.metadata.originalId, annotation.fileId);
  assert.equal(trace.page, annotation.page);
  assert.equal(trace.noteLinks.length, 1);
  const relationView = relations.buildPaperRelationView(graphPaper, { currentFileId: annotation.fileId });
  assert.equal(relationView.files.length, 1);
  assert.equal(relationView.notes.length, graphPaper.notes.length);
  assert.equal(relationView.currentFileAnnotations[0].annotation.metadata.originalId, annotation.id);
  assert.ok(relationView.previewRelations.some((item) => item.relation.type === 'annotates' && item.annotationTrace?.page === annotation.page));
  assert.deepEqual(relations.getObjectNavigationTarget(relationView.files[0].object), {
    kind: 'pdf_file',
    fileId: aster.documents.get(imported.paperId).sourceFileId,
    fileKind: 'source',
  });
  assert.deepEqual(relations.getObjectNavigationTarget(relationView.notes[0].object), {
    kind: 'note',
    paperId: imported.paperId,
    noteId: graphPaper.notes[0].id,
  });
  assert.deepEqual(relations.getObjectNavigationTarget(relationView.currentFileAnnotations[0].annotation), {
    kind: 'annotation',
    paperId: imported.paperId,
    annotationId: annotation.id,
    fileId: annotation.fileId,
    page: annotation.page,
  });

  const html = markdown.renderMarkdown('# Title\n\n- item <safe>');
  assert.match(html, /<h3>Title<\/h3>/);
  assert.match(html, /&lt;safe&gt;/);
  assert.match(html, /<ul><li>item &lt;safe&gt;<\/li><\/ul>/);
  assert.ok(saved.length >= 3, 'repository should persist import, note, and annotation updates');

  const nativeDocument = nativeApi.nativePaperToDocument({
    paper_id: 'paper-native',
    title: 'Native Paper',
    authors: 'Native Author',
    year: 2026,
    venue: 'Native Venue',
    doi: '',
    source_file_id: 'file-source',
    source_pdf: 'AsterData/files/papers/paper-native/source.pdf',
    translated_pdfs: ['AsterData/files/papers/paper-native/translated.zh.pdf'],
    tags: [],
    notes: [],
    annotations: [],
    ai_threads: [],
  });
  assert.equal(nativeDocument.translatedPdfs[0], 'AsterData/files/papers/paper-native/translated.zh.pdf');
  assert.equal(nativeDocument.tags[0], '未分类');
  const nativeImportRequest = nativeApi.createImportPdfRequest({ ...draft, tags: [] }, 'paper-native-import');
  assert.deepEqual(nativeImportRequest.tags, []);
  assert.equal(nativeImportRequest.paper_id, 'paper-native-import');

  plugin.dispose();
  assert.equal(aster.plugins.has('sample.local-plugin'), false);
  assert.equal(aster.commands.list().some((command) => command.id === 'sample.echo'), false);
  assert.equal(aster.commands.list().some((command) => command.id === 'sample.paletteCommand'), false);
  assert.equal(aster.workbenchPanels.list().some((panel) => panel.id === 'plugin:sample.local-plugin.context'), false);
  assert.equal(aster.metadataSources.has('sample-metadata'), false);
  assert.equal(aster.translationSources.has('sample-translation'), false);
  assert.equal(aster.aiProviders.has('sample-ai'), false);
  assert.ok(aster.metadataSources.has('crossref'), 'core metadata sources must survive plugin disposal');
  assert.ok(aster.translationSources.has('manual-pdf-binding'), 'core translation sources must survive plugin disposal');
  assert.ok(aster.aiProviders.has('local-context-assistant'), 'core AI providers must survive plugin disposal');

  assert.equal(aster.setPluginEnabled('sample.local-plugin', true), true);
  assert.ok(aster.metadataSources.has('sample-metadata'));
  assert.ok(aster.translationSources.has('sample-translation'));
  assert.ok(aster.aiProviders.has('sample-ai'));
  assert.equal(aster.setPluginEnabled('sample.local-plugin', false), true);
  assert.equal(aster.metadataSources.has('sample-metadata'), false);
  assert.equal(aster.translationSources.has('sample-translation'), false);
  assert.equal(aster.aiProviders.has('sample-ai'), false);

  const statePaper = aster.documents.list()[0];
  if (statePaper) {
    const notesBeforeState = statePaper.notes;
    const titleBeforeState = statePaper.title;
    const result = aster.documents.updateState(statePaper.paperId, { isRead: true, isFavorite: true, lastViewedAt: '2026-09-09T00:00:00.000Z' });
    assert.equal(result.isRead, true); assert.equal(result.isFavorite, true);
    assert.equal(result.notes, notesBeforeState); assert.equal(result.title, titleBeforeState);
    assert.equal(aster.documents.updateState('absent-paper-for-state', { isRead: false }), null);
  }
  console.log('Aster core smoke verification passed');
} finally {
  await rm(outDir, { recursive: true, force: true });
}

async function patchRelativeImports(filePath) {
  const source = await readFile(filePath, 'utf8');
  const patched = source.replace(/from '([^']+)'/g, (match, specifier) => {
    if (!specifier.startsWith('.') || specifier.endsWith('.js')) return match;
    return `from '${specifier}.js'`;
  });
  await writeFile(filePath, patched);
}
