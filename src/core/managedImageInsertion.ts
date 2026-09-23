/** A write-then-insert transaction. No filesystem, editor or browser dependencies. */
export interface ImageInsertionTarget<Scope> {
  /** Stable document/session identity, not a display title. */
  scope: Scope;
  /** Monotonic epoch: advance for edits, selection changes, undo and document switches. */
  epoch: number;
  from: number;
  to: number;
}

export function managedImageMarkdown(reference: string, alt = '图片'): string {
  // Backend returns an unencoded portable path, never a URL or an absolute path.
  const parts = reference.split('/');
  if (parts.length !== 2 || parts.some(part => !part || part === '.' || part === '..' || /[\\:<>\u0000-\u001f\u007f]/u.test(part)) ||
      !/\.assets$|^(?:summary|note)-assets$/u.test(parts[0]) || !/^[a-zA-Z0-9-]+\.(?:png|jpe?g|webp)$/u.test(parts[1])) {
    throw new Error('图片写入结果不是安全的托管相对路径，未修改正文。');
  }
  const label = alt.replace(/[\r\n\u0000-\u001f\u007f]/gu, ' ').replace(/[\\\[\]]/gu, '\\$&');
  return `![${label}](<${parts.map(part => encodeURIComponent(part)).join('/')}>)`;
}

/**
 * Import callbacks must resolve only after durable, validated asset creation.
 * A stale transaction may leave an unreferenced asset, but must never delete it:
 * other documents can already reference it. Cleanup needs a separate reference audit.
 */
export class ManagedImageInsertion<Scope, Image> {
  private pending = false;

  isPending(): boolean { return this.pending; }

  async insert(options: {
    images: readonly Image[];
    text?: string;
    current: () => ImageInsertionTarget<Scope> | null;
    write: (scope: Scope, image: Image) => Promise<{ reference: string; alt?: string }>;
    /** Must apply one synchronous editor transaction, including any mixed plain text. */
    commit: (target: ImageInsertionTarget<Scope>, markdown: string) => void;
  }): Promise<void> {
    if (this.pending) throw new Error('正在保存图片，请稍后重试；正文未修改。');
    if (!options.images.length || options.images.length > 8) throw new Error('一次可插入1至8张图片。');
    const current = options.current();
    if (!current) throw new Error('当前文档不可编辑，请先打开并保存文档。');
    const target = { ...current };
    const valid = () => {
      const next = options.current();
      return next !== null && next.scope === target.scope && next.epoch === target.epoch && next.from === target.from && next.to === target.to;
    };
    this.pending = true;
    try {
      const references: string[] = [];
      for (const image of options.images) {
        if (!valid()) throw new Error('文档或插入位置已变化，未插入图片引用，请重新粘贴。');
        const result = await options.write(target.scope, image);
        references.push(managedImageMarkdown(result.reference, result.alt));
      }
      if (!valid()) throw new Error('文档或插入位置已变化，未插入图片引用，请重新粘贴。');
      const prefix = options.text ? options.text + (options.text.endsWith('\n') ? '' : '\n') : '';
      options.commit(target, prefix + references.join('\n') + '\n');
    } finally { this.pending = false; }
  }
}
