import { FileCode2, FileImage, FileQuestionMark } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { readFileBytes, readTextFilePreview, type TextFilePreview } from '../../platform/projects';
import { zh } from '../../ui/zh';
import {
  HTML_PREVIEW_MAX_BYTES,
  HTML_PREVIEW_SANDBOX,
  IMAGE_PREVIEW_MAX_BYTES,
  decodeHtmlBytes,
  fileBaseName,
  filePreviewKind,
  isSvgPath,
  readHtmlViewMode,
  writeHtmlViewMode,
  type HtmlViewMode,
} from './filePreview';
import { buildHtmlPreviewDocument } from './htmlPreviewDocument';
import { loadNoteImage } from './noteImageLoader';
import './file-tab-preview.css';

export interface FileTabProps {
  path: string;
  name: string;
}

type ImageFit = 'fit' | 'actual';

/**
 * A generic file tab: images are shown as images, HTML is rendered in a fully
 * sandboxed frame (with a source view), other text is shown as text and
 * binary files get a quiet, consistent fallback. Opening a file never writes it.
 */
export function FileTab({ path, name }: FileTabProps) {
  const kind = filePreviewKind(path);
  // The loaded result is keyed by path: right after a switch the previous file's
  // result must not drive the new file's preview (or trigger reads for it).
  const [loaded, setLoaded] = useState<{ path: string; preview?: TextFilePreview; error?: string } | null>(null);
  // View state is keyed by path so a stale value never leaks into another file.
  const [htmlMode, setHtmlMode] = useState<{ path: string; mode: HtmlViewMode } | null>(null);
  const [imageFit, setImageFit] = useState<{ path: string; fit: ImageFit } | null>(null);
  const [imageSize, setImageSize] = useState<{ path: string; width: number; height: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    readTextFilePreview(path)
      .then((result) => {
        if (!cancelled) setLoaded({ path, preview: result });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ path, error: zh.workbench.filePreviewFailed });
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const current = loaded?.path === path ? loaded : null;
  const loading = current === null;
  const error = current?.error ?? '';
  const preview = current?.preview ?? null;
  const mode = htmlMode?.path === path ? htmlMode.mode : readHtmlViewMode(path);
  const fit = imageFit?.path === path ? imageFit.fit : 'fit';
  const size = imageSize?.path === path ? imageSize : null;
  const ready = !loading && !error && preview !== null;
  const binaryPreview = ready && Boolean(preview.binary) && kind !== 'image';
  const renderedHtml = ready && kind === 'html' && !preview.binary;
  const chooseMode = (next: HtmlViewMode) => {
    setHtmlMode({ path, mode: next });
    writeHtmlViewMode(path, next);
  };

  const source = (note?: ReactNode) => preview && (
    <>
      <p className="file-tab-meta">
        {note}
        <span>{zh.workbench.fileSize(preview.byte_length)}</span>
        {preview.truncated && <span>{zh.workbench.filePreviewTruncated}</span>}
      </p>
      {preview.content ? <pre className="file-tab-preview">{preview.content}</pre> : <p className="file-tab-hint">{zh.workbench.filePreviewEmpty}</p>}
    </>
  );

  let body: ReactNode = null;
  let bodyClass = 'file-tab-body';
  if (binaryPreview) {
    bodyClass += ' unsupported';
    body = (
      <div className="file-tab-empty-state">
        <span className="file-tab-empty-icon" aria-hidden="true"><FileQuestionMark size={27} strokeWidth={1.7} /></span>
        <div className="file-tab-empty-copy">
          <strong>暂不支持预览</strong>
          <p>{zh.workbench.filePreviewBinary}</p>
        </div>
      </div>
    );
  } else if (ready && kind === 'image') {
    bodyClass += ' file-tab-body-stacked';
    body = (
      <ImagePreview
        key={path}
        path={path}
        byteLength={preview.byte_length}
        fit={fit}
        size={size}
        onSize={(width, height) => setImageSize({ path, width, height })}
        svgSource={isSvgPath(path) ? (message) => source(<span className="file-tab-notice">{message} {zh.workbench.svgPreviewSourceBelow}</span>) : undefined}
      />
    );
  } else if (renderedHtml && mode === 'preview') {
    bodyClass += ' file-tab-body-stacked';
    body = <HtmlPreview key={path} path={path} name={name} byteLength={preview.byte_length} fallback={(message) => source(<span className="file-tab-notice">{message}</span>)} />;
  } else if (ready) {
    body = source();
  }

  const HeaderIcon = kind === 'image' ? FileImage : kind === 'html' ? FileCode2 : FileQuestionMark;

  return (
    <section className="file-tab" data-preview-kind={kind}>
      <header className="file-tab-header">
        <span className="file-tab-kind-mark" aria-hidden="true"><HeaderIcon size={20} strokeWidth={1.9} /></span>
        <div className="file-tab-identity">
          <h2>{name}</h2>
          <p className="file-tab-path" title={path}>
            {path}
          </p>
        </div>
        {renderedHtml && (
          <Segmented
            label={zh.workbench.filePreviewViewMode}
            value={mode}
            options={[['preview', zh.workbench.filePreviewModePreview], ['source', zh.workbench.filePreviewModeSource]]}
            onChange={chooseMode}
          />
        )}
        {ready && kind === 'image' && (
          <Segmented
            label={zh.workbench.filePreviewViewMode}
            value={fit}
            options={[['fit', zh.workbench.imagePreviewFit], ['actual', zh.workbench.imagePreviewActual]]}
            onChange={(next) => setImageFit({ path, fit: next })}
          />
        )}
      </header>
      <div className={bodyClass}>
        {loading && <p className="file-tab-hint">{zh.workbench.fileTreeLoading}</p>}
        {!loading && error && <p className="file-tab-hint error">{error}</p>}
        {body}
      </div>
    </section>
  );
}

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<[T, string]>; onChange: (value: T) => void }) {
  return (
    <div className="file-tab-segmented" role="group" aria-label={label}>
      {options.map(([option, text]) => (
        <button key={option} type="button" aria-pressed={value === option} className={value === option ? 'active' : ''} onClick={() => onChange(option)}>
          {text}
        </button>
      ))}
    </div>
  );
}

interface ImagePreviewProps {
  path: string;
  byteLength: number;
  fit: ImageFit;
  size: { width: number; height: number } | null;
  onSize: (width: number, height: number) => void;
  /** SVG is text: when it cannot be shown as an image, fall back to its source. */
  svgSource?: (message: string) => ReactNode;
}

function ImagePreview({ path, byteLength, fit, size, onSize, svgSource }: ImagePreviewProps) {
  const [url, setUrl] = useState('');
  const [failure, setFailure] = useState('');

  useEffect(() => {
    let cancelled = false;
    setUrl('');
    setFailure('');
    if (byteLength > IMAGE_PREVIEW_MAX_BYTES) {
      setFailure(zh.workbench.imagePreviewTooLarge(zh.workbench.fileSize(byteLength), zh.workbench.fileSize(IMAGE_PREVIEW_MAX_BYTES)));
      return;
    }
    if (byteLength === 0) {
      setFailure(zh.workbench.filePreviewEmpty);
      return;
    }
    // Same validation, MIME whitelist and size cap as Markdown's local images.
    loadNoteImage(path, encodeURIComponent(fileBaseName(path)))
      .then((dataUrl) => {
        if (!cancelled) setUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setFailure(zh.workbench.imagePreviewReadFailed);
      });
    return () => {
      cancelled = true;
    };
  }, [path, byteLength]);

  if (failure) {
    if (svgSource) return <>{svgSource(failure)}</>;
    return (
      <div className="file-tab-preview-message" role="status">
        <span className="file-tab-empty-icon" aria-hidden="true"><FileImage size={27} strokeWidth={1.7} /></span>
        <p>{failure}</p>
        <p className="file-tab-preview-message-meta">{zh.workbench.fileSize(byteLength)}</p>
      </div>
    );
  }
  return (
    <>
      <p className="file-tab-meta">
        <span>{zh.workbench.fileSize(byteLength)}</span>
        {size && <span>{zh.workbench.imagePreviewDimensions(size.width, size.height)}</span>}
      </p>
      <div className={`file-tab-image-stage ${fit}`}>
        {url ? (
          <img
            src={url}
            alt={fileBaseName(path)}
            draggable={false}
            onLoad={(event) => onSize(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)}
            onError={() => setFailure(zh.workbench.imagePreviewDecodeFailed)}
          />
        ) : (
          <p className="file-tab-hint">{zh.workbench.fileTreeLoading}</p>
        )}
      </div>
    </>
  );
}

interface HtmlPreviewProps {
  path: string;
  name: string;
  byteLength: number;
  /** Source view with a notice, used whenever the page cannot be rendered safely or reliably. */
  fallback: (message: string) => ReactNode;
}

interface PreparedHtml {
  srcdoc: string;
  encoding: string;
  declared: boolean;
  blockedImages: number;
}

function HtmlPreview({ path, name, byteLength, fallback }: HtmlPreviewProps) {
  const [prepared, setPrepared] = useState<PreparedHtml | null>(null);
  const [failure, setFailure] = useState('');

  useEffect(() => {
    let cancelled = false;
    setPrepared(null);
    setFailure('');
    if (byteLength > HTML_PREVIEW_MAX_BYTES) {
      setFailure(zh.workbench.htmlPreviewTooLarge(zh.workbench.fileSize(byteLength), zh.workbench.fileSize(HTML_PREVIEW_MAX_BYTES)));
      return;
    }
    readFileBytes(path)
      .then(async (raw) => {
        const decoded = decodeHtmlBytes(Uint8Array.from(raw));
        if (!decoded.ok) {
          if (!cancelled) setFailure(decoded.declared ? zh.workbench.htmlPreviewUnknownEncoding(decoded.declared) : zh.workbench.htmlPreviewUndeclaredEncoding);
          return;
        }
        const document = await buildHtmlPreviewDocument(decoded.text, path);
        if (!cancelled) setPrepared({ srcdoc: document.srcdoc, encoding: decoded.encoding, declared: decoded.declared, blockedImages: document.images.blocked });
      })
      .catch(() => {
        if (!cancelled) setFailure(zh.workbench.filePreviewFailed);
      });
    return () => {
      cancelled = true;
    };
  }, [path, byteLength]);

  if (failure) return <>{fallback(failure)}</>;
  if (!prepared) return <p className="file-tab-hint file-tab-stacked-hint">{zh.workbench.fileTreeLoading}</p>;
  return (
    <>
      <p className="file-tab-meta">
        <span className="file-tab-safe-note">{zh.workbench.htmlPreviewSafeNote}</span>
        <span>{zh.workbench.fileSize(byteLength)}</span>
        {prepared.encoding !== 'utf-8' && <span>{zh.workbench.htmlPreviewDecodedAs(prepared.encoding)}</span>}
        {prepared.blockedImages > 0 && <span>{zh.workbench.htmlPreviewImagesBlocked(prepared.blockedImages)}</span>}
      </p>
      <iframe
        className="file-tab-html-frame"
        title={zh.workbench.htmlPreviewFrameTitle(name)}
        sandbox={HTML_PREVIEW_SANDBOX}
        referrerPolicy="no-referrer"
        srcDoc={prepared.srcdoc}
      />
    </>
  );
}
