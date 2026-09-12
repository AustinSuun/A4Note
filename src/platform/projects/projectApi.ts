/**
 * Project folder access (RES-0 / RES-1 / RES-3).
 *
 * The only place in the frontend that talks to the folder picker and the
 * filesystem commands. React components import from `src/platform/projects`,
 * never `invoke` directly.
 */
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { mutateTextDocumentPath } from './textDocuments';

export interface DirectoryEntry {
  name: string;
  path: string;
  is_directory: boolean;
  size: number;
  extension: string;
  modified_at?: number | null;
  created_at?: number | null;
}

export interface DirectoryListing {
  path: string;
  entries: DirectoryEntry[];
  truncated: boolean;
}

export interface ProjectFolderInfo {
  path: string;
  name: string;
  exists: boolean;
  is_directory: boolean;
}

export interface TextFilePreview {
  path: string;
  content: string;
  byte_length: number;
  truncated: boolean;
  binary: boolean;
}

/** Complete UTF-8 text for an editable Markdown document. */
export interface TextFileContent {
  path: string;
  content: string;
  byte_length: number;
  binary: boolean;
}

export interface RenamedTextFile {
  path: string;
  name: string;
}

export interface MovedPath {
  source_path: string;
  path: string;
  name: string;
  is_directory: boolean;
}

export function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Returns null when the user cancels the picker. */
export async function selectProjectFolder(): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false, recursive: false });
  return typeof selected === 'string' ? selected : null;
}

export function describeProjectFolder(path: string) {
  return invoke<ProjectFolderInfo>('describe_project_folder', { request: { path } });
}

export function listDirectoryEntries(path: string, includeHidden = false) {
  return invoke<DirectoryListing>('list_directory_entries', {
    request: { path, include_hidden: includeHidden },
  });
}

/** Head of a text file, for the file tab preview. Binary files come back flagged. */
export function readTextFilePreview(path: string) {
  return invoke<TextFilePreview>('read_text_file_preview', { request: { path } });
}

export function readTextFile(path: string) {
  return invoke<TextFileContent>('read_text_file', { request: { path } });
}

export function writeTextFile(path: string, content: string) {
  return invoke<void>('write_text_file', { request: { path, content } });
}

export function renameTextFile(path: string, newName: string) {
  return mutateTextDocumentPath(path, () => invoke<RenamedTextFile>('rename_text_file', { request: { path, new_name: newName } }), (file) => file.path);
}

export function movePath(sourcePath: string, destinationDirectory: string) {
  return mutateTextDocumentPath(sourcePath, () => invoke<MovedPath>('move_path', {
    request: { source_path: sourcePath, destination_directory: destinationDirectory },
  }), (file) => file.path);
}

export function createTextFile(path: string, content = '') {
  return invoke<void>('create_text_file', { request: { path, content } });
}

export function createDirectory(path: string, name: string) {
  return invoke<void>('create_directory', { request: { path, name } });
}

export function deleteTextFile(path: string) {
  return mutateTextDocumentPath(path, () => invoke<void>('delete_text_file', { request: { path } }), () => null);
}

export function openExternalUrl(url: string) {
  return invoke<void>('open_external_url', { request: { path: url } });
}

export interface CommandResult {
  status: number;
  stdout: string;
  stderr: string;
}

export function runProjectCommand(cwd: string, command: string, args: string[] = []) {
  return invoke<CommandResult>('run_project_command', { request: { cwd, command, args } });
}

/**
 * Whole-file bytes for a viewer that parses them itself (PDF-0). `Vec<u8>` crosses
 * the IPC boundary as a number array, so the caller wraps it in `Uint8Array`.
 */
export function readFileBytes(path: string) {
  return invoke<number[]>('read_file_bytes', { request: { path } });
}

/** Shows the path in Explorer/Finder; files are revealed through their folder. */
export function revealPath(path: string) {
  return invoke<void>('reveal_path', { request: { path } });
}

export function openPathExternal(path: string) {
  return invoke<void>('open_path_external', { request: { path } });
}

export function openPathInVSCode(path: string) {
  return invoke<void>('open_path_in_vscode', { request: { path } });
}

export function renameDirectory(rootPath: string, path: string, newName: string) {
  return mutateTextDocumentPath(path, () => invoke<RenamedTextFile>('rename_directory', { request: { root_path: rootPath, path, new_name: newName } }), file => file.path);
}
export function deleteEmptyDirectory(rootPath: string, path: string) {
  return mutateTextDocumentPath(path, () => invoke<void>('delete_empty_directory', { request: { root_path: rootPath, path } }), () => null);
}
