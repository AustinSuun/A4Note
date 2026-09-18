import { useEffect, useState } from 'react';
import { readerSaveErrorEvent } from './readerSaveErrors';
import './reader-reliability.css';
/** Paper-scoped feedback also covers sidebar/toolbar and keyboard mutations outside PdfReader. */
export function ReaderSaveErrorNotice({ paperId }: { paperId: string }) {
  const [message, setMessage] = useState('');
  useEffect(() => {
    setMessage('');
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<{ paperId: string; message: string }>).detail;
      if (detail?.paperId === paperId) setMessage(detail.message);
    };
    window.addEventListener(readerSaveErrorEvent, receive);
    return () => window.removeEventListener(readerSaveErrorEvent, receive);
  }, [paperId]);
  return message ? <div className="reader-global-save-error reader-save-feedback" role="alert"><span>{message}。请检查存储权限后重试原操作；未确认保存成功。</span><button type="button" onClick={() => setMessage('')}>关闭提示</button></div> : null;
}
