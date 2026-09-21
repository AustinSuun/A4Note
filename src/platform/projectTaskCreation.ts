import { invoke, isTauri } from '@tauri-apps/api/core';
import { normalizeProjectPath } from './projectTasksPreference';

export function validateTaskProjectName(raw: string): string {
  const name = raw.trim();
  if (!name || new TextEncoder().encode(name).length > 120 ||
      /[<>:"/\\|?*\u0000-\u001f]/.test(name) || /^[.]/.test(name) || /[. ]$/.test(name) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
    throw Error('请输入有效的项目文件夹名称，不含路径分隔符、系统保留名或结尾句点（最多120字节）。');
  }
  return name;
}

export async function createTaskProjectFolder(parent: string, rawName: string): Promise<string> {
  if (!isTauri()) throw Error('新建本机项目需要桌面版 A4 Note。');
  const name = validateTaskProjectName(rawName);
  if (!parent.trim()) throw Error('请先选择保存位置。');
  // Existing native command uses create_dir, never overwrites an existing folder.
  await invoke<void>('create_directory', { request: { path: parent, name } });
  return normalizeProjectPath(parent).replace(/\/$/, '') + '/' + name;
}
