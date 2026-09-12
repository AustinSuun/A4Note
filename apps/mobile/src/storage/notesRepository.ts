import type { Note, NoteSummary, PaperSummary } from '../models/note';
import { fixturePapers } from '../data/fixtures';

const NOTES_KEY = '@a4note/mobile/notes-v1';

export interface StorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface NotesRepository {
  listNotes(query?: string): Promise<NoteSummary[]>;
  getNote(id: string): Promise<Note | null>;
  saveNote(note: Note): Promise<Note>;
  listPapers(): Promise<PaperSummary[]>;
}

export function createLocalNotesRepository(storage: StorageAdapter, seed: Note[]): NotesRepository {
  let cache: Note[] | null = null;

  async function load(): Promise<Note[]> {
    if (cache) return cache;
    const raw = await storage.getItem(NOTES_KEY);
    if (!raw) {
      cache = seed;
      await storage.setItem(NOTES_KEY, JSON.stringify(seed));
      return cache;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      cache = Array.isArray(parsed) ? parsed as Note[] : seed;
    } catch {
      cache = seed;
    }
    return cache;
  }

  async function persist(notes: Note[]) {
    cache = notes;
    await storage.setItem(NOTES_KEY, JSON.stringify(notes));
  }

  return {
    async listNotes(query = '') {
      const normalized = query.trim().toLocaleLowerCase();
      const notes = (await load()).filter((note) => !note.deletedAt).filter((note) => {
        if (!normalized) return true;
        return `${note.title}\n${note.content}`.toLocaleLowerCase().includes(normalized);
      });
      return notes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(toSummary);
    },
    async getNote(id) {
      return (await load()).find((note) => note.id === id && !note.deletedAt) ?? null;
    },
    async saveNote(note) {
      const current = await load();
      const updated: Note = {
        ...note,
        updatedAt: new Date().toISOString(),
        syncState: note.syncState === 'conflict' ? 'conflict' : 'pending',
      };
      const index = current.findIndex((item) => item.id === note.id);
      if (index < 0) await persist([...current, updated]);
      else await persist(current.map((item, itemIndex) => itemIndex === index ? updated : item));
      return updated;
    },
    async listPapers() {
      return fixturePapers;
    },
  };
}

function toSummary(note: Note): NoteSummary {
  return {
    id: note.id,
    paperId: note.paperId,
    title: note.title,
    preview: note.content.replace(/^#+\s*/gm, '').replace(/[*_`>-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120),
    updatedAt: note.updatedAt,
    syncState: note.syncState,
  };
}

