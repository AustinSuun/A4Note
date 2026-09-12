CREATE TABLE IF NOT EXISTS papers (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  authors TEXT,
  year INTEGER,
  venue TEXT,
  doi TEXT,
  url TEXT,
  abstract TEXT,
  status TEXT DEFAULT 'unread',
  is_favorite INTEGER NOT NULL DEFAULT 0,
  last_viewed_at INTEGER,
  rating INTEGER,
  folder_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS paper_files (
  id TEXT PRIMARY KEY,
  paper_id TEXT NOT NULL,
  type TEXT NOT NULL,
  path TEXT NOT NULL,
  language TEXT,
  content_hash TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  paper_id TEXT NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'markdown',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  server_version INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER,
  FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE
);

-- SYNC-S2: local-first note synchronization metadata. These tables deliberately
-- remain device-local; the server owns the canonical note versions and cursor.
CREATE TABLE IF NOT EXISTS sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  device_id TEXT NOT NULL,
  cursor TEXT NOT NULL DEFAULT '0',
  last_success_at INTEGER,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS sync_outbox (
  operation_id TEXT PRIMARY KEY,
  entity TEXT NOT NULL CHECK (entity = 'note'),
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),
  base_version INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  retry_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sync_outbox_ready
  ON sync_outbox (state, next_retry_at, created_at);

CREATE TABLE IF NOT EXISTS sync_conflicts (
  operation_id TEXT PRIMARY KEY,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  server_version INTEGER NOT NULL,
  server_payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS annotations (
  id TEXT PRIMARY KEY,
  paper_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  page INTEGER NOT NULL,
  type TEXT NOT NULL,
  quote TEXT,
  comment TEXT,
  color TEXT,
  position_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE,
  FOREIGN KEY (file_id) REFERENCES paper_files(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS resource_annotations (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  page INTEGER NOT NULL,
  type TEXT NOT NULL,
  quote TEXT,
  comment TEXT,
  color TEXT,
  position_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_threads (
  id TEXT PRIMARY KEY,
  paper_id TEXT,
  title TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS ai_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES ai_threads(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS paper_tags (
  paper_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (paper_id, tag_id),
  FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE
);

-- PWS-1: workbench state. Timestamps are ISO-8601 TEXT because the frontend
-- model in src/core/workspace.ts stores them as ISO strings, unlike the
-- millisecond INTEGER columns used by the older library tables.

CREATE TABLE IF NOT EXISTS workbench_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL,
  active_project_id TEXT,
  active_workspace_id TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_opened_at TEXT
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  active_tab_id TEXT,
  file_tree_visible INTEGER NOT NULL DEFAULT 0,
  right_drawer_visible INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workspace_tabs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  tab_key TEXT NOT NULL,
  title TEXT NOT NULL,
  resource_id TEXT,
  session_id TEXT,
  state_json TEXT NOT NULL DEFAULT '{}',
  pinned INTEGER NOT NULL DEFAULT 0,
  tab_order INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS workspace_tabs_workspace_order
  ON workspace_tabs (workspace_id, tab_order);

-- RES-2: one record per thing a tab can point at. `uri` is always the output of
-- the frontend's `normalizeResourceUri`, and dedup by `resourceKey(uri)` stays a
-- model responsibility — so the index here is deliberately not UNIQUE, and a
-- model bug degrades into a duplicate row instead of a failed save.
CREATE TABLE IF NOT EXISTS resources (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  kind TEXT NOT NULL,
  uri TEXT NOT NULL,
  title TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS resources_uri ON resources (uri);

CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  provider_session_id TEXT,
  model_id TEXT,
  permission_mode TEXT NOT NULL,
  status TEXT NOT NULL,
  working_directory TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

-- CLI-4: one row per exchange, because the frontend's unit is a turn
-- (`AgentTurn` = the prompt plus the run opened for it), not a chat bubble.
-- Splitting one exchange into two rows would invent a pairing key the model
-- does not have. `seq` numbers the turns of one session from 0 and is the row's
-- identity together with `session_id`, so a streaming answer updates in place.
--
-- Deliberately NOT a foreign key on agent_sessions: the workbench snapshot
-- rewrites that whole table inside one transaction, so ON DELETE CASCADE would
-- erase every conversation on a tab drag. Rows whose session is really gone are
-- swept by `agent_history::prune_orphans` from inside that same transaction.
CREATE TABLE IF NOT EXISTS agent_messages (
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  run_id TEXT NOT NULL,
  status TEXT NOT NULL,
  answer TEXT NOT NULL DEFAULT '',
  tool_payloads_json TEXT NOT NULL DEFAULT '[]',
  error_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (session_id, seq)
);

-- STARTUP-1: additive, private migration ledger. Do not reuse user_version,
-- which may belong to another tool. A schema-content key also detects restores.
CREATE TABLE IF NOT EXISTS aster_schema_migrations (
  schema_key TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

-- Preserve query/data contracts; index per-paper reads rather than truncating
-- notes or annotations. paper_files keeps rowid order for legacy LIMIT 1 reads.
CREATE INDEX IF NOT EXISTS paper_files_by_paper ON paper_files (paper_id);
CREATE INDEX IF NOT EXISTS notes_by_paper_updated ON notes (paper_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS annotations_by_paper_created ON annotations (paper_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_threads_by_paper_updated ON ai_threads (paper_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS papers_by_effective_folder ON papers (COALESCE(folder_id, 'library'));

-- Capture snapshots are immutable evidence, not replacements for user-edited papers.
CREATE TABLE IF NOT EXISTS paper_capture_records (
  capture_id TEXT PRIMARY KEY,
  paper_id TEXT,
  envelope_json TEXT NOT NULL,
  file_map_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS paper_capture_by_paper ON paper_capture_records(paper_id,created_at);
-- Keep only a tombstone after deletion so retrying an old capture cannot resurrect it.
CREATE TRIGGER IF NOT EXISTS paper_capture_deleted AFTER DELETE ON papers BEGIN
  UPDATE paper_capture_records SET paper_id=NULL,envelope_json='{}',file_map_json='{}' WHERE paper_id=OLD.id;
END;
