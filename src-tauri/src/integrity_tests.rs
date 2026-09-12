//! Real SQLite + disposable filesystem regressions, never the user's library.
use crate::database::initialize_database;
use crate::library_import::{
    import_pdf_into_root, import_translation_into_root, ImportPdfRequest, ImportTranslationRequest,
};
use crate::library_notes::{delete_note_in_database, upsert_note_in_database, UpsertNoteRequest};
use crate::library_papers::list_papers_in_database;
use rusqlite::{params, Connection};
use std::{fs, path::PathBuf};
use uuid::Uuid;
struct Fixture {
    root: PathBuf,
    db: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("a4note-integrity-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let db = root.join("aster.db");
        initialize_database(&db).unwrap();
        Self { root, db }
    }
    fn paper(&self, id: &str) {
        Connection::open(&self.db)
            .unwrap()
            .execute(
                "INSERT INTO papers(id,title,created_at,updated_at) VALUES (?1,?1,1,1)",
                params![id],
            )
            .unwrap();
    }
    fn note(&self, owner: &str, id: &str, content: &str) -> Result<String, String> {
        upsert_note_in_database(
            &self.db,
            UpsertNoteRequest {
                expected: None,
                paper_id: owner.into(),
                note_id: Some(id.into()),
                title: "Note".into(),
                content: content.into(),
            },
        )
    }
    fn request(&self, id: &str, bytes: &[u8]) -> ImportPdfRequest {
        let source = self.root.join(format!("input-{}.pdf", Uuid::new_v4()));
        fs::write(&source, bytes).unwrap();
        ImportPdfRequest {
            original_path: source.to_string_lossy().into(),
            paper_id: Some(id.into()),
            title: id.into(),
            authors: "".into(),
            year: None,
            venue: "".into(),
            doi: "".into(),
            tags: vec![],
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}
#[test]
fn integrity_deleted_notes_hidden_but_tombstones_and_sync_survive() {
    let f = Fixture::new();
    f.paper("p");
    f.note("p", "n", "deleted unique secret").unwrap();
    f.note("p", "live", "live body").unwrap();
    let c = Connection::open(&f.db).unwrap();
    c.execute("UPDATE notes SET server_version=7 WHERE id='n'", [])
        .unwrap();
    delete_note_in_database(&f.db, "n").unwrap();
    let papers = list_papers_in_database(&f.db).unwrap();
    assert_eq!(papers[0].notes.len(), 1);
    assert_eq!(papers[0].notes[0].id, "live");
    assert!(!serde_json::to_string(&papers)
        .unwrap()
        .contains("deleted unique secret"));
    let row: (String, i64) = c
        .query_row(
            "SELECT content,deleted_at FROM notes WHERE id='n'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(row.0, "deleted unique secret");
    assert!(row.1 > 0);
    let op: (String, i64, String) = c
        .query_row(
            "SELECT operation,base_version,operation_id FROM sync_outbox WHERE entity_id='n'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(op.0, "delete");
    assert_eq!(op.1, 7);
    delete_note_in_database(&f.db, "n").unwrap();
    delete_note_in_database(&f.db, "missing").unwrap();
    let unchanged: String = c
        .query_row(
            "SELECT operation_id FROM sync_outbox WHERE entity_id='n'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(unchanged, op.2);
    assert_eq!(
        c.query_row(
            "SELECT count(*) FROM sync_outbox WHERE entity_id='missing'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
}
#[test]
fn integrity_stale_or_foreign_note_saves_cannot_resurrect_or_reassign() {
    let f = Fixture::new();
    f.paper("p");
    f.paper("other");
    f.note("p", "n", "original").unwrap();
    assert!(f.note("other", "n", "overwrite").is_err());
    assert!(f.note("missing", "orphan", "bad").is_err());
    delete_note_in_database(&f.db, "n").unwrap();
    assert!(f.note("p", "n", "late autosave").is_err());
    let c = Connection::open(&f.db).unwrap();
    let row: (String, String) = c
        .query_row("SELECT paper_id,content FROM notes WHERE id='n'", [], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .unwrap();
    assert_eq!(row, ("p".into(), "original".into()));
    assert_eq!(
        c.query_row(
            "SELECT operation FROM sync_outbox WHERE entity_id='n'",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        "delete"
    );
    assert_eq!(
        c.query_row("SELECT count(*) FROM notes", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
}
#[test]
fn integrity_note_outbox_failure_rolls_back_write_and_delete() {
    let f = Fixture::new();
    f.paper("p");
    f.note("p", "n", "original").unwrap();
    let c = Connection::open(&f.db).unwrap();
    c.execute_batch("CREATE TRIGGER fail_outbox BEFORE INSERT ON sync_outbox BEGIN SELECT RAISE(ABORT,'injected outbox failure'); END;").unwrap();
    assert!(f.note("p", "n", "changed").is_err());
    assert!(delete_note_in_database(&f.db, "n").is_err());
    let row: (String, Option<i64>) = c
        .query_row(
            "SELECT content,deleted_at FROM notes WHERE id='n'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(row, ("original".into(), None));
    assert_eq!(
        c.query_row(
            "SELECT operation FROM sync_outbox WHERE entity_id='n'",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        "upsert"
    );
}
#[test]
fn integrity_import_existing_id_never_replaces_files_or_metadata() {
    let f = Fixture::new();
    let a = import_pdf_into_root(&f.root, f.request("p", b"%PDF original")).unwrap();
    f.note("p", "n", "keep").unwrap();
    assert!(import_pdf_into_root(&f.root, f.request("p", b"%PDF replacement")).is_err());
    assert_eq!(fs::read(&a.source_pdf).unwrap(), b"%PDF original");
    let p = list_papers_in_database(&f.db).unwrap();
    assert_eq!(p.len(), 1);
    assert_eq!(p[0].notes[0].content, "keep");
    assert_eq!(p[0].source_file_id.as_deref(), Some(a.file_id.as_str()));
    assert_eq!(
        Connection::open(&f.db)
            .unwrap()
            .query_row("SELECT count(*) FROM paper_files", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
}
#[test]
fn integrity_import_registration_failure_cleans_only_owned_files() {
    let f = Fixture::new();
    let c = Connection::open(&f.db).unwrap();
    c.execute_batch("CREATE TRIGGER fail_import BEFORE INSERT ON paper_files BEGIN SELECT RAISE(ABORT,'injected registration failure'); END;").unwrap();
    assert!(import_pdf_into_root(&f.root, f.request("p", b"%PDF test")).is_err());
    assert!(!f.root.join("files/papers/p").exists());
    assert!(list_papers_in_database(&f.db).unwrap().is_empty());
    c.execute_batch("DROP TRIGGER fail_import").unwrap();
    import_pdf_into_root(&f.root, f.request("p", b"%PDF original")).unwrap();
    c.execute_batch("CREATE TRIGGER fail_import BEFORE INSERT ON paper_files BEGIN SELECT RAISE(ABORT,'injected registration failure'); END;").unwrap();
    let request = f.request("unused", b"%PDF translation");
    assert!(import_translation_into_root(
        &f.root,
        ImportTranslationRequest {
            paper_id: "p".into(),
            original_path: request.original_path,
            language: None
        }
    )
    .is_err());
    assert_eq!(
        fs::read_dir(f.root.join("files/papers/p")).unwrap().count(),
        1
    );
}
#[test]
fn integrity_import_rejects_path_escape_and_keeps_unregistered_directory() {
    let f = Fixture::new();
    for id in ["..", "../escape", "..\\escape", "C:escape", "p.", "p ", ""] {
        assert!(
            import_pdf_into_root(&f.root, f.request(id, b"%PDF fixture")).is_err(),
            "{id}"
        );
    }
    let dir = f.root.join("files/papers/unregistered");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("source.pdf"), b"keep orphan").unwrap();
    assert!(import_pdf_into_root(&f.root, f.request("unregistered", b"%PDF new")).is_err());
    assert_eq!(fs::read(dir.join("source.pdf")).unwrap(), b"keep orphan");
}
#[test]
fn integrity_parallel_duplicate_imports_register_once() {
    let f = Fixture::new();
    let a = f.request("a", b"%PDF identical");
    let b = f.request("b", b"%PDF identical");
    let root = f.root.clone();
    let first = std::thread::spawn(move || import_pdf_into_root(&root, a).unwrap());
    let root = f.root.clone();
    let second = std::thread::spawn(move || import_pdf_into_root(&root, b).unwrap());
    let a = first.join().unwrap();
    let b = second.join().unwrap();
    assert_ne!(a.duplicate, b.duplicate);
    assert_eq!(a.paper_id, b.paper_id);
    assert_eq!(list_papers_in_database(&f.db).unwrap().len(), 1);
}

#[test]
fn integrity_note_optimistic_content_check_rejects_external_overwrite() {
    use crate::library_notes::ExpectedNoteContent;
    let f = Fixture::new();
    f.paper("p");
    f.note("p", "n", "original").unwrap();
    let request = |content: &str| UpsertNoteRequest {
        paper_id: "p".into(),
        note_id: Some("n".into()),
        title: "Note".into(),
        content: content.into(),
        expected: Some(ExpectedNoteContent {
            title: "Note".into(),
            content: "original".into(),
        }),
    };
    upsert_note_in_database(&f.db, request("first update")).unwrap();
    assert!(upsert_note_in_database(&f.db, request("late overwrite")).is_err());
    assert_eq!(
        list_papers_in_database(&f.db).unwrap()[0].notes[0].content,
        "first update"
    );
}
