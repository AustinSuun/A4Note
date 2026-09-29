import { useEffect, useState } from 'react';
import { BoardEditor } from './BoardEditor';
import { BOARD_FILE_CREATED_EVENT, sameBoardPath } from './boardFiles';

export interface BoardResourceTabProps {
  path: string;
  name: string;
  /** Nested tabs stay mounted while hidden; only the active one owns keyboard focus hints. */
  active?: boolean;
  /** Wiki-link text that opens this board from a Markdown note. */
  referenceText?: string;
}

/** Workbench tab for a `*.a4board` file opened from the notes file tree or a wiki link. */
export function BoardResourceTab({ path, name, active = true, referenceText }: BoardResourceTabProps) {
  // A tab restored for a file that no longer exists shows the read error; re-creating the file (新建白板 with the
  // same name) or pressing 重试 re-reads it instead of leaving a stale error behind the fresh file.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const onCreated = (event: Event) => {
      const created = (event as CustomEvent<{ path?: string }>).detail?.path;
      if (created && sameBoardPath(created, path)) setAttempt(value => value + 1);
    };
    window.addEventListener(BOARD_FILE_CREATED_EVENT, onCreated);
    return () => window.removeEventListener(BOARD_FILE_CREATED_EVENT, onCreated);
  }, [path]);
  return <BoardEditor key={attempt} path={path} name={name} active={active} referenceText={referenceText ?? `[[${name}]]`} onRetry={() => setAttempt(value => value + 1)} />;
}
