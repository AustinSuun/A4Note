/** Shared ingestion contract. No React, browser or native dependencies. */
export type CaptureOrigin = 'browser' | 'local_pdf';
export type ArtifactRole = 'fulltext' | 'supplement' | 'citation' | 'dataset' | 'code';
export type ArtifactState = 'discovered' | 'queued' | 'downloading' | 'verified' | 'needs_user' | 'failed';
export interface CaptureAuthor {
  name: string;
  affiliations: string[];
  orcid?: string;
}
export interface FieldEvidence {
  field: string;
  value: unknown;
  source: string;
  method: string;
  capturedAt: string;
}
export interface CaptureMetadata {
  title: string;
  authors: CaptureAuthor[];
  abstract?: string;
  keywords: string[];
  identifiers: { doi?: string; arxiv?: string; pmcid?: string; pmid?: string; arxivVersion?: string };
  publication: {
    venue?: string; publisher?: string; volume?: string; issue?: string;
    firstPage?: string; lastPage?: string; issn?: string;
  };
  dates: { online?: string; published?: string; print?: string; submitted?: string; revised?: string; modified?: string };
}
export interface CaptureArtifact {
  id: string;
  role: ArtifactRole;
  url?: string;
  label: string;
  state: ArtifactState;
  version: 'published' | 'preprint' | 'accepted' | 'unknown';
  /** Assigned by trusted native code; never accept an arbitrary browser path. */
  storedPath?: string;
  sha256?: string;
  byteLength?: number;
}
export interface CaptureEnvelope {
  schemaVersion: 1;
  captureId: string;
  origin: CaptureOrigin;
  capturedAt: string;
  sourceUrl?: string;
  /** Library classification ID, not a path. Omitted only by legacy/local captures. */
  targetFolderId?: string;
  metadata: CaptureMetadata;
  evidence: FieldEvidence[];
  artifacts: CaptureArtifact[];
  raw: { meta: { name: string; content: string }[] };
  warnings: string[];
}
export type CaptureTaskState = 'queued' | 'resolving' | 'downloading' | 'verifying' | 'complete' | 'partial' | 'needs_user' | 'failed' | 'cancelled';
/** Separate from download state: a verified download is not yet a library import. */
export interface CaptureLibraryLink {
  captureId: string;
  paperId?: string;
  state: 'pending' | 'linked' | 'conflict' | 'failed';
  artifactFileIds: Record<string, string>;
  error?: string;
}
