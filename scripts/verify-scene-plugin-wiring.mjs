import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile('src/ui/App.tsx', 'utf8');
const core = await readFile('src/core/asterCore.ts', 'utf8');
const scenes = await readFile('src/core/builtinScenePlugins.ts', 'utf8');
const registry = await readFile('src/workbench/sceneViews.tsx', 'utf8');
const resourceRegistry = await readFile('src/workbench/resourceViews.tsx', 'utf8');
const contributions = {
  overview: await readFile('src/features/overview/contributions.tsx', 'utf8'),
  library: await readFile('src/features/library/contributions.tsx', 'utf8'),
  reader: await readFile('src/features/reader/contributions.tsx', 'utf8'),
  aiChat: await readFile('src/features/ai/contributions.tsx', 'utf8'),
  markdown: await readFile('src/features/markdown/contributions.tsx', 'utf8'),
};

for (const [sceneId, pluginId, viewId] of [
  ['overview', 'overview.core', 'overview.core.view'],
  ['library', 'library.core', 'library.core.view'],
  ['reader', 'reader.core', 'reader.core.view'],
  ['aiChat', 'ai.core', 'ai.core.view'],
  ['markdown', 'markdown.core', 'markdown.core.view'],
]) {
  assert.match(core, new RegExp(`id: '${sceneId}'`), `core must register ${sceneId}`);
  assert.match(scenes, new RegExp(pluginId.replace('.', '\\.') ), `scene plugin must exist: ${pluginId}`);
  assert.match(contributions[sceneId], new RegExp(`id: '${viewId.replace('.', '\\.')}'`), `feature must own ${viewId}`);
  assert.match(contributions[sceneId], new RegExp(`sceneId: '${sceneId}'`), `feature must wire ${sceneId}`);
  assert.match(contributions[sceneId], new RegExp(`pluginId: '${pluginId.replace('.', '\\.')}'`), `feature must attribute ${sceneId} to ${pluginId}`);
}

for (const pluginFile of ['src/core/libraryPlugin.ts', 'src/core/readerPlugin.ts', 'src/core/aiPlugin.ts', 'src/core/markdownPlugin.ts']) {
  assert.match(await readFile(pluginFile, 'utf8'), /sidebarMode: 'workspace'/, `${pluginFile} must opt into the full scene workspace sidebar`);
}

assert.match(app, /aster\.sceneViews\.list\(\)/);
assert.match(app, /aster\.sceneSidebars\.list\(\)/);
assert.match(app, /resolveSceneUiContributions\(/);
assert.match(app, /opener\?\.renderer/);
assert.doesNotMatch(app, /if \(false\)/, 'host must not retain unreachable legacy plugin-resource fallback');
assert.match(app, /createBuiltinSceneUiContributions\(/);
assert.match(app, /createSceneViewRegistry\(/);
assert.match(app, /createSceneSidebarViewRegistry\(/);
assert.match(app, /resolvedSceneUi\.views/);
assert.match(app, /resolvedSceneUi\.sidebars/);
assert.match(app, /resolveSceneViewForRender/);
assert.match(app, /aster\.plugins\.has\(fallback\.pluginId\)/);
assert.match(app, /activeWorkspaceRecord\?\.layout\.fileTreeVisible/);
assert.match(app, /sidebarWorkspaceOpen/);
assert.match(app, /sidebarMode === 'workspace'/);
// App uses optional chaining because the active tab may not have a scene
// contribution while a workspace is being restored. Keep this assertion
// aligned with the runtime contract without requiring one exact spelling.
assert.match(app, /scene\??\.sidebarMode === 'contextual'/);
assert.match(app, /scene\.resourceKinds\?\.includes\(effectiveKind\)/);
assert.match(app, /const persistedSceneId = tabStateString\(tab, 'sceneId'\)/);
assert.match(app, /\.\.\.\(resourceSceneId \? \{ sceneId: resourceSceneId \} : \{\}\)/);
assert.match(app, /safeResourceOpenerState\(openerRecord\?\.state\)/);
assert.match(app, /resourceKind: storedResourceKind/);
assert.match(app, /const sceneId = sceneForWorkspaceTab\(tab\)/);
assert.match(app, /const sidebarOpenItems: SidebarOpenItem\[\] = workspaceTabs[\s\S]*?\.filter\(\(tab\) => sceneForWorkspaceTab\(tab\) !== 'reader'/, 'reader tabs must stay in the Reader workspace sidebar');
assert.match(app, /activeOpenItemId=\{activeTab && sidebarOpenItems\.some\(\(item\) => item\.id === activeTab\.id\) \? activeTab\.id : null\}/, 'scene highlight must not depend on hidden reader child tabs');
assert.match(app, /resource\.sceneId \? sceneDefinitionsRef\.current\.get\(resource\.sceneId\)\?\.pluginId/);
assert.doesNotMatch(app, /const \[sidebarView, setSidebarView\]/, 'host must not keep a second scenes/files sidebar state');
assert.doesNotMatch(app, /activeMarkdownContext|markdownSidebarSessionRef|markdownSidebarDismissed/, 'Markdown must use the generic scene sidebar lifecycle');
assert.match(await readFile('src/features/reader/ReaderSceneSidebar.tsx', 'utf8'), /openItems/);
assert.match(await readFile('src/features/library/contributions.tsx', 'utf8'), /<LibrarySceneSidebar \{\.\.\.props\}/);
assert.match(await readFile('src/features/ai/contributions.tsx', 'utf8'), /scene-workspace-empty/);
const sidebar = await readFile('src/workbench/ProjectSidebar.tsx', 'utf8');
assert.doesNotMatch(sidebar, /markdownSidebarMode|onExitMarkdownSidebar|sidebarView/, 'ProjectSidebar must be scene-contribution driven');
assert.match(app, /const sceneId = key\.startsWith\(TOOL_TAB_PREFIX\) \? key\.slice\(TOOL_TAB_PREFIX\.length\) : key/);
assert.match(app, /workbenchStore\.rekeyTab\(legacyTab\.id, canonicalKey/);
assert.match(registry, /pluginId: string/);
assert.match(registry, /Scene view contribution requires id, sceneId and pluginId/);

const adapters = await readFile('src/ui/sceneAdapters.tsx', 'utf8');
const bindings = await readFile('src/core/pluginBindings.ts', 'utf8');
assert.match(adapters, /export function createBuiltinSceneUiContributions/);
assert.match(adapters, /export function resolveSceneViewContributions/);
assert.match(adapters, /export function resolveSceneSidebarContributions/);
assert.match(adapters, /export function resolveSceneUiContributions/);
assert.match(adapters, /isPluginActive\(registration\.pluginId\)/);
assert.match(adapters, /resolveResourceViewContributions\(/);
assert.match(adapters, /createReaderResourceViewContribution\(\{ \.\.\.runtime\.readerResource, openerId: 'library\.pdf', pluginId: 'library\.core' \}\)/);
assert.match(resourceRegistry, /Resource view already registered for opener/);
assert.match(resourceRegistry, /renderDeclarative: \(renderer: DeclarativeViewRenderer\)/);
assert.match(resourceRegistry, /renderDeclarative\(opener\.renderer!\)/);
assert.match(resourceRegistry, /missingResourceViewIds/);
assert.match(adapters, /view\.id === registration\.id/);
assert.match(adapters, /sidebar\.id === registration\.id/);
assert.match(adapters, /diagnostics/);
assert.match(adapters, /selectPluginLifecycleFallbacks/);
assert.match(bindings, /export function findOwnedPluginCandidate/);
assert.match(bindings, /export function selectPluginLifecycleFallbacks/);
assert.match(bindings, /activeRegistrationKeys/);

const workbenchStyles = await readFile('src/ui/styles/workbench.css', 'utf8');
assert.match(workbenchStyles, /\.workbench-scene-list\s*\{[\s\S]*?display:\s*grid[\s\S]*?grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(108px,\s*100%\),\s*1fr\)\)/, 'scene navigation should use a responsive multi-column tile grid');
assert.match(workbenchStyles, /\.workbench-scene-list\s*\{[\s\S]*?width:\s*100%[\s\S]*?padding:\s*0[;\s]/, 'scene tile grid should fill the sidebar without browser list indentation');
assert.match(workbenchStyles, /\.workbench-scene-row \.workbench-tool\s*\{[\s\S]*?flex-direction:\s*column/, 'scene navigation tiles should stack icon above label');
assert.match(workbenchStyles, /\.workbench-tool-list:not\(\.workbench-scene-list\)/, 'generic tool-list flex layout must not override scene tile grid');

console.log('Scene plugin wiring verification passed');
