import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const requiredFiles = [
  'src/features/library/index.ts',
  'src/features/library/LibraryScene.tsx',
  'src/features/library/LibraryDetailPanel.tsx',
  'src/features/library/ImportDialog.tsx',
  'src/features/library/TagInput.tsx',
  'src/features/library/useImportFlow.ts',
  'src/features/library/types.ts',
  'src/features/reader/index.ts',
  'src/features/reader/ReaderScene.tsx',
  'src/features/reader/pdf/PdfReader.tsx',
  'src/features/reader/pdf/PdfPageView.tsx',
  'src/features/reader/pdf/PdfTextLayer.tsx',
  'src/features/reader/pdf/AnnotationOverlay.tsx',
  'src/features/reader/pdf/AnnotationMark.tsx',
  'src/features/reader/pdf/types.ts',
  'src/features/reader/pdf/pdfGeometry.ts',
  'src/features/reader/pdf/pdfSelection.ts',
  'src/features/reader/pdf/pdfAnnotationHelpers.ts',
  'src/features/reader/pdf/pdfInteraction.ts',
  'src/features/reader/types.ts',
  'src/features/reader/readerHelpers.ts',
  'src/features/reader/readerConstants.ts',
  'src/features/reader/useAnnotationHistory.ts',
  'src/features/reader/ReaderToolbar.tsx',
  'src/features/reader/ReaderDocumentPane.tsx',
  'src/features/reader/ReaderSideDrawer.tsx',
  'src/features/reader/ReaderSidePanelContent.tsx',
  'src/features/reader/ReaderMarkdown.tsx',
  'src/features/reader/AnnotationListPanel.tsx',
  'src/features/reader/ReaderChatPanel.tsx',
  'src/features/reader/RelationPanel.tsx',
  'src/features/reader/ReaderIcons.tsx',
  'src/features/ai/index.ts',
  'src/features/ai/AIChatScene.tsx',
  'src/features/ai/useChatThreads.ts',
  'src/features/settings/index.tsx',
  'src/features/relations/index.ts',
  'src/features/explorer/index.ts',
  'src/features/explorer/FileTreePanel.tsx',
  'src/features/explorer/FileTab.tsx',
  'src/features/agents/index.ts',
  'src/features/agents/AgentSessionPanel.tsx',
  'src/features/agents/useAgentProviders.ts',
  'src/features/agents/useAgentSession.ts',
  'src/workbench/index.ts',
  'src/workbench/CommandPalette.tsx',
  'src/workbench/WorkspacePanelHost.tsx',
  'src/workbench/WorkbenchShell.tsx',
  'src/workbench/ProjectSidebar.tsx',
  'src/workbench/WorkbenchTopBar.tsx',
  'src/workbench/TabStrip.tsx',
  'src/workbench/TabHost.tsx',
  'src/workbench/workbenchLabels.ts',
  'src/workbench/workspaceStore.ts',
  'src/workbench/useWorkbench.ts',
  'src/workbench/sceneViews.tsx',
  'src/core/builtinScenePlugins.ts',
  'src/core/overviewPlugin.ts',
  'src/core/readerPlugin.ts',
  'src/core/aiPlugin.ts',
  'src/core/libraryPlugin.ts',
  'src/core/markdownPlugin.ts',
  'src/core/workspace.ts',
  'src/core/resources.ts',
  'src/core/agentProtocol.ts',
  'src/core/agentHistory.ts',
  'src-tauri/src/agent_cli/mod.rs',
  'src-tauri/src/agent_cli/protocol.rs',
  'src-tauri/src/agent_cli/transport.rs',
  'src-tauri/src/agent_cli/peer.rs',
  'src-tauri/src/agent_cli/turn.rs',
  'src-tauri/src/agent_cli/launch.rs',
  'src-tauri/src/agent_cli/process.rs',
  'src-tauri/src/agent_cli/supervisor.rs',
  'src-tauri/src/agent_cli/providers/mod.rs',
  'src-tauri/src/agent_cli/providers/codex.rs',
  'src-tauri/src/agent_bridge.rs',
  'src/shared/ui/index.ts',
  'src/shared/ui/Button.tsx',
  'src/shared/ui/Panel.tsx',
  'src/shared/hooks/index.ts',
  'src/shared/hooks/usePersistedUiState.ts',
  'src/shared/utils/index.ts',
  'src/ui/styles.css',
  'src/ui/styles/tokens.css',
  'src/ui/styles/base.css',
  'src/ui/styles/layout.css',
  'src/ui/styles/components.css',
  'src/ui/styles/library.css',
  'src/ui/styles/reader.css',
  'src/ui/styles/workbench.css',
  'src/ui/styles/markdown.css',
  'src/shared/markdown/index.ts',
  'src/shared/markdown/MarkdownCallout.tsx',
  'src/shared/markdown/MarkdownCodeBlock.tsx',
  'src/shared/markdown/MarkdownFigure.tsx',
  'src/shared/markdown/MarkdownFootnote.tsx',
  'src/shared/markdown/highlight.tsx',
  'src/shared/markdown/remarkAsterInline.ts',
  'src/platform/nativeApi.ts',
  'src/platform/workbench/index.ts',
  'src/platform/workbench/workbenchStorageApi.ts',
  'src/platform/agentCli/index.ts',
  'src/platform/agentCli/detectAgentCli.ts',
  'src/platform/agentCli/agentSession.ts',
  'src/platform/agentCli/agentHistory.ts',
  'src-tauri/src/agent_history.rs',
];

for (const file of requiredFiles) {
  await access(file);
}

const appSource = await readFile('src/ui/App.tsx', 'utf8');
const libraryIndexSource = await readFile('src/features/library/index.ts', 'utf8');
const librarySceneSource = await readFile('src/features/library/LibraryScene.tsx', 'utf8');
const libraryDetailPanelSource = await readFile('src/features/library/LibraryDetailPanel.tsx', 'utf8');
const sceneAdaptersSource = await readFile('src/ui/sceneAdapters.tsx', 'utf8');
const importDialogSource = await readFile('src/features/library/ImportDialog.tsx', 'utf8');
const tagInputSource = await readFile('src/features/library/TagInput.tsx', 'utf8');
const libraryTypesSource = await readFile('src/features/library/types.ts', 'utf8');
const readerIndexSource = await readFile('src/features/reader/index.ts', 'utf8');
const readerSceneSource = await readFile('src/features/reader/ReaderScene.tsx', 'utf8');
const readerTypesSource = await readFile('src/features/reader/types.ts', 'utf8');
const readerHelpersSource = await readFile('src/features/reader/readerHelpers.ts', 'utf8');
const readerConstantsSource = await readFile('src/features/reader/readerConstants.ts', 'utf8');
const readerToolbarSource = await readFile('src/features/reader/ReaderToolbar.tsx', 'utf8');
const readerDocumentPaneSource = await readFile('src/features/reader/ReaderDocumentPane.tsx', 'utf8');
const readerPdfSource = await readFile('src/features/reader/pdf/PdfReader.tsx', 'utf8');
const readerPdfPageViewSource = await readFile('src/features/reader/pdf/PdfPageView.tsx', 'utf8');
const readerPdfTextLayerSource = await readFile('src/features/reader/pdf/PdfTextLayer.tsx', 'utf8');
const readerPdfAnnotationOverlaySource = await readFile('src/features/reader/pdf/AnnotationOverlay.tsx', 'utf8');
const readerPdfAnnotationMarkSource = await readFile('src/features/reader/pdf/AnnotationMark.tsx', 'utf8');
const readerPdfTypesSource = await readFile('src/features/reader/pdf/types.ts', 'utf8');
const readerPdfGeometrySource = await readFile('src/features/reader/pdf/pdfGeometry.ts', 'utf8');
const readerPdfSelectionSource = await readFile('src/features/reader/pdf/pdfSelection.ts', 'utf8');
const readerPdfAnnotationHelpersSource = await readFile('src/features/reader/pdf/pdfAnnotationHelpers.ts', 'utf8');
const readerPdfInteractionSource = await readFile('src/features/reader/pdf/pdfInteraction.ts', 'utf8');
const readerSideDrawerSource = await readFile('src/features/reader/ReaderSideDrawer.tsx', 'utf8');
const readerSidePanelContentSource = await readFile('src/features/reader/ReaderSidePanelContent.tsx', 'utf8');
const readerMarkdownSource = await readFile('src/features/reader/ReaderMarkdown.tsx', 'utf8');
const markdownReadContentSource = await readFile('src/features/reader/MarkdownReadContent.tsx', 'utf8');
const markdownResourceTabSource = await readFile('src/features/explorer/MarkdownResourceTab.tsx', 'utf8');
const markdownLivePreviewEditorSource = await readFile('src/features/explorer/MarkdownLivePreviewEditor.tsx', 'utf8');
const sharedMarkdownIndexSource = await readFile('src/shared/markdown/index.ts', 'utf8');
const markdownCalloutSource = await readFile('src/shared/markdown/MarkdownCallout.tsx', 'utf8');
const markdownCodeBlockSource = await readFile('src/shared/markdown/MarkdownCodeBlock.tsx', 'utf8');
const markdownFigureSource = await readFile('src/shared/markdown/MarkdownFigure.tsx', 'utf8');
const markdownFootnoteSource = await readFile('src/shared/markdown/MarkdownFootnote.tsx', 'utf8');
const markdownHighlightSource = await readFile('src/shared/markdown/highlight.tsx', 'utf8');
const markdownInlineSource = await readFile('src/shared/markdown/remarkAsterInline.ts', 'utf8');
const markdownWorkspaceSceneSource = await readFile('src/features/markdown/MarkdownWorkspaceScene.tsx', 'utf8');
const packageJsonSource = await readFile('package.json', 'utf8');
const annotationListPanelSource = await readFile('src/features/reader/AnnotationListPanel.tsx', 'utf8');
const readerChatPanelSource = await readFile('src/features/reader/ReaderChatPanel.tsx', 'utf8');
const relationPanelSource = await readFile('src/features/reader/RelationPanel.tsx', 'utf8');
const readerIconsSource = await readFile('src/features/reader/ReaderIcons.tsx', 'utf8');
const aiIndexSource = await readFile('src/features/ai/index.ts', 'utf8');
const aiSceneSource = await readFile('src/features/ai/AIChatScene.tsx', 'utf8');
const sharedHooksIndexSource = await readFile('src/shared/hooks/index.ts', 'utf8');
const settingsSource = await readFile('src/features/settings/index.tsx', 'utf8');
const workbenchIndexSource = await readFile('src/workbench/index.ts', 'utf8');
const commandPaletteSource = await readFile('src/workbench/CommandPalette.tsx', 'utf8');
const workbenchSource = await readFile('src/workbench/WorkspacePanelHost.tsx', 'utf8');
const sharedUiIndexSource = await readFile('src/shared/ui/index.ts', 'utf8');
const buttonSource = await readFile('src/shared/ui/Button.tsx', 'utf8');
const panelSource = await readFile('src/shared/ui/Panel.tsx', 'utf8');
const stylesEntrySource = await readFile('src/ui/styles.css', 'utf8');
const tokenStylesSource = await readFile('src/ui/styles/tokens.css', 'utf8');
const baseStylesSource = await readFile('src/ui/styles/base.css', 'utf8');
const layoutStylesSource = await readFile('src/ui/styles/layout.css', 'utf8');
const workbenchStylesSource = await readFile('src/ui/styles/workbench.css', 'utf8');
const workbenchShellSource = await readFile('src/workbench/WorkbenchShell.tsx', 'utf8');
const projectSidebarSource = await readFile('src/workbench/ProjectSidebar.tsx', 'utf8');
const workbenchTopBarSource = await readFile('src/workbench/WorkbenchTopBar.tsx', 'utf8');
const tabStripSource = await readFile('src/workbench/TabStrip.tsx', 'utf8');
const tabHostSource = await readFile('src/workbench/TabHost.tsx', 'utf8');
const workbenchLabelsSource = await readFile('src/workbench/workbenchLabels.ts', 'utf8');
const workspaceStoreSource = await readFile('src/workbench/workspaceStore.ts', 'utf8');
const useWorkbenchSource = await readFile('src/workbench/useWorkbench.ts', 'utf8');
const sceneViewsSource = await readFile('src/workbench/sceneViews.tsx', 'utf8');
const builtinScenePluginsSource = await readFile('src/core/builtinScenePlugins.ts', 'utf8');
const overviewPluginSource = await readFile('src/core/overviewPlugin.ts', 'utf8');
const readerPluginSource = await readFile('src/core/readerPlugin.ts', 'utf8');
const aiPluginSource = await readFile('src/core/aiPlugin.ts', 'utf8');
const libraryPluginSource = await readFile('src/core/libraryPlugin.ts', 'utf8');
const markdownPluginSource = await readFile('src/core/markdownPlugin.ts', 'utf8');
const typesSource = await readFile('src/core/types.ts', 'utf8');
const workbenchStorageApiSource = await readFile('src/platform/workbench/workbenchStorageApi.ts', 'utf8');
const workbenchPlatformIndexSource = await readFile('src/platform/workbench/index.ts', 'utf8');
const mainSource = await readFile('src/main.tsx', 'utf8');
const explorerIndexSource = await readFile('src/features/explorer/index.ts', 'utf8');
const fileTreePanelSource = await readFile('src/features/explorer/FileTreePanel.tsx', 'utf8');
const fileTabSource = await readFile('src/features/explorer/FileTab.tsx', 'utf8');
const agentsIndexSource = await readFile('src/features/agents/index.ts', 'utf8');
const agentSessionPanelSource = await readFile('src/features/agents/AgentSessionPanel.tsx', 'utf8');
const agentProvidersSource = await readFile('src/features/agents/useAgentProviders.ts', 'utf8');
const agentRuntimeSource = await readFile('src/features/agents/useAgentSession.ts', 'utf8');
const agentCliPlatformIndexSource = await readFile('src/platform/agentCli/index.ts', 'utf8');
const agentSessionApiSource = await readFile('src/platform/agentCli/agentSession.ts', 'utf8');
const agentHistoryApiSource = await readFile('src/platform/agentCli/agentHistory.ts', 'utf8');
const zhSource = await readFile('src/ui/zh.ts', 'utf8');
const componentStylesSource = await readFile('src/ui/styles/components.css', 'utf8');
const agentProtocolSource = await readFile('src/core/agentProtocol.ts', 'utf8');
const agentHistorySource = await readFile('src/core/agentHistory.ts', 'utf8');
const resourcesSource = await readFile('src/core/resources.ts', 'utf8');
const workspaceModelSource = await readFile('src/core/workspace.ts', 'utf8');
const workbenchStoreRustSource = await readFile('src-tauri/src/workbench_store.rs', 'utf8');
const agentHistoryRustSource = await readFile('src-tauri/src/agent_history.rs', 'utf8');
const schemaSqlSource = await readFile('src-tauri/schema.sql', 'utf8');
const agentCliModSource = await readFile('src-tauri/src/agent_cli/mod.rs', 'utf8');
const agentCliProtocolSource = await readFile('src-tauri/src/agent_cli/protocol.rs', 'utf8');
const agentCliLaunchSource = await readFile('src-tauri/src/agent_cli/launch.rs', 'utf8');
const agentCliProcessSource = await readFile('src-tauri/src/agent_cli/process.rs', 'utf8');
const agentCliSupervisorSource = await readFile('src-tauri/src/agent_cli/supervisor.rs', 'utf8');
const agentCliProvidersModSource = await readFile('src-tauri/src/agent_cli/providers/mod.rs', 'utf8');
const agentCliCodexSource = await readFile('src-tauri/src/agent_cli/providers/codex.rs', 'utf8');
const agentCliClaudeSource = await readFile('src-tauri/src/agent_cli/providers/claude.rs', 'utf8');
const agentBridgeSource = await readFile('src-tauri/src/agent_bridge.rs', 'utf8');
const tauriLibSource = await readFile('src-tauri/src/lib.rs', 'utf8');
const stateCommandsSource = await readFile('src-tauri/src/state_commands.rs', 'utf8');
const libraryStylesSource = await readFile('src/ui/styles/library.css', 'utf8');
const readerStylesSource = await readFile('src/ui/styles/reader.css', 'utf8');
const markdownStylesSource = await readFile('src/ui/styles/markdown.css', 'utf8');

assert.match(appSource, /from '\.\.\/features\/library'/);
assert.match(appSource, /from '\.\.\/features\/reader'/);
assert.match(appSource, /from '\.\.\/features\/ai'/);
assert.match(appSource, /from '\.\.\/features\/settings'/);
assert.match(appSource, /from '\.\.\/workbench'/);
assert.match(appSource, /from '\.\.\/features\/explorer'/);
assert.match(appSource, /from '\.\.\/features\/agents'/);
assert.match(appSource, /from '\.\.\/shared\/hooks'/);
assert.doesNotMatch(appSource, /from '\.\/hooks\/use/);
assert.match(appSource, /<WorkbenchShell/);
assert.match(appSource, /<ProjectSidebar/);
assert.match(appSource, /<WorkbenchTopBar/);
assert.doesNotMatch(appSource, /<TabStrip/);
assert.match(appSource, /<TabHost/);
assert.doesNotMatch(appSource, /className="scene-rail"/);
assert.doesNotMatch(appSource, /className="scene-host"/);
assert.doesNotMatch(appSource, /aria-label="科研场景"/);
assert.doesNotMatch(appSource, /function LibraryScene\(/);
assert.doesNotMatch(appSource, /function LibraryDetailPanel\(/);
assert.doesNotMatch(appSource, /function LibraryEmptyState\(/);
assert.doesNotMatch(appSource, /function ImportDialog\(/);
assert.doesNotMatch(appSource, /function TagInput\(/);
assert.doesNotMatch(appSource, /function enrichImportDraftOnline\(/);
assert.doesNotMatch(appSource, /function ReaderScene\(/);
assert.doesNotMatch(appSource, /function ReaderSidePanelContent\(/);
assert.doesNotMatch(appSource, /function MarkdownNotePanel\(/);
assert.doesNotMatch(appSource, /function AnnotationListPanel\(/);
assert.doesNotMatch(appSource, /function AnnotationListItem\(/);
assert.doesNotMatch(appSource, /function RelationPanel\(/);
assert.doesNotMatch(appSource, /function ReaderToolbar\(/);
assert.doesNotMatch(appSource, /function ReaderDocumentPane\(/);
assert.doesNotMatch(appSource, /function ReaderSideDrawer\(/);
assert.doesNotMatch(appSource, /function ReaderChatPanel\(/);
assert.doesNotMatch(appSource, /from '\.\.\/features\/reader\/[^']+'/);
assert.doesNotMatch(appSource, /function AIChatScene\(/);
assert.doesNotMatch(appSource, /function SettingsScene\(/);
assert.doesNotMatch(appSource, /function PluginSettingsList\(/);
assert.doesNotMatch(appSource, /function CommandPalette\(/);
assert.doesNotMatch(appSource, /function WorkspacePanelHost</);
assert.match(libraryIndexSource, /export \{ LibraryScene \} from '\.\/LibraryScene'/);
assert.match(libraryIndexSource, /export \{ ImportDialog \} from '\.\/ImportDialog'/);
assert.match(libraryIndexSource, /export \{ TagInput \} from '\.\/TagInput'/);
assert.match(libraryIndexSource, /export \{ useImportFlow \} from '\.\/useImportFlow'/);
assert.match(libraryIndexSource, /export type \{ ImportDialogProps, ImportDialogSettings, ImportMetadataSourcePreference, ImportState, LibrarySortDirection, LibrarySortKey, LibrarySort \} from '\.\/types'/);
assert.doesNotMatch(libraryIndexSource, /function LibraryScene\(/);
assert.doesNotMatch(libraryIndexSource, /function LibraryDetailPanel\(/);
assert.match(librarySceneSource, /export function LibraryScene\(/);
assert.match(librarySceneSource, /WorkspacePanelHost/);
assert.match(librarySceneSource, /const detailView = panelViews\.find\(\(view\) => view\.id === 'library\.details' && view\.sceneId === 'library'\)/);
assert.match(librarySceneSource, /const detailPanel = sidePanels\.find\(\(panel\) => panel\.id === 'library\.details'\)\?\.panel/);
assert.doesNotMatch(librarySceneSource, /此面板的插件视图尚未接入/);
assert.doesNotMatch(librarySceneSource, /function LibraryDetailPanel\(/);
assert.match(libraryDetailPanelSource, /export function LibraryDetailPanel\(/);
assert.match(sceneAdaptersSource, /from '\.\.\/features\/library\/LibraryDetailPanel'/);
assert.match(sceneAdaptersSource, /id: libraryPanel\.id/);
assert.match(sceneAdaptersSource, /<LibraryDetailPanel/);
assert.match(importDialogSource, /export function ImportDialog\(/);
assert.match(importDialogSource, /function enrichImportDraftOnline\(/);
assert.match(tagInputSource, /export function TagInput\(/);
assert.match(libraryTypesSource, /export type LibrarySortKey = 'title' \| 'authors' \| 'year' \| 'venue'/);
assert.match(libraryTypesSource, /export type ImportState = 'idle' \| 'selecting' \| 'extracting' \| 'ready' \| 'importing' \| 'error'/);
assert.match(readerIndexSource, /export \{[\s\S]*ReaderScene[\s\S]*\} from '\.\/ReaderScene'/);
assert.doesNotMatch(readerIndexSource, /function ReaderScene\(/);
assert.match(readerIndexSource, /from '\.\/readerHelpers'/);
assert.match(readerIndexSource, /from '\.\/types'/);
assert.match(readerIndexSource, /export \{ useAnnotationHistory \} from '\.\/useAnnotationHistory'/);
assert.doesNotMatch(readerIndexSource, /ReaderToolbar/);
assert.doesNotMatch(readerIndexSource, /ReaderDocumentPane/);
assert.doesNotMatch(readerIndexSource, /ReaderSideDrawer/);
assert.match(readerIndexSource, /export type \{ ReaderSidePanelContentProps \} from '\.\/ReaderSidePanelContent'/);
assert.doesNotMatch(readerIndexSource, /ReaderChatPanel/);
assert.doesNotMatch(readerIndexSource, /AnnotationListPanel/);
assert.doesNotMatch(readerIndexSource, /RelationPanel/);
assert.doesNotMatch(readerIndexSource, /ReaderIcons/);
assert.match(readerSceneSource, /export function ReaderScene\(/);
assert.match(readerSceneSource, /<ReaderToolbar/);
assert.match(readerSceneSource, /<ReaderDocumentPane/);
assert.match(readerSceneSource, /<ReaderSideDrawer/);
assert.doesNotMatch(readerSceneSource, /function ReaderSidePanelContent\(/);
assert.doesNotMatch(readerSceneSource, /function MarkdownNotePanel\(/);
assert.doesNotMatch(readerSceneSource, /function AnnotationListPanel\(/);
assert.doesNotMatch(readerSceneSource, /function RelationPanel\(/);
assert.match(readerTypesSource, /export type ReaderSidePanelDefinition =/);
assert.match(readerTypesSource, /export type ReaderSceneProps =/);
assert.match(readerHelpersSource, /export function createReaderSidePanelDefinitions/);
assert.match(readerHelpersSource, /export function preferredReaderMode/);
assert.match(readerHelpersSource, /export function annotationLabelText/);
assert.match(readerConstantsSource, /export const annotationPresetColors/);
assert.match(readerToolbarSource, /export function ReaderToolbar\(/);
assert.doesNotMatch(readerToolbarSource, /sidePanels\.map\(\(panel\) =>/);
assert.match(readerToolbarSource, /\{!sidePanelOpen && \(/);
assert.match(readerToolbarSource, /className="reader-workspace-toggle"[\s\S]*onClick=\{\(\) => onSidePanelOpenChange\(true\)\}/);
assert.match(readerDocumentPaneSource, /const PdfReader = lazy\(\(\) => import\('\.\/pdf\/PdfReader'\)\)/);
assert.match(readerPdfSource, /export default function PdfReader\(/);
assert.match(readerPdfSource, /from '\.\/types'/);
assert.match(readerPdfSource, /from '\.\/pdfGeometry'/);
assert.match(readerPdfSource, /from '\.\/pdfSelection'/);
assert.match(readerPdfSource, /from '\.\/pdfAnnotationHelpers'/);
assert.match(readerPdfSource, /from '\.\/pdfInteraction'/);
assert.match(readerPdfSource, /from '\.\/PdfPageView'/);
assert.match(readerPdfSource, /from '\.\/AnnotationOverlay'/);
assert.doesNotMatch(readerPdfSource, /function PdfPageView\(/);
assert.doesNotMatch(readerPdfSource, /function PdfTextLayer\(/);
assert.doesNotMatch(readerPdfSource, /function AnnotationOverlay\(/);
assert.doesNotMatch(readerPdfSource, /function AnnotationMark\(/);
assert.match(readerPdfPageViewSource, /export function PdfPageView\(/);
assert.match(readerPdfPageViewSource, /from '\.\/PdfTextLayer'/);
assert.match(readerPdfTextLayerSource, /export function PdfTextLayer\(/);
assert.match(readerPdfAnnotationOverlaySource, /export function AnnotationOverlay\(/);
assert.match(readerPdfAnnotationOverlaySource, /from '\.\/AnnotationMark'/);
assert.match(readerPdfAnnotationMarkSource, /export function AnnotationMark\(/);
assert.match(readerPdfTypesSource, /export type PageMeta =/);
assert.match(readerPdfGeometrySource, /export function outputScaleForViewport/);
assert.match(readerPdfSelectionSource, /export function textSelectionFromDrag/);
assert.match(readerPdfSelectionSource, /export function mergeRectsIntoLineSegments/);
assert.match(readerPdfAnnotationHelpersSource, /export function buildAnnotationDraft/);
assert.match(readerPdfInteractionSource, /export function pointFromEvent/);
assert.match(readerPdfInteractionSource, /export function scrollPageIntoViewIfNeeded/);
assert.match(readerPdfInteractionSource, /export function createDragDraft/);
assert.match(readerPdfInteractionSource, /export function stickyPositionFromDrag/);
assert.match(readerDocumentPaneSource, /export function ReaderDocumentPane\(/);
assert.match(readerSideDrawerSource, /export function ReaderSideDrawer\(/);
assert.doesNotMatch(readerSideDrawerSource, /<WorkspacePanelHost/);
assert.match(readerSideDrawerSource, /panelViews\.find\(\(view\) => view\.id === activePanel\.panel\.id\)/);
assert.match(readerSideDrawerSource, /activePanelView\.render\(/);
assert.match(readerSidePanelContentSource, /export function ReaderSidePanelContent\(/);
assert.match(readerSidePanelContentSource, /<AnnotationListPanel/);
assert.match(readerMarkdownSource, /export function MarkdownNotePanel\(/);
assert.match(annotationListPanelSource, /export function AnnotationListPanel\(/);
assert.match(annotationListPanelSource, /function AnnotationListItem\(/);
assert.match(readerChatPanelSource, /export function ReaderChatPanel/);
assert.match(relationPanelSource, /export function RelationPanel\(/);
assert.match(readerIconsSource, /export function AnnotationToolIcon/);
assert.doesNotMatch(readerSceneSource, /from '\.\.\/\.\.\/ui\/App'/);
assert.match(aiIndexSource, /export \{ AIChatScene, type AIChatMessage, type AIChatSceneProps, type AiReasoningLevel, type AiRunMode, type AiToolProviderId \} from '\.\/AIChatScene'/);
assert.match(aiIndexSource, /export \{ useChatThreads \} from '\.\/useChatThreads'/);
assert.match(aiSceneSource, /export type AIChatMessage = \{/);
assert.match(aiSceneSource, /export function AIChatScene\(/);
assert.match(settingsSource, /export function SettingsScene\(/);
assert.match(settingsSource, /function PluginSettingsList\(/);
assert.match(settingsSource, /import \{ Button, Panel \} from '\.\.\/\.\.\/shared\/ui'/);
assert.match(settingsSource, /<Panel title=\{zh\.settings\.language\}>/);
assert.match(settingsSource, /<Button active=\{settings\.density === 'compact'\}/);
assert.match(workbenchIndexSource, /export \{ CommandPalette, type CommandPaletteItem \} from '\.\/CommandPalette'/);
assert.match(workbenchIndexSource, /export \{ WorkbenchShell, type WorkbenchShellProps \} from '\.\/WorkbenchShell'/);
assert.match(workbenchIndexSource, /export \{ ProjectSidebar, type ProjectSidebarProps, type SidebarSceneItem, type SidebarOpenItem \} from '\.\/ProjectSidebar'/);
assert.match(workbenchIndexSource, /export \{ TabStrip, type TabStripItem \} from '\.\/TabStrip'/);
assert.match(workbenchIndexSource, /export \{ TabHost, type TabHostItem \} from '\.\/TabHost'/);
assert.match(workbenchIndexSource, /createSceneViewRegistry/);
assert.match(sceneViewsSource, /export interface SceneViewContribution/);
assert.match(sceneViewsSource, /export function createSceneViewRegistry/);
assert.match(sceneViewsSource, /export interface SceneSidebarViewContribution/);
assert.match(sceneViewsSource, /export function createSceneSidebarViewRegistry/);
assert.match(sceneViewsSource, /ReactNode/);
assert.match(builtinScenePluginsSource, /export function createBuiltinScenePlugin/);
assert.match(builtinScenePluginsSource, /overview\.core/);
assert.match(builtinScenePluginsSource, /reader\.core/);
assert.match(builtinScenePluginsSource, /ai\.core/);
assert.match(overviewPluginSource, /createOverviewPlugin/);
assert.match(overviewPluginSource, /overview\.core/);
assert.match(readerPluginSource, /createReaderPlugin/);
assert.match(readerPluginSource, /reader\.core/);
assert.match(aiPluginSource, /createAiPlugin/);
assert.match(aiPluginSource, /ai\.core/);
assert.match(libraryPluginSource, /createBuiltinScenePlugin/);
assert.match(libraryPluginSource, /scenePlugin\.activate\(context\)/);
assert.match(markdownPluginSource, /createBuiltinScenePlugin/);
assert.match(markdownPluginSource, /scenePlugin\.activate\(context\)/);
assert.match(appSource, /aster\.sceneViews\.list\(\)/);
assert.match(appSource, /aster\.sceneSidebars\.list\(\)/);
assert.match(appSource, /createSceneViewRegistry\(/);
assert.match(appSource, /createSceneSidebarViewRegistry\(/);
assert.match(appSource, /resolveSceneUiContributions\(/);
assert.match(appSource, /resolvedSceneUi\.views/);
assert.match(appSource, /resolvedSceneUi\.sidebars/);
assert.match(appSource, /createBuiltinSceneUiContributions\(/);
assert.match(projectSidebarSource, /contextualSidebar\?: ReactNode/);
assert.match(projectSidebarSource, /sidebarWorkspaceOpen\?: boolean/);
assert.match(typesSource, /'workspace'/);
assert.doesNotMatch(appSource, /if \(scene === 'overview'\)/);
assert.doesNotMatch(appSource, /if \(scene === 'library'\)/);
assert.doesNotMatch(appSource, /if \(scene === 'aiChat'\)/);
assert.match(workbenchShellSource, /export function WorkbenchShell\(/);
assert.match(workbenchShellSource, /className=\{explorer \? 'workbench-shell with-explorer' : 'workbench-shell'\}/);
assert.match(projectSidebarSource, /export function ProjectSidebar\(/);
assert.match(workbenchTopBarSource, /export function WorkbenchTopBar\(/);
assert.match(tabStripSource, /export function TabStrip\(/);
assert.match(tabHostSource, /export function TabHost\(/);
assert.match(workbenchLabelsSource, /export interface WorkbenchLabels/);
assert.match(workspaceStoreSource, /export function createWorkbenchStore/);
/* PWS-1: SQLite persistence swaps the storage adapter, it does not move the
   model into platform/ and it does not reverse the dependency direction. */
assert.match(useWorkbenchSource, /export function configureWorkbenchStorage\(storage: WorkbenchStorage\)/);
assert.match(workbenchIndexSource, /export \{ configureWorkbenchStorage, useWorkbench, workbenchStore/);
assert.match(workbenchStorageApiSource, /export interface WorkbenchSnapshotStorage/);
assert.match(workbenchStorageApiSource, /invoke<string \| null>\('load_workbench_state'\)/);
assert.match(workbenchStorageApiSource, /invoke<void>\('save_workbench_state', \{ request: \{ snapshot \} \}\)/);
assert.match(workbenchStorageApiSource, /export async function createWorkbenchStorage\(\)/);
assert.doesNotMatch(workbenchStorageApiSource, /from '\.\.\/\.\.\/workbench/);
assert.doesNotMatch(workbenchStorageApiSource, /from '\.\.\/\.\.\/features\//);
assert.doesNotMatch(workbenchStorageApiSource, /from '\.\.\/\.\.\/ui\//);
assert.match(workbenchPlatformIndexSource, /export \{[\s\S]*createWorkbenchStorage[\s\S]*\} from '\.\/workbenchStorageApi'/);
assert.match(mainSource, /from '\.\/platform\/workbench'/);
assert.match(mainSource, /configureWorkbenchStorage\(storage\)/);
/* workbench/ sits below ui/ and platform/: labels are injected, native calls are not. */
for (const source of [workbenchShellSource, projectSidebarSource, workbenchTopBarSource, tabStripSource, tabHostSource, workbenchLabelsSource, workspaceStoreSource, useWorkbenchSource]) {
  assert.doesNotMatch(source, /from '\.\.\/ui\//);
  assert.doesNotMatch(source, /from '\.\.\/platform\//);
  assert.doesNotMatch(source, /from '\.\.\/features\//);
}
assert.match(explorerIndexSource, /export \{ FileTreePanel/);
assert.match(explorerIndexSource, /export \{ FileTab/);
assert.match(fileTreePanelSource, /export function FileTreePanel\(/);
assert.match(fileTreePanelSource, /from '\.\.\/\.\.\/platform\/projects'/);
assert.match(fileTreePanelSource, /onRenameFile\?:/);
assert.match(fileTreePanelSource, /onRevealFile\?:/);
assert.match(fileTreePanelSource, /onMoveEntry\?:/);
assert.match(fileTreePanelSource, /const startEntryPointerDrag = \(event: ReactPointerEvent<HTMLButtonElement>, entry: DirectoryEntry\)/);
assert.match(fileTreePanelSource, /onPointerDown=\{\(event\) => startEntryPointerDrag\(event, entry\)\}/);
assert.match(fileTreePanelSource, /window\.addEventListener\('pointermove', handlePointerMove, \{ passive: false \}\)/);
assert.match(fileTreePanelSource, /window\.addEventListener\('pointerup', handlePointerUp\)/);
assert.match(fileTreePanelSource, /data-directory=\{entry\.is_directory \? 'true' : undefined\}/);
assert.match(fileTreePanelSource, /const FILE_TREE_DRAG_THRESHOLDS = \{[\s\S]*mouse: 6,[\s\S]*pen: 8,[\s\S]*touch: 12,[\s\S]*\}/);
assert.match(fileTreePanelSource, /function dragThresholdFor\(pointerType: string\)/);
assert.match(fileTreePanelSource, /className="file-tree-drag-preview"/);
assert.match(fileTreePanelSource, /document\.addEventListener\('visibilitychange', cancelActiveDrag\)/);
assert.match(fileTreePanelSource, /const clearDragState = \(\) => \{[\s\S]*setDragPreviewPosition\(null\);/);
assert.doesNotMatch(fileTreePanelSource, /onDragStart|onDragEnd|onDragOver|onDragLeave|onDrop|draggable=/);
assert.doesNotMatch(workbenchStylesSource, /file-tree-row\[draggable="true"\]/);
assert.match(workbenchStylesSource, /\.file-tree-row \{[\s\S]*cursor: default;[\s\S]*user-select: none;[\s\S]*touch-action: none;[\s\S]*\}/);
assert.match(workbenchStylesSource, /\.file-tree-drag-preview \{/);
assert.match(fileTreePanelSource, /onContextMenu=\{\(event\) => openFileContextMenu\(event, entry\)\}/);
assert.match(fileTreePanelSource, /className="file-tree-context-menu"/);
assert.match(fileTreePanelSource, /fileOpenLocation/);
assert.match(fileTreePanelSource, /renameFromContextMenu/);
assert.match(fileTreePanelSource, /className="file-tree-rename-input"/);
assert.match(fileTreePanelSource, /onKeyDown=\{\(event\) => \{/);
assert.match(fileTreePanelSource, /event\.key === 'Escape'/);
assert.match(workbenchStylesSource, /\.file-tree-row\.directory\[data-drop-target="true"\]/);
assert.doesNotMatch(fileTreePanelSource, /window\.prompt\(/);
assert.match(fileTabSource, /export function FileTab\(/);
assert.match(fileTabSource, /readTextFilePreview/);
assert.match(fileTabSource, /FileQuestionMark/);
assert.match(fileTabSource, /file-tab-empty-state/);
assert.doesNotMatch(fileTabSource, /file-tab-actions/);
assert.doesNotMatch(fileTabSource, /openPathExternal|openPathInVSCode|revealPath/);
assert.match(workbenchStylesSource, /\.file-tab-body\.unsupported/);
assert.match(agentsIndexSource, /export \{ AgentSessionPanel/);
assert.match(agentsIndexSource, /export \{ useAgentProviders/);
assert.match(agentSessionPanelSource, /export function AgentSessionPanel\(/);
assert.match(agentProvidersSource, /export function useAgentProviders\(/);
assert.match(agentProvidersSource, /detectAgentProviders/);
/* platform/ may only look down: an adapter that imported a feature or the UI would
   turn the dependency direction inside out. */
for (const source of [agentSessionApiSource, agentCliPlatformIndexSource]) {
  assert.doesNotMatch(source, /from '\.\.\/\.\.\/features\//);
  assert.doesNotMatch(source, /from '\.\.\/\.\.\/workbench/);
  assert.doesNotMatch(source, /from '\.\.\/\.\.\/ui\//);
}
for (const source of [fileTreePanelSource, fileTabSource, agentSessionPanelSource, agentProvidersSource]) {
  assert.doesNotMatch(source, /from '\.\.\/\.\.\/ui\/App'/);
}
/* CLI-0: the Agent CLI contract is pure core — no React, no Tauri, no process
   handling — so both the UI and the supervisor can depend on it. */
assert.match(agentProtocolSource, /export type AgentEvent =/);
assert.match(agentProtocolSource, /export function applyAgentEvent\(/);
assert.match(agentProtocolSource, /export function openAgentRunGate\(/);
for (const forbidden of [/from '\.\.\/platform\//, /from '\.\.\/features\//, /from '\.\.\/ui\//, /from '\.\.\/workbench\//, /from '\.\.\/shared\//, /from 'react'/, /@tauri-apps/]) {
  assert.doesNotMatch(agentProtocolSource, forbidden);
}
/* One wire contract, two languages: the event names must not drift apart. */
for (const eventType of ['started', 'delta', 'tool', 'completed', 'stopped', 'failed']) {
  assert.match(agentProtocolSource, new RegExp(`type: '${eventType}'`));
  assert.match(agentCliProtocolSource, new RegExp(`${eventType[0].toUpperCase()}${eventType.slice(1)} \\{`));
}
assert.match(agentCliProtocolSource, /rename_all = "camelCase"/);
for (const module of ['launch', 'peer', 'process', 'protocol', 'providers', 'supervisor', 'transport', 'turn']) {
  assert.match(agentCliModSource, new RegExp(`pub mod ${module};`));
}
assert.match(tauriLibSource, /pub mod agent_cli;/);
/* The runtime is reached through the module root, so a provider adapter never has to
   name an inner module. */
for (const name of ['AgentSupervisor', 'ProviderSession', 'SessionSpec', 'ChildTransport']) {
  assert.match(agentCliModSource, new RegExp(`pub use [^;]*\\b${name}\\b`, 's'));
}
/* CLI-1: the parent Agent session's variables must never reach a child CLI, or a
   nested `claude` behaves like a nested session. */
assert.match(agentCliLaunchSource, /pub const STRIPPED_ENV_VARS/);
for (const variable of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT', 'CLAUDE_AGENT_SDK_VERSION']) {
  assert.match(agentCliLaunchSource, new RegExp(`"${variable}"`));
}
/* Going through `cmd` for the npm shims makes every argument a shell injection
   risk, and `cmd /C <missing>` starts happily — so metacharacters are refused and
   a bare name is resolved on PATH before spawning. */
assert.match(agentCliLaunchSource, /SHELL_METACHARACTERS/);
assert.match(agentCliLaunchSource, /CREATE_NO_WINDOW/);
assert.match(agentCliLaunchSource, /pub fn resolve_program\(/);
/* The real child process is one more `AgentTransport`, not a second framing layer,
   and it takes the whole tree down: the npm shim's grandchildren are what survive a
   plain kill. */
assert.match(agentCliProcessSource, /impl AgentTransport for ChildTransport/);
assert.match(agentCliProcessSource, /taskkill/);
assert.match(agentCliProcessSource, /impl Drop for ChildTransport/);
/* Run isolation and the wire contract stay where CLI-0 put them: neither the
   process layer nor the supervisor may grow its own decoder. The process layer does
   not touch JSON at all — it moves lines. */
assert.doesNotMatch(agentCliProcessSource, /JsonlDecoder|serde_json/);
assert.doesNotMatch(agentCliSupervisorSource, /JsonlDecoder/);
assert.match(agentCliSupervisorSource, /pub trait ProviderSession/);
assert.match(agentCliSupervisorSource, /RunGate::new\(\)/);
assert.match(agentCliSupervisorSource, /impl Drop for AgentSupervisor/);
/* The runtime knows nothing about the UI's storage or the Tauri window: a CLI must
   never be able to write Aster's SQLite. */
assert.doesNotMatch(agentCliSupervisorSource, /rusqlite|workbench_store|tauri::/);
/* CLI-2: the Codex adapter is a `ProviderSession` on the CLI-1 seam, and it speaks
   the v2 `thread/*` + `turn/*` dialect rather than scraping stdout. */
assert.match(agentCliProvidersModSource, /pub mod codex;/);
assert.match(agentCliCodexSource, /impl ProviderSession for CodexSession/);
assert.match(agentCliCodexSource, /pub const CODEX_PROGRAM: &str = "codex";/);
for (const method of ['initialize', 'thread/start', 'thread/resume', 'turn/start', 'turn/interrupt']) {
  assert.match(agentCliCodexSource, new RegExp(`"${method}"`));
}
/* A4Note cannot render an approval dialog for a CLI that asks mid-turn, so the
   session runs with `approvalPolicy:"never"` and the sandbox is the real control —
   an unknown mode must fall to the least privileged one, never the most. */
assert.match(agentCliCodexSource, /APPROVAL_POLICY/);
assert.match(agentCliCodexSource, /"never"/);
assert.match(agentCliCodexSource, /pub fn sandbox_for\(mode: &str\)/);
assert.match(agentCliCodexSource, /"autoReview" => "workspace-write"/);
assert.match(agentCliCodexSource, /"fullAccess" => "danger-full-access"/);
assert.match(agentCliCodexSource, /_ => "read-only"/);
/* CLI-3: the Claude adapter sits on the same seam, but its dialect is plain typed
   JSON objects rather than JSON-RPC — so it must not grow a `method`/`id` request
   layer, and its turns are named by a marker it mints itself. */
assert.match(agentCliProvidersModSource, /pub mod claude;/);
assert.match(agentCliClaudeSource, /impl ProviderSession for ClaudeSession/);
assert.match(agentCliClaudeSource, /pub const CLAUDE_PROGRAM: &str = "claude";/);
for (const flag of ['-p', '--input-format', '--output-format', 'stream-json', '--include-partial-messages', '--verbose', '--permission-mode']) {
  assert.match(agentCliClaudeSource, new RegExp(`"${flag}"`));
}
/* There is no `--cwd`: the working directory is the spawn's, and a flag that does
   not exist would make every session fail to start. Checked on the command builder
   alone, since the test module names the flag to assert its absence. */
const claudeLaunch = agentCliClaudeSource.slice(
  agentCliClaudeSource.indexOf('fn launch(&self, spec: &SessionSpec)'),
  agentCliClaudeSource.indexOf('fn connect('),
);
assert.ok(claudeLaunch.length > 0, 'claude 适配器必须有 launch');
assert.doesNotMatch(claudeLaunch, /--cwd/);
/* `--include-partial-messages` delivers real `text_delta` increments, so the
   `assistant` snapshot is a duplicate of what already streamed. Both halves of that
   pair have to stay: the delta is what the transcript shows, and the per-message
   bookkeeping is what stops it being shown twice. */
assert.match(agentCliClaudeSource, /"text_delta"/);
assert.match(agentCliClaudeSource, /streamed: HashSet<String>/);
/* Same rule as CLI-2: A4Note renders no approval dialog, so an unknown permission
   mode falls to the mode that cannot write, never to the one that can do anything. */
assert.match(agentCliClaudeSource, /pub fn permission_for\(mode: &str\)/);
assert.match(agentCliClaudeSource, /pub const MANUAL_MODE: &str = "manual";/);
assert.match(agentCliClaudeSource, /"autoReview" => "acceptEdits"/);
assert.match(agentCliClaudeSource, /"fullAccess" => "bypassPermissions"/);
assert.match(agentCliClaudeSource, /_ => MANUAL_MODE/);
/* Every control request must be answered or the turn behind it stalls: a tool
   request is denied, anything else gets an error response. */
assert.match(agentCliClaudeSource, /"can_use_tool"/);
assert.match(agentCliClaudeSource, /"behavior": "deny"/);
assert.match(agentCliClaudeSource, /"subtype": "error"/);
/* Stopping is the control protocol, and the answer to our own interrupt is what
   ends the turn — so both directions of that exchange must be here. */
assert.match(agentCliClaudeSource, /"subtype": "interrupt"/);
assert.match(agentCliClaudeSource, /"control_response" => self\.control_response/);
/* The runtime still never names Tauri: `agent_bridge.rs` is the one file that knows
   both halves, and it is what `lib.rs` registers. */
for (const source of [agentCliModSource, agentCliCodexSource, agentCliClaudeSource, agentCliProvidersModSource]) {
  assert.doesNotMatch(source, /tauri::/);
}
/* An unknown provider id must be refused rather than started as whichever adapter
   happens to be first, so every id the UI can send needs its own branch. */
for (const providerId of ['codex', 'claude']) {
  assert.match(agentBridgeSource, new RegExp(`"${providerId}" => \\{`));
}
assert.match(agentBridgeSource, /AgentErrorKind::NotInstalled/);
assert.match(agentBridgeSource, /use crate::agent_cli::\{/s);
assert.match(agentBridgeSource, /pub const AGENT_EVENT: &str = "agent:\/\/event";/);
assert.match(agentBridgeSource, /pub fn register\(app: &AppHandle\)/);
assert.match(agentBridgeSource, /pub fn shutdown\(app: &AppHandle\)/);
/* The handshake blocks and `close` joins the session thread, so those commands must
   not run on the main thread. */
for (const command of ['start_agent_session', 'send_agent_message', 'stop_agent_session', 'close_agent_session']) {
  assert.match(agentBridgeSource, new RegExp(`#\\[tauri::command\\(async\\)\\]\\s*pub fn ${command}\\(`));
}
assert.match(tauriLibSource, /mod agent_bridge;/);
for (const command of ['start_agent_session', 'send_agent_message', 'stop_agent_session', 'close_agent_session', 'agent_session_running']) {
  assert.match(tauriLibSource, new RegExp(`agent_bridge::${command}`));
}
/* Tauri's exit path does not run destructors, so the supervisor is closed explicitly
   or every live CLI child outlives the window. */
assert.match(tauriLibSource, /RunEvent::Exit/);
assert.match(tauriLibSource, /agent_bridge::shutdown\(app\)/);
/* P2-1: `lib.rs` is wiring only. Every command body lives in the domain module that
   owns its tables, so registering a new one costs a line here instead of growing the
   file back to the 2800 it was. The line cap is the whole point of the split. */
assert.doesNotMatch(tauriLibSource, /#\[tauri::command/);
assert.doesNotMatch(tauriLibSource, /rusqlite|params!|Connection/);
assert.ok(
  tauriLibSource.split('\n').length < 160,
  'lib.rs must stay a module list plus run(): put the body in its domain module.',
);
for (const domain of ['app_paths', 'backup', 'database', 'diagnostics', 'guide', 'library_ai', 'library_annotations', 'library_import', 'library_notes', 'library_papers', 'pdf_metadata', 'project_commands', 'state_commands', 'sync_commands']) {
  assert.match(tauriLibSource, new RegExp(`^mod ${domain};$`, 'm'));
}
/* Every registered command must name its module, or a body could quietly come back
   to the crate root and still be registered. */
const registeredCommands = tauriLibSource.match(/generate_handler!\[([\s\S]*?)\]\)/);
assert.ok(registeredCommands, 'lib.rs must still register the command handler');
for (const entry of registeredCommands[1].split(',').map((line) => line.trim()).filter(Boolean)) {
  assert.match(entry, /^[a-z_0-9]+::[a-z_0-9]+$/);
}
/* The UI reaches the runtime through platform/, never through `invoke` of its own,
   and both sides name the same event channel. */
assert.match(agentSessionApiSource, /export const AGENT_EVENT_CHANNEL = 'agent:\/\/event';/);
for (const command of ['start_agent_session', 'send_agent_message', 'stop_agent_session', 'close_agent_session', 'agent_session_running']) {
  assert.match(agentSessionApiSource, new RegExp(`'${command}'`));
}
assert.match(agentCliPlatformIndexSource, /export \{[\s\S]*listenAgentEvents[\s\S]*\} from '\.\/agentSession'/);
assert.doesNotMatch(agentRuntimeSource, /@tauri-apps/);
assert.match(agentRuntimeSource, /export function useAgentSession\(/);
assert.match(agentRuntimeSource, /from '\.\.\/\.\.\/platform\/agentCli'/);
assert.match(agentsIndexSource, /export \{[\s\S]*useAgentSession/);
/* The panel drives a real session now: the composer sends, and the transcript is
   what the CLI streamed. */
assert.match(agentSessionPanelSource, /useAgentSession\(session, \{ onStatusChange, onProviderSessionId \}\)/);
assert.match(agentSessionPanelSource, /const submit = \(\) => \{/);
assert.match(agentSessionPanelSource, /onClick=\{submit\}/);
assert.match(agentSessionPanelSource, /className="agent-transcript"/);
assert.doesNotMatch(agentSessionPanelSource, /<textarea disabled/);
assert.doesNotMatch(agentSessionPanelSource, /agentRuntimePending/);
assert.doesNotMatch(zhSource, /agentRuntimePending/);
/* CLI-4: the mapping between stored rows and the live transcript is pure core, on
   the same terms as CLI-0 — the reducers it wraps are what decide turn identity. */
assert.match(agentHistorySource, /export interface AgentMessageRecord \{/);
for (const exported of ['agentTranscriptToRecords', 'restoreAgentTranscript', 'agentMessageDigest', 'pendingAgentMessageWrites']) {
  assert.match(agentHistorySource, new RegExp(`export function ${exported}\\(`));
}
for (const forbidden of [/from '\.\.\/platform\//, /from '\.\.\/features\//, /from '\.\.\/ui\//, /from '\.\.\/workbench\//, /from '\.\.\/shared\//, /from 'react'/, /@tauri-apps/]) {
  assert.doesNotMatch(agentHistorySource, forbidden);
}
/* A restored run id must be marked, and the mark stripped again on the way back:
   `run_id` counts from zero every time the supervisor starts, so an unmarked
   restored turn would collect the next process's answer instead of a new turn. */
assert.match(agentHistorySource, /export const AGENT_RESTORED_RUN_MARKER = '#restored';/);
for (const exported of ['restoredAgentRunId', 'isRestoredAgentRun', 'storedAgentRunId']) {
  assert.match(agentHistorySource, new RegExp(`export function ${exported}\\(`));
}
assert.match(agentHistorySource, /AGENT_RESTORED_RUN_MARKER/);
/* History is Aster's own database, so it rides the SQLite side of the wall — since
   P2-1 that is `state_commands.rs`, next to the workbench snapshot, and still never
   the bridge: the CLI's side must stay unable to name rusqlite or this store. */
assert.match(tauriLibSource, /mod agent_history;/);
assert.match(stateCommandsSource, /use crate::agent_history;/);
for (const command of ['load_agent_messages', 'save_agent_messages']) {
  assert.match(stateCommandsSource, new RegExp(`#\\[tauri::command\\(async\\)\\]\\s*pub fn ${command}\\(`));
  assert.match(tauriLibSource, new RegExp(`^\\s*state_commands::${command},$`, 'm'));
  assert.match(agentHistoryApiSource, new RegExp(`'${command}'`));
}
assert.doesNotMatch(agentBridgeSource, /rusqlite|agent_history/);
assert.doesNotMatch(agentHistoryRustSource, /tauri::/);
/* The table is not a child of `agent_sessions` (a snapshot rewrite would cascade
   every conversation away), so the sweep inside that same transaction is what keeps
   the two consistent. */
assert.match(schemaSqlSource, /CREATE TABLE IF NOT EXISTS agent_messages \(/);
assert.match(schemaSqlSource, /PRIMARY KEY \(session_id, seq\)/);
assert.doesNotMatch(schemaSqlSource, /agent_messages[\s\S]*REFERENCES agent_sessions/);
assert.match(agentHistoryRustSource, /pub\(crate\) fn prune_orphans\(/);
assert.match(workbenchStoreRustSource, /crate::agent_history::prune_orphans\(&transaction, &live_session_ids\)\?;/);
/* Writing is an UPSERT of the rows that moved, so opening a session must not rewrite
   its whole history, and `created_at` must survive an update. */
assert.match(agentHistoryRustSource, /ON CONFLICT\(session_id, seq\) DO UPDATE SET/);
assert.doesNotMatch(agentHistoryRustSource, /DO UPDATE SET[^"]*created_at = /);
/* The hook keeps reaching the runtime through platform/, history included. */
assert.match(agentRuntimeSource, /from '\.\.\/\.\.\/core\/agentHistory'/);
assert.match(agentCliPlatformIndexSource, /export \{ loadAgentMessages, saveAgentMessages \} from '\.\/agentHistory';/);
assert.match(commandPaletteSource, /export type CommandPaletteItem = \{/);
assert.match(commandPaletteSource, /export function CommandPalette\(/);
assert.match(workbenchSource, /export function WorkspacePanelHost<TPanelId extends string>/);
assert.match(sharedUiIndexSource, /export \{ Button \} from '\.\/Button'/);
assert.match(sharedUiIndexSource, /export \{ Panel \} from '\.\/Panel'/);
assert.match(buttonSource, /export function Button/);
assert.match(buttonSource, /variant\?: ButtonVariant/);
assert.match(panelSource, /export function Panel/);
assert.match(panelSource, /className="panel-title"/);
assert.match(sharedHooksIndexSource, /export \{[\s\S]*usePersistedUiState[\s\S]*\} from '\.\/usePersistedUiState'/);
assert.match(stylesEntrySource, /^\uFEFF?@import '\.\/styles\/tokens\.css';\s*@import '\.\/styles\/base\.css';\s*@import '\.\/styles\/layout\.css';\s*@import '\.\/styles\/components\.css';\s*@import '\.\/styles\/library\.css';\s*@import '\.\/styles\/reader\.css';/);
assert.match(tokenStylesSource, /:root \{/);
assert.match(baseStylesSource, /\* \{ box-sizing: border-box; \}/);
assert.match(layoutStylesSource, /\.scene \{/);
assert.match(layoutStylesSource, /\.error-boundary-shell/);
assert.doesNotMatch(layoutStylesSource, /\.scene-rail/);
assert.match(workbenchStylesSource, /\.workbench-shell/);
assert.match(workbenchStylesSource, /\.workbench-sidebar/);
assert.match(workbenchStylesSource, /\.workbench-topbar/);
assert.match(workbenchStylesSource, /\.workbench-tabstrip/);
assert.match(workbenchStylesSource, /\.workbench-tab-frame/);
assert.match(workbenchStylesSource, /\.workbench-overlay/);
assert.match(workbenchStylesSource, /\.file-tree-panel/);
assert.match(workbenchStylesSource, /\.file-tab-preview/);
assert.match(workbenchStylesSource, /\.agent-session-facts/);
assert.match(workbenchStylesSource, /\.agent-transcript/);
assert.match(workbenchStylesSource, /\.agent-session-composer/);
assert.doesNotMatch(workbenchStylesSource, /\.scene-rail/);
assert.match(componentStylesSource, /\.soft-panel/);
assert.match(componentStylesSource, /\.workspace-panel-host/);
assert.match(libraryStylesSource, /\.library-layout/);
assert.match(libraryStylesSource, /\.tag-input-shell/);
assert.match(readerStylesSource, /\.reader-toolbar/);
assert.match(readerStylesSource, /\.pdf-page/);
// Rendered Markdown has exactly one owner: markdown.css, keyed on `.md-body`.
// Surfaces keep their own chrome (padding, width, scrolling) but must not
// re-declare document content styling, which is how the notes tab, the reader
// and the reader preview drifted into three different visual languages.
assert.match(stylesEntrySource, /@import '\.\/styles\/markdown\.css';\s*$/);
assert.match(markdownStylesSource, /\.md-body \{/);
assert.match(markdownStylesSource, /\.md-body blockquote\.markdown-callout \{/);
// remark-rehype pads blockquote children with "\n" text nodes, so the callout
// marker is never the first child. Looking at index 0 made every callout fall
// back to a plain quote with a literal `[!NOTE]` in the body.
assert.match(markdownCalloutSource, /blocks\.findIndex\(\(block\) => isValidElement\(block\)\)/);
assert.doesNotMatch(markdownCalloutSource, /const firstBlock = blocks\[0\]/);
assert.match(workbenchStylesSource, /\.cm-md-block-syntax-hidden \{/);
assert.match(markdownStylesSource, /:where\(\.md-body, \.markdown-live-codemirror\) table \{/);
assert.match(markdownStylesSource, /\.md-body :not\(pre\) > code \{/);
assert.match(markdownStylesSource, /\.md-body \.footnotes \{/);
assert.doesNotMatch(workbenchStylesSource, /\.markdown-resource-preview (?:blockquote|table|th|td|ul|ol|li|hr|img|pre|code|a|em|del|strong|mark)[ ,{]/);
assert.doesNotMatch(readerStylesSource, /\.markdown-(?:preview|reader-content) (?:blockquote|table|th|td|ul|ol|li|hr|img|pre|code|a|em|del|strong|mark|h1|h2|h3|h4|h5|h6|p)[ ,{]/);
assert.doesNotMatch(readerStylesSource, /^mark \{/m);
assert.match(readerMarkdownSource, /className="md-body markdown-reader-content"/);
assert.match(readerMarkdownSource, /className="md-body markdown-preview note-preview-only"/);
// One renderer for every Markdown surface. Callouts, fenced code and tables are
// shared components, so the notes tab and the reader cannot disagree about the
// DOM the stylesheet targets. `shared/*` is the bottom layer (ARCHITECTURE.md
// section 5), so these components stay free of core/platform/feature imports.
assert.match(sharedMarkdownIndexSource, /export \{ MarkdownCallout, calloutLabel, isKnownCalloutType, markdownNodeText \} from '\.\/MarkdownCallout'/);
// An unrecognised `[!TYPE]` still gets an icon, a header band and the raw name
// in the badge — but not the same name printed twice.
assert.match(markdownCalloutSource, /export function isKnownCalloutType/);
assert.match(markdownCalloutSource, /\{known && <span className="markdown-callout-label">/);
assert.match(markdownLivePreviewEditorSource, /isKnownCalloutType\(type\) \? calloutLabel\(type\) : ''/);
assert.match(sharedMarkdownIndexSource, /export \{ MarkdownCodeBlock, MarkdownTable \} from '\.\/MarkdownCodeBlock'/);
assert.match(sharedMarkdownIndexSource, /export \{ MarkdownFigure \} from '\.\/MarkdownFigure'/);
for (const forbidden of [/from '\.\.\/\.\.\/platform\//, /from '\.\.\/\.\.\/core\//, /from '\.\.\/\.\.\/features\//, /from '\.\.\/\.\.\/ui\//]) {
  assert.doesNotMatch(markdownCalloutSource, forbidden);
  assert.doesNotMatch(markdownCodeBlockSource, forbidden);
}
for (const markdownSurfaceSource of [markdownReadContentSource, markdownResourceTabSource]) {
  assert.match(markdownSurfaceSource, /from '\.\.\/\.\.\/shared\/markdown'/);
  assert.match(markdownSurfaceSource, /blockquote: MarkdownCallout/);
  assert.match(markdownSurfaceSource, /pre: MarkdownCodeBlock/);
  assert.match(markdownSurfaceSource, /table: MarkdownTable/);
}
assert.match(markdownCodeBlockSource, /className="markdown-table-wrap"/);
// Captions come from the image title, never from alt, and both surfaces route
// images through the shared figure so zoom behaves the same everywhere.
assert.doesNotMatch(markdownFigureSource, /from '\.\.\/\.\.\/platform\//);
assert.match(markdownFigureSource, /className="markdown-figcaption"/);
assert.match(markdownFigureSource, /className="markdown-lightbox"/);
assert.match(markdownReadContentSource, /<MarkdownFigure /);
assert.match(markdownResourceTabSource, /<MarkdownFigure /);
assert.match(markdownStylesSource, /:where\(\.md-body, \.markdown-live-codemirror\) td\[align="center"\]/);
assert.match(markdownStylesSource, /\.markdown-lightbox \{/);
assert.match(markdownStylesSource, /\.markdown-footnote-preview \{/);
assert.match(markdownStylesSource, /\.markdown-footnotes-heading \{/);
assert.match(sharedMarkdownIndexSource, /export \{ MarkdownFootnoteRef, MarkdownFootnoteBackref, MarkdownFootnotesSection \} from '\.\/MarkdownFootnote'/);
assert.match(markdownReadContentSource, /<MarkdownFootnoteRef /);
assert.match(markdownReadContentSource, /<MarkdownFootnoteBackref /);
assert.match(markdownReadContentSource, /<MarkdownFootnotesSection>/);
assert.match(markdownResourceTabSource, /<MarkdownFootnoteRef /);
assert.match(markdownResourceTabSource, /<MarkdownFootnoteBackref /);
assert.match(markdownResourceTabSource, /<MarkdownFootnotesSection>/);
assert.match(markdownPluginSource, /id: 'markdown\.paragraphIndent'/);
assert.match(markdownPluginSource, /title: '段首缩进'/);
assert.match(appSource, /pluginSettingValues\['markdown\.paragraphIndent'\]/);
assert.match(appSource, /dataset\.markdownParagraphIndent = 'true'/);
assert.match(markdownStylesSource, /\[data-markdown-paragraph-indent="true"\] \.md-body p,/);
assert.match(markdownStylesSource, /text-indent: 2em;/);
assert.match(markdownStylesSource, /text-wrap: pretty;/);
assert.match(markdownStylesSource, /text-spacing: trim-start/);
assert.match(markdownStylesSource, /text-autospace: ideograph-alpha/);
// `==highlight==`, a fixed inline-HTML allow-list and `[[note]]` links are one
// remark plugin. rehype-raw stays out on purpose: raw HTML would let an imported
// note run scripts inside the Tauri webview, so only these tags and `title` pass.
assert.match(markdownInlineSource, /const allowedTags = 'mark\|kbd\|u\|sub\|sup\|s\|small\|abbr'/);
assert.match(markdownInlineSource, /export function remarkAsterInline/);
assert.match(markdownInlineSource, /export const wikiLinkProtocol = 'a4note-wiki:'/);
assert.doesNotMatch(markdownInlineSource, /const allowedTags = '[^']*(?:script|iframe|object|embed|style|form|input)/i);
assert.match(markdownInlineSource, /function titleProperty/);
for (const markdownSurfaceSource of [markdownReadContentSource, markdownResourceTabSource]) {
  assert.match(markdownSurfaceSource, /remarkAsterInline\]/);
  assert.match(markdownSurfaceSource, /wikiLinkProtocol/);
}
assert.doesNotMatch(markdownReadContentSource, /rehype-raw/);
assert.doesNotMatch(markdownResourceTabSource, /rehype-raw/);
assert.match(markdownWorkspaceSceneSource, /onOpenWikiLink=/);
assert.match(markdownStylesSource, /\.md-body \.markdown-wiki-link \{/);
assert.match(markdownStylesSource, /\.md-body kbd \{/);
// Fence highlighting reuses the editor's CodeMirror language set instead of a
// second highlighter. language-data was only ever a hoisted transitive package,
// so it has to stay declared or the languages vanish on a fresh install.
assert.match(packageJsonSource, /"@codemirror\/language-data": "6\.5\.2"/);
assert.match(markdownHighlightSource, /from '@codemirror\/language-data'/);
assert.match(markdownHighlightSource, /classHighlighter/);
assert.match(markdownCodeBlockSource, /from '\.\/highlight'/);
assert.match(markdownStylesSource, /:where\(\.md-body, \.markdown-live-codemirror\) \{/);
assert.match(markdownStylesSource, /^\.tok-keyword,/m);
assert.match(markdownLivePreviewEditorSource, /markdownLanguage\(\{ codeLanguages \}\)/);
assert.match(markdownLivePreviewEditorSource, /class: 'tok-keyword'/);
// Block runs decide their own caps in the decoration builder. A CSS sibling
// guess put the rounded end and its shadow on the wrong line when a quote
// contained an empty `>` row, and gave the closing fence both caps at once.
assert.match(markdownLivePreviewEditorSource, /cm-md-quote-start/);
assert.match(markdownLivePreviewEditorSource, /cm-md-quote-end/);
assert.match(markdownLivePreviewEditorSource, /insideFence \? ' cm-md-code-end' : ' cm-md-code-start'/);
assert.match(markdownLivePreviewEditorSource, /class CodeCopyWidget extends WidgetType/);
assert.doesNotMatch(workbenchStylesSource, /\.cm-md-quote-line:has\(\+ \.cm-line/);
assert.doesNotMatch(workbenchStylesSource, /\.cm-md-code-line \+ \.cm-line\.cm-md-code-fence/);
assert.match(workbenchStylesSource, /\.cm-md-code-copy \{/);
// Both surfaces render block math as the same card.
assert.match(markdownStylesSource, /\.md-body \.katex-display \{[\s\S]*?box-shadow/);
// Tables render as one design on both surfaces: the editor swaps the source rows
// for a real table through TableWidget and reuses markdown.css's table rules.
assert.match(markdownLivePreviewEditorSource, /class TableWidget extends WidgetType/);
assert.match(markdownLivePreviewEditorSource, /className = 'markdown-table-wrap cm-md-table-widget'/);
assert.match(markdownStylesSource, /:where\(\.md-body, \.markdown-live-codemirror\) table \{/);
// Bold-italic is matched before bold, otherwise `***x***` renders as bold with a
// stray asterisk left over.
assert.match(markdownLivePreviewEditorSource, /\\\*\\\*\\\*\|___/);
assert.match(markdownLivePreviewEditorSource, /insideBoldItalic/);
assert.doesNotMatch(librarySceneSource, /from '\.\.\/\.\.\/ui\/App'/);
assert.doesNotMatch(libraryDetailPanelSource, /from '\.\.\/\.\.\/ui\/App'/);
assert.doesNotMatch(importDialogSource, /from '\.\.\/\.\.\/ui\/App'/);
assert.doesNotMatch(tagInputSource, /from '\.\.\/\.\.\/ui\/App'/);
assert.doesNotMatch(libraryTypesSource, /from '\.\.\/\.\.\/ui\/App'/);
assert.doesNotMatch(readerIndexSource, /from '\.\.\/\.\.\/ui\/App'/);
assert.doesNotMatch(readerSceneSource, /from '\.\.\/\.\.\/ui\/App'/);
assert.doesNotMatch(readerTypesSource, /from '\.\.\/\.\.\/ui\/App'/);
assert.doesNotMatch(readerHelpersSource, /from '\.\.\/\.\.\/ui\/App'/);
assert.doesNotMatch(readerConstantsSource, /from '\.\.\/\.\.\/ui\/App'/);
assert.doesNotMatch(readerToolbarSource, /from '\.\.\/\.\.\/ui\/App'/);
assert.doesNotMatch(readerDocumentPaneSource, /from '\.\.\/\.\.\/ui\/App'/);
assert.doesNotMatch(readerSideDrawerSource, /from '\.\.\/\.\.\/ui\/App'/);
assert.doesNotMatch(readerSidePanelContentSource, /from '\.\.\/\.\.\/ui\/App'/);
assert.doesNotMatch(readerMarkdownSource, /from '\.\.\/\.\.\/ui\/App'/);
assert.doesNotMatch(annotationListPanelSource, /from '\.\.\/\.\.\/ui\/App'/);
assert.doesNotMatch(readerChatPanelSource, /from '\.\.\/\.\.\/ui\/App'/);
assert.doesNotMatch(relationPanelSource, /from '\.\.\/\.\.\/ui\/App'/);
assert.doesNotMatch(readerIconsSource, /from '\.\.\/\.\.\/ui\/App'/);
assert.doesNotMatch(aiSceneSource, /from '\.\.\/\.\.\/ui\/App'/);
assert.doesNotMatch(settingsSource, /from '\.\.\/\.\.\/ui\/App'/);
assert.doesNotMatch(commandPaletteSource, /from '\.\.\/ui\/App'/);
assert.doesNotMatch(workbenchSource, /from '\.\.\/ui\/App'/);
/* RES-2: resource identity is pure core — the same rule as the Agent contract, so
   the UI, the workbench model and any future importer can all depend on it. */
assert.match(resourcesSource, /export interface Resource \{/);
assert.match(resourcesSource, /export function normalizeResourceUri\(/);
assert.match(resourcesSource, /export function resourceKey\(/);
assert.match(resourcesSource, /export function resourceTabKey\(/);
assert.match(resourcesSource, /export function localPathFromResourceUri\(/);
for (const forbidden of [/from '\.\.\/platform\//, /from '\.\.\/features\//, /from '\.\.\/ui\//, /from '\.\.\/workbench\//, /from '\.\.\/shared\//, /from 'react'/, /@tauri-apps/, /localStorage/]) {
  assert.doesNotMatch(resourcesSource, forbidden);
}
/* One registry, one identity function: the model must dedupe through `resourceKey`
   rather than comparing raw URIs, and every file tab must be keyed by it. */
assert.match(workspaceModelSource, /resources: Resource\[\];/);
assert.match(workspaceModelSource, /export function registerResource\(/);
assert.match(workspaceModelSource, /from '\.\/resources'/);
assert.match(appSource, /from '\.\.\/core\/resources'/);
assert.match(appSource, /key: resourceTabKey\(uri\)/);
/* The URI grammar lives in TypeScript only. Rust stores `uri` verbatim, so a
   second normalizer there could quietly disagree about what one path is called. */
assert.match(workbenchStoreRustSource, /pub struct ResourceRecord \{/);
assert.match(workbenchStoreRustSource, /pub resources: Vec<ResourceRecord>,/);
assert.doesNotMatch(workbenchStoreRustSource, /fn normalize_(resource_)?uri/);
/* Dedup is the model's job, so the URI index must stay non-unique: a model bug
   should surface as a duplicate row, never as a failed save. */
assert.match(schemaSqlSource, /CREATE TABLE IF NOT EXISTS resources \(/);
assert.match(schemaSqlSource, /CREATE INDEX IF NOT EXISTS resources_uri ON resources \(uri\);/);
assert.doesNotMatch(schemaSqlSource, /UNIQUE[^\n]*\buri\b/);

console.log('Architecture boundary verification passed');
