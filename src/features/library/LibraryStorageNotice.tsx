import { useEffect, useState } from 'react';
import { dismissLibraryStoragePrompt, getLibraryStorage, setLibraryFilesRoot, type LibraryStorageInfo } from '../../platform/nativeApi';
import { Button } from '../../shared/ui';
import './library-storage-notice.css';

/** One-time nudge (task 6557dc15): move PDFs and translations off the system drive
 *  before the first import or capture. Shown only while the default root is in use,
 *  a better drive exists and the user has not dismissed it. */
export function LibraryStorageNotice() {
  const [info, setInfo] = useState<LibraryStorageInfo | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    getLibraryStorage().then((value) => { if (active) setInfo(value); }).catch(() => { /* not available outside Tauri */ });
    return () => { active = false; };
  }, []);

  if (hidden || !info || info.isCustom || info.promptDismissed || !info.recommendedRoot) return null;

  const useRecommended = async () => {
    setBusy(true);
    setMessage('正在切换存储位置并迁移现有文件…');
    try {
      const report = await setLibraryFilesRoot(info.recommendedRoot, true);
      setMessage(`已改为 ${report.filesRoot}${report.filesMoved ? `，迁移了 ${report.filesMoved} 个文件` : ''}。`);
      setInfo(await getLibraryStorage());
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };

  const keepDefault = async () => {
    try {
      await dismissLibraryStoragePrompt();
    } catch {
      /* dismissing is best-effort; the notice still goes away for this session */
    }
    setHidden(true);
  };

  return (
    <section className="library-storage-notice" id="library-storage-notice" role="status" aria-live="polite">
      <div className="library-storage-notice-copy">
        <strong>把 PDF 与译文放到系统盘之外</strong>
        <p>
          资料库文件目前保存在 <code>{info.filesRoot}</code>{info.onSystemDrive ? '（系统盘）' : ''}。
          建议改到 <code>{info.recommendedRoot}</code>：之后浏览器采集的 PDF、译文与附件都会保存到那里，不再占用 C 盘。
          随时可在「设置 → 资料库 → 文件存储位置」更改。
        </p>
        {message ? <p className="library-storage-notice-message">{message}</p> : null}
      </div>
      <div className="library-storage-notice-actions">
        <Button id="library-storage-notice-accept" variant="primary" size="compact" disabled={busy} onClick={() => void useRecommended()}>使用推荐位置</Button>
        <Button id="library-storage-notice-dismiss" size="compact" disabled={busy} onClick={() => void keepDefault()}>保持默认，不再提示</Button>
      </div>
    </section>
  );
}
