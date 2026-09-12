export {
  describeProjectFolder,
  isTauriRuntime,
  listDirectoryEntries,
  openPathExternal,
  openPathInVSCode,
  readFileBytes,
  readTextFile,
  readTextFilePreview,
  renameTextFile,
  movePath,
  writeTextFile,
  createTextFile,
  createDirectory,
  renameDirectory,
  deleteEmptyDirectory,
  deleteTextFile,
  openExternalUrl,
  runProjectCommand,
  revealPath,
  selectProjectFolder,
  type DirectoryEntry,
  type DirectoryListing,
  type ProjectFolderInfo,
  type RenamedTextFile,
  type MovedPath,
  type TextFilePreview,
  type TextFileContent,
  type CommandResult,
} from './projectApi';
export { getPluginSandboxCapabilities, runPluginSandboxed, type PluginProcessResult, type SandboxCapabilities } from './pluginSandboxApi';

export { acquireTextDocument, reloadTextDocument } from './textDocuments';
export { resolveProjectWikiLink } from './wikiLinks';
