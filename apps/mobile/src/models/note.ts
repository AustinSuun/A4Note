export interface Note {
  id: string;
  paperId: string | null;
  title: string;
  content: string;
  format: 'markdown';
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  serverVersion: number;
  syncState: 'synced' | 'pending' | 'conflict' | 'failed';
}

export interface NoteSummary {
  id: string;
  paperId: string | null;
  title: string;
  preview: string;
  updatedAt: string;
  syncState: Note['syncState'];
}

export interface PaperSummary {
  id: string;
  title: string;
  authors: string;
  year?: number;
  venue?: string;
}

