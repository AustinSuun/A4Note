import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (path) => readFileSync(path, 'utf8');
const hook = read('src/features/agents/useAgentProviders.ts');
assert.doesNotMatch(hook, /\buseEffect\b|\bsetTimeout\s*\(|\bsetInterval\s*\(/, 'CLI detection is manual, not a delayed startup effect');
assert.match(hook, /checked: false/);
assert.match(hook, /if \(inFlight.current\) return inFlight.current/);
assert.match(hook, /return \{ providers, loading, refresh \}/);
assert.match(read('src/ui/App.tsx'), /onRedetect=\{\(\) => void refreshAgentProviders\(\)\}/);
assert.match(read('src/features/agents/AgentSessionPanel.tsx'), /provider\?\.checked === false \? '尚未检测'/);
const database = read('src-tauri/src/database.rs');
assert.match(database, /if schema_is_current\(&connection\)\? \{ return Ok\(\(\)\); \}/);
assert.match(database, /TransactionBehavior::Immediate/);
assert.match(database, /hash.update\(schema_sql\(\).as_bytes\(\)\)/);
assert.match(database, /transaction.commit\(\)/);
assert.doesNotMatch(database, /synchronous\s*=\s*(OFF|0)|journal_mode\s*=\s*(OFF|MEMORY|WAL)/i, 'Do not weaken durability or change backup journal assumptions');
const guide = read('src-tauri/src/guide.rs');
assert.match(guide, /if guide_exists\(&connection\)\?/);
assert.match(guide, /create_new\(true\)/);
assert.doesNotMatch(guide, /UPDATE papers|UPDATE notes|ON CONFLICT.*DO UPDATE|fs::write\(/, 'Normal startup must not overwrite guide edits or existing PDFs');
assert.match(read('src-tauri/src/state_commands.rs'), /#\[tauri::command\(async\)\]\s*pub fn save_workbench_state/);
for (const path of ['library_papers', 'library_notes', 'library_annotations', 'library_ai']) {
  assert.match(read(`src-tauri/src/${path}.rs`), /prepare_cached\(/);
}
for (const index of ['paper_files_by_paper', 'notes_by_paper_updated', 'annotations_by_paper_created', 'ai_threads_by_paper_updated', 'papers_by_effective_folder']) {
  assert.ok(read('src-tauri/schema.sql').includes(`CREATE INDEX IF NOT EXISTS ${index}`));
}
console.log('Startup safety wiring passed (manual CLI, transactional schema ledger, indexed complete reads, nonwriting guide reopen, async workbench saves)');
