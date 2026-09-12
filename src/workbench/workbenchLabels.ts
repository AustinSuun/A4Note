/**
 * Label contract for the workbench shell (PWS-2).
 *
 * `workbench/` sits below `ui/` in the module graph, so the shell never imports
 * the Chinese string table directly: `App.tsx` passes `zh.workbench` in.
 */
export interface WorkbenchLabels {
  brand: string;
  projects: string;
  tools: string;
  scenes: string;
  allScenes: string;
  selectedScenes: (count: number) => string;
  addProject: string;
  projectsEmpty: string;
  projectMissing: string;
  newWorkspace: string;
  removeProject: string;
  removeWorkspace: string;
  renameWorkspace: string;
  sessionCount: (count: number) => string;
  settings: string;
  commandPalette: string;
  openInVSCode: string;
  revealFolder: string;
  toggleFileTree: string;
  fileTree: string;
  fileTreeNeedsFolder: string;
  backToScenes: string;
  workspaceLabel: string;
  noWorkspaceTitle: string;
  noWorkspaceDescription: string;
  noTabTitle: string;
  noTabDescription: string;
  closeTab: string;
  pinTab: string;
  unpinTab: string;
  newAgentSession: string;
  agentProviders: string;
  agentDetecting: string;
  agentUnavailable: string;
  agentNoProvider: string;
}
