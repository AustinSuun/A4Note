import type { PaperDocument } from './types';

export interface DocumentRepository {
  load(): PaperDocument[] | null;
  save(documents: PaperDocument[]): void;
}

export class LocalDocumentRepository implements DocumentRepository {
  constructor(private readonly storageKey = 'aster.documents') {}

  load() {
    const raw = localStorage.getItem(this.storageKey);
    return raw ? (JSON.parse(raw) as PaperDocument[]) : null;
  }

  save(documents: PaperDocument[]) {
    localStorage.setItem(this.storageKey, JSON.stringify(documents));
  }
}
