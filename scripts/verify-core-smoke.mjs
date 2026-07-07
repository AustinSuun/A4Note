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
  const tauriSource = await readFile('src-tauri/src/lib.rs', 'utf8');
  assert.doesNotMatch(seedSource, /鏂|闃|瀵|绗|€|�/);
  assert.match(nativeApiSource, /loadPaperFileBytes\(request: \{ paperId: string; kind: PaperFileKind; fileId\?: string \}/);
  assert.match(nativeApiSource, /file_id: request\.fileId \|\| null/);
  assert.match(tauriSource, /file_id: Option<String>/);
  assert.match(tauriSource, /paper_file_path_from_database\(database_path: &Path, paper_id: &str, kind: &str, file_id: Option<&str>\)/);

  const saved = [];
  const repository = {
    load: () => null,
    save: (documents) => saved.push(JSON.parse(JSON.stringify(documents))),
  };
  const aster = core.createAsterCore(seed.seedDocuments, seed.baseScenes, repository);

  assert.deepEqual(
    aster.scenes.list().map((scene) => scene.id),
    ['library', 'reader', 'aiChat'],
  );
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
  assert.ok(aster.workbenchPanels.list().some((panel) => panel.id === 'reader.annotations'));

  let observedImport = null;
  const plugin = aster.registerPlugin({
    id: 'sample.local-plugin',
    name: 'Sample Local Plugin',
    activate: (context) => {
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
  assert.ok(aster.aiProviders.has('sample-ai'));
  assert.equal(aster.commands.execute('sample.echo', { text: 'ok' }), 'echo:ok');
  const paletteCommand = aster.commands.list().find((command) => command.id === 'sample.paletteCommand');
  assert.equal(paletteCommand.visibleInPalette, true);
  assert.equal(paletteCommand.source, 'plugin:sample.local-plugin');
  assert.equal(aster.commands.execute('sample.paletteCommand'), 'palette-ok');
  assert.ok(aster.workbenchPanels.list().some((panel) => panel.id === 'plugin:sample.local-plugin.context'));

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
  assert.equal(relatedNotes.length, 1);
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
  assert.equal(relationView.notes.length, 1);
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
