import { useEffect, useState } from 'react';
import type { DirectoryEntry } from '../../platform/projects';
import { createDirectory, renameDirectory, deleteEmptyDirectory, createTextFile, deleteTextFile, resolveProjectWikiLink, movePath, renameTextFile, revealPath } from '../../platform/projects';
import { FileTreePanel, MarkdownResourceTab } from '../explorer';
import { zh } from '../../ui/zh';

type OpenMarkdownFile = Pick<DirectoryEntry, 'path' | 'name'> & { id: string };

function displayFileName(name: string) {
  return name.replace(/\.(?:md|markdown|mdx)$/i, '') || '未命名文档';
}

function normalizeFilesystemPath(path: string) {
  return path.replace(/[\\/]+$/, '').toLowerCase();
}

function isPathWithin(sourcePath: string, candidatePath: string) {
  const source = normalizeFilesystemPath(sourcePath);
  const candidate = normalizeFilesystemPath(candidatePath);
  return candidate === source || candidate.startsWith(`${source}\\`) || candidate.startsWith(`${source}/`);
}

function remapMovedPath(path: string, sourcePath: string, destinationPath: string) {
  if (!isPathWithin(sourcePath, path)) return path;
  const source = sourcePath.replace(/[\\/]+$/, '');
  const destination = destinationPath.replace(/[\\/]+$/, '');
  const suffix = path.slice(source.length).replace(/^[/\\]+/, '');
  if (!suffix) return destinationPath;
  const separator = destination.includes('\\') ? '\\' : '/';
  return `${destination}${separator}${suffix}`;
}

export type MarkdownWorkspaceSceneProps = { rootPath: string | null; projectName: string; showFileTree?: boolean };

export function MarkdownWorkspaceScene({ rootPath, projectName, showFileTree = true }: MarkdownWorkspaceSceneProps) {
  const [treeRevision, setTreeRevision] = useState(0);
  const [openFiles, setOpenFiles] = useState<OpenMarkdownFile[]>([]);
  const [activePath, setActivePath] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    setOpenFiles([]);
    setActivePath('');
    setStatus('');
  }, [rootPath]);

  const openFile = (entry: DirectoryEntry) => {
    if (entry.is_directory || !['md', 'markdown', 'mdx'].includes(entry.extension.toLowerCase())) return;
    const opened = { id: crypto.randomUUID(), path: entry.path, name: entry.name };
    setOpenFiles((current) => current.some((file) => file.path === entry.path) ? current : [...current, opened]);
    setActivePath(entry.path);
    setStatus('');
  };

  const createNote = async (directoryPath: string = rootPath ?? '') => {
    if (!directoryPath) return;
    const baseName = '未命名.md';
    for (let index = 0; index < 100; index += 1) {
      const name = index === 0 ? baseName : `未命名 ${index + 1}.md`;
      const path = `${directoryPath.replace(/[\\/]$/, '')}\\${name}`;
      try {
        await createTextFile(path, '# 新建笔记\n\n');
        openFile({ name, path, is_directory: false, size: 0, extension: 'md' });
        setTreeRevision((current) => current + 1);
        return;
      } catch (error) {
        if (index === 99) setStatus(error instanceof Error ? error.message : String(error));
      }
    }
  };

  const createFolder = async (directoryPath: string, name: string) => {
    await createDirectory(directoryPath, name);
  };

  const deleteNote = async (entry: DirectoryEntry) => {
    if (!window.confirm(entry.is_directory ? `仅删除空文件夹“${entry.name}”？非空目录将拒绝删除。` : `删除“${entry.name}”？文件内容将从磁盘移除。`)) return;
    try {
      if (entry.is_directory) await deleteEmptyDirectory(rootPath ?? '', entry.path);
      else await deleteTextFile(entry.path);
      setOpenFiles((current) => current.filter((file) => file.path !== entry.path));
      setActivePath((current) => current === entry.path ? '' : current);
      setTreeRevision((current) => current + 1);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const renameNote = async (entry: DirectoryEntry, newStem: string) => {
    try {
      const renamed = entry.is_directory ? await renameDirectory(rootPath ?? '', entry.path, newStem) : await renameTextFile(entry.path, newStem);
      setOpenFiles((current) => current.map(file => isPathWithin(entry.path, file.path) ? { ...file, path: remapMovedPath(file.path, entry.path, renamed.path), name: file.path === entry.path ? renamed.name : file.name } : file));
      setActivePath((current) => isPathWithin(entry.path, current) ? remapMovedPath(current, entry.path, renamed.path) : current);
      setTreeRevision((current) => current + 1);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      throw error;
    }
  };

  const moveEntry = async (entry: DirectoryEntry, destinationDirectory: string) => {
    try {
      const moved = await movePath(entry.path, destinationDirectory);
      setOpenFiles((current) => current.map((file) => {
        if (!isPathWithin(entry.path, file.path)) return file;
        const nextPath = remapMovedPath(file.path, entry.path, moved.path);
        return {
          ...file,
          path: nextPath,
          name: normalizeFilesystemPath(file.path) === normalizeFilesystemPath(entry.path) ? moved.name : file.name,
        };
      }));
      setActivePath((current) => isPathWithin(entry.path, current) ? remapMovedPath(current, entry.path, moved.path) : current);
      setTreeRevision((current) => current + 1);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const revealNote = async (entry: DirectoryEntry) => {
    try {
      await revealPath(entry.path);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : zh.app.actionFailed);
    }
  };

  const openWikiLink = async (fromPath: string, target: string) => {
    if (!rootPath) return;
    try {
      const file = await resolveProjectWikiLink(rootPath, fromPath, target);
      openFile({ ...file, size: 0 });
    } catch (error) { setStatus(String(error)); }
  };

  if (!rootPath) {
    return (
      <section className="scene active markdown-workspace-scene">
        <main className="markdown-workspace-editor markdown-workspace-empty-editor">
          <p className="markdown-workspace-empty-hint">{zh.workbench.fileTreeNeedsFolder}</p>
        </main>
      </section>
    );
  }

  const hasOpenFile = openFiles.length > 0;

  return (
    <section className="scene active markdown-workspace-scene">
      {hasOpenFile && (
        <header className="markdown-workspace-header">
          <div>
            <h1>Markdown 笔记</h1>
            <span title={rootPath}>{projectName}</span>
          </div>
          <button type="button" className="primary rounded-button markdown-new-file" onClick={() => void createNote()}>
            <span aria-hidden="true">+</span>
            {zh.reader.noteNew}
          </button>
        </header>
      )}
      {status && <div className="markdown-workspace-status" role="status">{status}</div>}
      <div className={showFileTree ? 'markdown-workspace-body' : 'markdown-workspace-body without-file-tree'}>
        {showFileTree && <FileTreePanel key={treeRevision} rootPath={rootPath} onOpenFile={openFile} onDeleteFile={(entry) => void deleteNote(entry)} onRenameFile={renameNote} onRevealFile={(entry) => void revealNote(entry)} onMoveEntry={moveEntry} onCreateFile={createNote} onCreateFolder={createFolder} activePath={activePath} />}
        {hasOpenFile ? (
          <main className="markdown-workspace-editor">
            <div className="markdown-workspace-tabs" role="tablist" aria-label="Markdown files">
              {openFiles.map((file) => (
                <button key={file.id} type="button" role="tab" aria-selected={activePath === file.path} className={activePath === file.path ? 'active' : ''} onClick={() => setActivePath(file.path)}>
                  {displayFileName(file.name)}
                </button>
              ))}
            </div>
            <div className="markdown-workspace-file-host">
              {openFiles.map((file) => (
                <div key={file.id} className={activePath === file.path ? 'markdown-workspace-file active' : 'markdown-workspace-file'}>
                  <MarkdownResourceTab
                    path={file.path}
                    name={file.name}
                    onOpenWikiLink={(target) => void openWikiLink(file.path, target)}
                    onRenamed={(renamed) => {
                      setOpenFiles((current) => current.map((candidate) => candidate.id === file.id ? { ...candidate, ...renamed } : candidate));
                      setActivePath((current) => current === file.path ? renamed.path : current);
                      setTreeRevision((current) => current + 1);
                    }}
                  />
                </div>
              ))}
            </div>
          </main>
        ) : (
          <main className="markdown-workspace-editor markdown-workspace-empty-editor">
            <p className="markdown-workspace-empty-hint">从左侧打开一个 Markdown 笔记</p>
          </main>
        )}
      </div>
    </section>
  );
}
