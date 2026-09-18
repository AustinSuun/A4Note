use super::*;
use std::{fs, path::PathBuf};
use rusqlite::params;

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("a4-summary-provision-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        crate::database::initialize_database(&root.join("aster.db")).unwrap();
        Self(root)
    }
    fn db(&self) -> Connection { Connection::open(self.0.join("aster.db")).unwrap() }
    fn paper(&self, id: &str) {
        self.db().execute("INSERT INTO papers(id,title,created_at,updated_at) VALUES (?1,?1,1,1)", [id]).unwrap();
    }
    fn notes(&self) -> i64 { self.db().query_row("SELECT COUNT(*) FROM notes", [], |r| r.get(0)).unwrap() }
}
impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
const TEMPLATE: &str = "# 总结筆记\n\n<!-- a4-summary:abstract -->\n## 主要功能\n\n<!-- /a4-summary:abstract -->\n";

#[test]
fn creates_old_and_new_missing_notes_once_with_atomic_outbox() {
    let f = Fixture::new(); f.paper("old");
    let first = provision_in_root(&f.0, TEMPLATE, None).unwrap();
    assert_eq!(first.created.len(), 1); assert!(first.failures.is_empty());
    let id = first.created[0].file.note_id.as_ref().unwrap();
    assert_eq!(first.created[0].file.content, TEMPLATE);
    assert_eq!(f.db().query_row("SELECT COUNT(*) FROM sync_outbox WHERE entity='note' AND entity_id=?1", [id], |r| r.get::<_, i64>(0)).unwrap(), 1);
    assert!(!f.0.join("files/papers/old/总结.md").exists());
    f.paper("new");
    let next = provision_in_root(&f.0, "different template", None).unwrap();
    assert_eq!(next.created.len(), 1); assert_eq!(next.preserved, 1); assert_eq!(f.notes(), 2);
    assert_eq!(library_summary_notes::bound(&f.db(), "old").unwrap().unwrap().note_id.as_ref(), Some(id));
    assert_eq!(library_summary_notes::bound(&f.db(), "old").unwrap().unwrap().content, TEMPLATE);
    assert_eq!(provision_in_root(&f.0, TEMPLATE, None).unwrap().created.len(), 0);
}

#[test]
fn keeps_legacy_summary_and_unrelated_notes_byte_for_byte() {
    let f = Fixture::new(); f.paper("legacy"); f.paper("ordinary");
    let path = f.0.join("files/papers/legacy/总结.md"); fs::create_dir_all(path.parent().unwrap()).unwrap();
    let text = "\u{feff}# 总结\r\nExisting 😀 ![](summary-assets/x.png)\r\n"; fs::write(&path, text).unwrap();
    crate::library_notes::upsert_note_in_database(&f.0.join("aster.db"), crate::library_notes::UpsertNoteRequest {
        paper_id: "ordinary".into(), note_id: Some("ordinary-note".into()), expected: None,
        title: "总结笔记".into(), content: "user text".into(),
    }).unwrap();
    let result = provision_in_root(&f.0, TEMPLATE, None).unwrap();
    assert_eq!(result.preserved, 1); assert_eq!(result.created.len(), 1); assert_eq!(f.notes(), 2);
    assert_eq!(fs::read_to_string(path).unwrap(), text);
    assert!(library_summary_notes::bound(&f.db(), "legacy").unwrap().is_none());
    assert_eq!(f.db().query_row("SELECT content FROM notes WHERE id='ordinary-note'", [], |r| r.get::<_, String>(0)).unwrap(), "user text");
}

#[test]
fn deleted_binding_is_reported_not_rebuilt_and_others_continue() {
    let f = Fixture::new(); f.paper("deleted");
    let first = provision_in_root(&f.0, TEMPLATE, None).unwrap();
    let id = first.created[0].file.note_id.as_ref().unwrap();
    crate::library_notes::delete_note_in_database(&f.0.join("aster.db"), id).unwrap(); f.paper("healthy");
    let result = provision_in_root(&f.0, TEMPLATE, None).unwrap();
    assert_eq!(result.failures.len(), 1); assert_eq!(result.failures[0].paper_id, "deleted");
    assert_eq!(result.created.len(), 1); assert_eq!(f.notes(), 2);
}

#[test]
fn failed_binding_rolls_back_note_and_outbox_then_retry_succeeds() {
    let f = Fixture::new(); f.paper("fails"); f.paper("works");
    f.db().execute_batch("CREATE TABLE paper_summary_notes(paper_id TEXT PRIMARY KEY, note_id TEXT UNIQUE); CREATE TRIGGER reject_one BEFORE INSERT ON paper_summary_notes WHEN NEW.paper_id='fails' BEGIN SELECT RAISE(ABORT,'injected failure'); END;").unwrap();
    let first = provision_in_root(&f.0, TEMPLATE, None).unwrap();
    assert_eq!(first.created.len(), 1); assert_eq!(first.failures.len(), 1); assert_eq!(f.notes(), 1);
    assert_eq!(f.db().query_row("SELECT COUNT(*) FROM sync_outbox WHERE entity='note'", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
    f.db().execute_batch("DROP TRIGGER reject_one").unwrap();
    assert_eq!(provision_in_root(&f.0, TEMPLATE, None).unwrap().created.len(), 1); assert_eq!(f.notes(), 2);
}

#[test]
fn paginates_without_losing_failed_or_later_inserted_rows() {
    let f = Fixture::new();
    for i in 0..53 { f.paper(&format!("p{i:03}")); }
    let a = provision_in_root(&f.0, TEMPLATE, None).unwrap(); assert_eq!(a.scanned, 50);
    let b = provision_in_root(&f.0, TEMPLATE, a.next_after.as_deref()).unwrap();
    assert_eq!(b.scanned, 3); assert!(b.next_after.is_none()); assert_eq!(f.notes(), 53);
    f.paper("a-late-import");
    let c = provision_in_root(&f.0, TEMPLATE, None).unwrap(); assert_eq!(c.created.len(), 1);
}

#[test]
fn concurrent_calls_share_one_binding_and_outbox() {
    let f = Fixture::new(); f.paper("p");
    let root = f.0.clone(); let a = std::thread::spawn(move || provision_in_root(&root, TEMPLATE, None).unwrap());
    let root = f.0.clone(); let b = std::thread::spawn(move || provision_in_root(&root, TEMPLATE, None).unwrap());
    let a = a.join().unwrap(); let b = b.join().unwrap();
    assert!(a.failures.is_empty() && b.failures.is_empty()); assert_eq!(a.created.len() + b.created.len(), 1);
    assert_eq!(f.notes(), 1);
}

#[test]
fn rejects_bad_templates_and_unsafe_paths_without_writes() {
    let f = Fixture::new(); f.paper("../escape"); f.paper("valid");
    assert!(provision_in_root(&f.0, "\0", None).is_err());
    assert!(provision_in_root(&f.0, &"x".repeat(2 * 1024 * 1024 + 1), None).is_err()); assert_eq!(f.notes(), 0);
    let result = provision_in_root(&f.0, TEMPLATE, None).unwrap();
    assert_eq!(result.failures.len(), 1); assert_eq!(result.created.len(), 1);
}

#[test]
fn missing_parent_and_cross_paper_binding_never_create_a_replacement() {
    let f = Fixture::new(); f.paper("one"); f.paper("two");
    let result = provision_in_root(&f.0, TEMPLATE, None).unwrap();
    let one = result.created.iter().find(|n| n.paper_id == "one").unwrap().file.note_id.as_ref().unwrap();
    f.db().execute("UPDATE notes SET paper_id='two' WHERE id=?1", params![one]).unwrap();
    let result = provision_in_root(&f.0, TEMPLATE, None).unwrap();
    assert_eq!(result.failures.len(), 1); assert_eq!(result.created.len(), 0); assert_eq!(f.notes(), 2);
    assert!(ensure_missing(&f.0, "missing", TEMPLATE).is_err()); assert_eq!(f.notes(), 2);
}
