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
  'src/workbench/index.ts',
  'src/workbench/CommandPalette.tsx',
  'src/workbench/WorkspacePanelHost.tsx',
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
  'src/platform/nativeApi.ts',
];

for (const file of requiredFiles) {
  await access(file);
}

const appSource = await readFile('src/ui/App.tsx', 'utf8');
const libraryIndexSource = await readFile('src/features/library/index.ts', 'utf8');
const librarySceneSource = await readFile('src/features/library/LibraryScene.tsx', 'utf8');
const libraryDetailPanelSource = await readFile('src/features/library/LibraryDetailPanel.tsx', 'utf8');
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
const componentStylesSource = await readFile('src/ui/styles/components.css', 'utf8');
const libraryStylesSource = await readFile('src/ui/styles/library.css', 'utf8');
const readerStylesSource = await readFile('src/ui/styles/reader.css', 'utf8');

assert.match(appSource, /from '\.\.\/features\/library'/);
assert.match(appSource, /from '\.\.\/features\/reader'/);
assert.match(appSource, /from '\.\.\/features\/ai'/);
assert.match(appSource, /from '\.\.\/features\/settings'/);
assert.match(appSource, /from '\.\.\/workbench'/);
assert.match(appSource, /from '\.\.\/shared\/hooks'/);
assert.doesNotMatch(appSource, /from '\.\/hooks\/use/);
assert.match(appSource, /<nav className="scene-rail" aria-label="场景导航">/);
assert.doesNotMatch(appSource, /aria-label="绉戠爺鍦烘櫙"/);
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
assert.match(librarySceneSource, /from '\.\/LibraryDetailPanel'/);
assert.doesNotMatch(librarySceneSource, /function LibraryDetailPanel\(/);
assert.match(libraryDetailPanelSource, /export function LibraryDetailPanel\(/);
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
assert.doesNotMatch(readerIndexSource, /ReaderSidePanelContent/);
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
assert.match(readerSideDrawerSource, /<ReaderSidePanelContent/);
assert.match(readerSidePanelContentSource, /export function ReaderSidePanelContent\(/);
assert.match(readerSidePanelContentSource, /<AnnotationListPanel/);
assert.match(readerMarkdownSource, /export function MarkdownNotePanel\(/);
assert.match(annotationListPanelSource, /export function AnnotationListPanel\(/);
assert.match(annotationListPanelSource, /function AnnotationListItem\(/);
assert.match(readerChatPanelSource, /export function ReaderChatPanel/);
assert.match(relationPanelSource, /export function RelationPanel\(/);
assert.match(readerIconsSource, /export function AnnotationToolIcon/);
assert.doesNotMatch(readerSceneSource, /from '\.\.\/\.\.\/ui\/App'/);
assert.match(aiIndexSource, /export \{ AIChatScene, type AIChatMessage, type AiReasoningLevel, type AiRunMode, type AiToolProviderId \} from '\.\/AIChatScene'/);
assert.match(aiIndexSource, /export \{ useChatThreads \} from '\.\/useChatThreads'/);
assert.match(aiSceneSource, /export type AIChatMessage = \{/);
assert.match(aiSceneSource, /export function AIChatScene\(/);
assert.match(settingsSource, /export function SettingsScene\(/);
assert.match(settingsSource, /function PluginSettingsList\(/);
assert.match(settingsSource, /import \{ Button, Panel \} from '\.\.\/\.\.\/shared\/ui'/);
assert.match(settingsSource, /<Panel title=\{zh\.settings\.language\}>/);
assert.match(settingsSource, /<Button active=\{settings\.density === 'compact'\}/);
assert.match(workbenchIndexSource, /export \{ CommandPalette, type CommandPaletteItem \} from '\.\/CommandPalette'/);
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
assert.match(layoutStylesSource, /\.scene-rail/);
assert.match(componentStylesSource, /\.soft-panel/);
assert.match(componentStylesSource, /\.workspace-panel-host/);
assert.match(libraryStylesSource, /\.library-layout/);
assert.match(libraryStylesSource, /\.tag-input-shell/);
assert.match(readerStylesSource, /\.reader-toolbar/);
assert.match(readerStylesSource, /\.pdf-page/);
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

console.log('Architecture boundary verification passed');
