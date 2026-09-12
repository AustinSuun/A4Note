import { FileQuestionMark } from 'lucide-react';
import { useEffect, useState } from 'react';
import { readTextFilePreview, type TextFilePreview } from '../../platform/projects';
import { zh } from '../../ui/zh';

export interface FileTabProps {
  path: string;
  name: string;
}

/** A generic file tab previews text and gives binary files a quiet, consistent fallback. */
export function FileTab({ path, name }: FileTabProps) {
  const [preview, setPreview] = useState<TextFilePreview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setPreview(null);
    readTextFilePreview(path)
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch(() => {
        if (!cancelled) setError(zh.workbench.filePreviewFailed);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const binaryPreview = !loading && !error && Boolean(preview?.binary);

  return (
    <section className="file-tab">
      <header className="file-tab-header">
        <span className="file-tab-kind-mark" aria-hidden="true"><FileQuestionMark size={20} strokeWidth={1.9} /></span>
        <div className="file-tab-identity">
          <h2>{name}</h2>
          <p className="file-tab-path" title={path}>
            {path}
          </p>
        </div>
      </header>
      <div className={binaryPreview ? 'file-tab-body unsupported' : 'file-tab-body'}>
        {loading && <p className="file-tab-hint">{zh.workbench.fileTreeLoading}</p>}
        {!loading && error && <p className="file-tab-hint error">{error}</p>}
        {binaryPreview && (
          <div className="file-tab-empty-state">
            <span className="file-tab-empty-icon" aria-hidden="true"><FileQuestionMark size={27} strokeWidth={1.7} /></span>
            <div className="file-tab-empty-copy">
              <strong>暂不支持预览</strong>
              <p>{zh.workbench.filePreviewBinary}</p>
            </div>
          </div>
        )}
        {!loading && !error && preview && !preview.binary && (
          <>
            <p className="file-tab-meta">
              {zh.workbench.fileSize(preview.byte_length)}
              {preview.truncated ? ` · ${zh.workbench.filePreviewTruncated}` : ''}
            </p>
            {preview.content ? <pre className="file-tab-preview">{preview.content}</pre> : <p className="file-tab-hint">{zh.workbench.filePreviewEmpty}</p>}
          </>
        )}
      </div>
    </section>
  );
}
