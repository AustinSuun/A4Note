//! Synthetic-only startup benchmarks and compatibility checks; no AppHandle/user data.
use rusqlite::{params, Connection};
use std::{fs, path::PathBuf, time::Instant};
use crate::{database::initialize_database, library_papers::list_papers_in_database};

struct Fixture { root: PathBuf, db: PathBuf }
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("a4note-startup-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        Self { db: root.join("aster.db"), root }
    }
    fn populate(&self, count: usize) {
        initialize_database(&self.db).unwrap();
        let mut connection = Connection::open(&self.db).unwrap();
        let tx = connection.transaction().unwrap();
        for n in 0..count {
            let id = format!("p{n}"); let time = n as i64 + 100;
            tx.execute("INSERT INTO papers(id,title,authors,status,is_favorite,last_viewed_at,folder_id,created_at,updated_at) VALUES (?1,?2,'Author','read',1,?3,'library',?3,?3)", params![id,format!("Paper {n}"),time]).unwrap();
            for j in 0..3 {
                let file_id = format!("f{n}-{j}");
                tx.execute("INSERT INTO paper_files(id,paper_id,type,path,created_at) VALUES (?1,?2,?3,?4,?5)", params![file_id,id,if j==0 {"source_pdf"} else {"translated_pdf"}, format!("/synthetic/{file_id}.pdf"), time+j]).unwrap();
            }
            for j in 0..4 {
                tx.execute("INSERT INTO notes(id,paper_id,title,content,created_at,updated_at) VALUES (?1,?2,'Note',?3,?4,?4)",params![format!("n{n}-{j}"),id,"synthetic note body ".repeat(32),time+j]).unwrap();
            }
            for j in 0..6 {
                tx.execute("INSERT INTO annotations(id,paper_id,file_id,page,type,position_json,created_at,updated_at) VALUES (?1,?2,?3,?4,'highlight','{}',?5,?5)",params![format!("a{n}-{j}"),id,format!("f{n}-0"),j+1,time+j]).unwrap();
            }
            for j in 0..2 {
                tx.execute("INSERT INTO ai_threads(id,paper_id,title,created_at,updated_at) VALUES (?1,?2,'Thread',?3,?3)",params![format!("t{n}-{j}"),id,time+j]).unwrap();
            }
        }
        tx.commit().unwrap();
    }
}
impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.root); } }

#[test]
#[ignore = "synthetic timing only; run explicitly with --ignored --nocapture"]
fn startup_database_benchmark() {
    let fixture = Fixture::new(); fixture.populate(1000);
    let mut init_times = Vec::new(); let mut list_times = Vec::new();
    for _ in 0..7 {
        let start = Instant::now();
        for _ in 0..20 { initialize_database(&fixture.db).unwrap(); }
        init_times.push(start.elapsed().as_secs_f64() * 1000.0 / 20.0);
        let start = Instant::now();
        let papers = list_papers_in_database(&fixture.db).unwrap();
        list_times.push(start.elapsed().as_secs_f64()*1000.0);
        assert_eq!(papers.len(),1000); assert_eq!(papers.iter().map(|p|p.notes.len()).sum::<usize>(),4000);
        assert_eq!(papers.iter().map(|p|p.annotations.len()).sum::<usize>(),6000);
    }
    init_times.sort_by(f64::total_cmp); list_times.sort_by(f64::total_cmp);
    println!("STARTUP_BENCH profile=debug papers=1000 notes=4000 annotations=6000 files=3000 threads=2000 runs=7 warm_init_median_ms={:.3} full_list_median_ms={:.3}",init_times[3],list_times[3]);
}

fn legacy_fixture(fixture: &Fixture) {
    let connection = Connection::open(&fixture.db).unwrap();
    connection.execute_batch("CREATE TABLE papers (id TEXT PRIMARY KEY,title TEXT NOT NULL,authors TEXT,year INTEGER,venue TEXT,doi TEXT,folder_id TEXT,status TEXT DEFAULT 'unread',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL, custom_metadata TEXT);
      CREATE TABLE notes (id TEXT PRIMARY KEY,paper_id TEXT NOT NULL,title TEXT,content TEXT NOT NULL,format TEXT NOT NULL DEFAULT 'markdown',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
      CREATE TABLE paper_files (id TEXT PRIMARY KEY,paper_id TEXT NOT NULL,type TEXT NOT NULL,path TEXT NOT NULL,language TEXT,created_at INTEGER NOT NULL);
      INSERT INTO papers(id,title,status,folder_id,created_at,updated_at,custom_metadata) VALUES ('legacy','Original','read','legacy-folder',123,456,'keep-me');
      INSERT INTO notes(id,paper_id,title,content,created_at,updated_at) VALUES ('legacy-note','legacy','My note','Untouched body',12,34);
      INSERT INTO paper_files(id,paper_id,type,path,created_at) VALUES ('legacy-file','legacy','source_pdf','/existing.pdf',15);").unwrap();
}

#[test]
fn startup_migration_preserves_legacy_rows_and_unknown_fields() {
    let fixture = Fixture::new(); legacy_fixture(&fixture);
    initialize_database(&fixture.db).unwrap(); initialize_database(&fixture.db).unwrap();
    let papers = list_papers_in_database(&fixture.db).unwrap();
    assert_eq!(papers.len(),1); assert_eq!(papers[0].title,"Original");
    assert_eq!(papers[0].created_at,123); assert!(papers[0].is_read); assert!(!papers[0].is_favorite);
    assert_eq!(papers[0].notes[0].content,"Untouched body"); assert_eq!(papers[0].source_file_id.as_deref(),Some("legacy-file"));
    let connection = Connection::open(&fixture.db).unwrap();
    let custom: String = connection.query_row("SELECT custom_metadata FROM papers WHERE id='legacy'",[],|r|r.get(0)).unwrap(); assert_eq!(custom,"keep-me");
    let note: (i64,Option<i64>) = connection.query_row("SELECT server_version,deleted_at FROM notes WHERE id='legacy-note'",[],|r|Ok((r.get(0)?,r.get(1)?))).unwrap(); assert_eq!(note,(0,None));
    assert_eq!(crate::library_papers::list_folders_in_database(&fixture.db).unwrap().iter().find(|f|f.folder_id=="legacy-folder").unwrap().paper_count,1);
}

#[test]
fn startup_warm_initialization_is_read_only_even_during_a_writer() {
    let fixture = Fixture::new(); fixture.populate(2);
    let before = fs::read(&fixture.db).unwrap();
    let connection = Connection::open(&fixture.db).unwrap();
    connection.execute_batch("BEGIN IMMEDIATE; UPDATE papers SET title='pending' WHERE id='p0';").unwrap();
    // A warm initialization must not try to acquire a writer lock (which would
    // otherwise wait and fail while this separate connection holds it).
    initialize_database(&fixture.db).unwrap();
    connection.execute_batch("ROLLBACK").unwrap(); drop(connection);
    for _ in 0..5 { initialize_database(&fixture.db).unwrap(); }
    assert_eq!(before,fs::read(&fixture.db).unwrap());
}

#[test]
fn startup_failed_migration_does_not_mark_success_and_can_retry() {
    let fixture = Fixture::new();
    let connection = Connection::open(&fixture.db).unwrap();
    connection.execute_batch(crate::database::schema_sql()).unwrap();
    connection.execute_batch("CREATE TRIGGER deny_root BEFORE INSERT ON folders BEGIN SELECT RAISE(ABORT, 'test-migration-failure'); END;").unwrap();
    assert!(initialize_database(&fixture.db).unwrap_err().contains("test-migration-failure"));
    let count:i64=connection.query_row("SELECT COUNT(*) FROM aster_schema_migrations",[],|r|r.get(0)).unwrap();assert_eq!(count,0);
    connection.execute_batch("DROP TRIGGER deny_root").unwrap();drop(connection);
    initialize_database(&fixture.db).unwrap();
    let connection=Connection::open(&fixture.db).unwrap();
    assert_eq!(connection.query_row("SELECT COUNT(*) FROM aster_schema_migrations",[],|r|r.get::<_,i64>(0)).unwrap(),1);
}

#[test]
fn startup_same_path_replaced_by_old_database_is_migrated_again() {
    let fixture=Fixture::new(); fixture.populate(1);
    let old=Fixture::new();legacy_fixture(&old);
    fs::copy(&old.db,&fixture.db).unwrap();
    initialize_database(&fixture.db).unwrap();
    let papers=list_papers_in_database(&fixture.db).unwrap();
    assert_eq!(papers.len(),1);assert_eq!(papers[0].paper_id,"legacy");assert!(papers[0].is_read);
}

#[test]
fn startup_concurrent_initialize_and_seed_only_creates_one_complete_guide() {
    let fixture=Fixture::new();let barrier=std::sync::Arc::new(std::sync::Barrier::new(4));
    let workers:Vec<_>=(0..4).map(|_| {
        let root=fixture.root.clone();let db=fixture.db.clone();let barrier=barrier.clone();
        std::thread::spawn(move|| {barrier.wait();crate::guide::seed_default_guide(&root,&db).unwrap();})
    }).collect();
    for worker in workers {worker.join().unwrap();}
    let papers=list_papers_in_database(&fixture.db).unwrap();assert_eq!(papers.len(),1);
    assert_eq!(papers[0].notes.len(),1);assert_eq!(papers[0].tags.len(),3);assert!(papers[0].source_pdf.is_some());
    let connection=Connection::open(&fixture.db).unwrap();
    assert_eq!(connection.query_row("SELECT COUNT(*) FROM sync_outbox",[],|r|r.get::<_,i64>(0)).unwrap(),0);
}

#[test]
fn startup_guide_reopen_preserves_user_edits_and_does_not_rewrite_database_or_pdf() {
    use crate::guide::{GUIDE_PAPER_ID,GUIDE_NOTE_ID,GUIDE_FILE_ID};
    let fixture=Fixture::new();crate::guide::seed_default_guide(&fixture.root,&fixture.db).unwrap();
    let connection=Connection::open(&fixture.db).unwrap();
    connection.execute("UPDATE papers SET title='My guide',status='read',is_favorite=1,last_viewed_at=42,updated_at=99 WHERE id=?1",[GUIDE_PAPER_ID]).unwrap();
    connection.execute("UPDATE notes SET content='My edited body',server_version=7,deleted_at=123,updated_at=55 WHERE id=?1",[GUIDE_NOTE_ID]).unwrap();
    connection.execute("DELETE FROM paper_tags WHERE paper_id=?1",[GUIDE_PAPER_ID]).unwrap();
    connection.execute("UPDATE paper_files SET content_hash='custom-hash' WHERE id=?1",[GUIDE_FILE_ID]).unwrap();drop(connection);
    let pdf=fixture.root.join("files/papers").join(GUIDE_PAPER_ID).join("source.pdf");
    fs::write(&pdf,b"user-edited-guide-pdf").unwrap();let before=fs::read(&fixture.db).unwrap();
    for _ in 0..3 {crate::guide::seed_default_guide(&fixture.root,&fixture.db).unwrap();}
    assert_eq!(before,fs::read(&fixture.db).unwrap());assert_eq!(fs::read(&pdf).unwrap(),b"user-edited-guide-pdf");
    // Missing original built-in asset is repaired, without overwriting DB edits.
    fs::remove_file(&pdf).unwrap();crate::guide::seed_default_guide(&fixture.root,&fixture.db).unwrap();
    assert_eq!(fs::read(&pdf).unwrap(),crate::guide::GUIDE_PDF);assert_eq!(before,fs::read(&fixture.db).unwrap());
}

#[test]
fn startup_guide_seed_failure_rolls_back_related_rows() {
    let fixture=Fixture::new();initialize_database(&fixture.db).unwrap();
    let connection=Connection::open(&fixture.db).unwrap();
    connection.execute_batch("CREATE TRIGGER deny_guide_note BEFORE INSERT ON notes BEGIN SELECT RAISE(ABORT,'test-guide-failure'); END;").unwrap();
    assert!(crate::guide::seed_default_guide(&fixture.root,&fixture.db).is_err());
    for table in ["papers","notes","paper_files","paper_tags"] {
        assert_eq!(connection.query_row(&format!("SELECT COUNT(*) FROM {table}"),[],|r|r.get::<_,i64>(0)).unwrap(),0);
    }
    connection.execute_batch("DROP TRIGGER deny_guide_note").unwrap();drop(connection);
    crate::guide::seed_default_guide(&fixture.root,&fixture.db).unwrap();
    assert_eq!(list_papers_in_database(&fixture.db).unwrap()[0].notes.len(),1);
}

#[test]
fn startup_indexes_preserve_full_payload_and_folder_counts() {
    let fixture=Fixture::new();fixture.populate(8);
    let connection=Connection::open(&fixture.db).unwrap();
    connection.execute_batch("DROP INDEX paper_files_by_paper; DROP INDEX notes_by_paper_updated; DROP INDEX annotations_by_paper_created; DROP INDEX ai_threads_by_paper_updated; DROP INDEX papers_by_effective_folder;").unwrap();
    let before=serde_json::to_value(list_papers_in_database(&fixture.db).unwrap()).unwrap();
    let folders_before=serde_json::to_value(crate::library_papers::list_folders_in_database(&fixture.db).unwrap()).unwrap();
    connection.execute("DELETE FROM aster_schema_migrations",[]).unwrap();drop(connection);
    initialize_database(&fixture.db).unwrap();
    let after=serde_json::to_value(list_papers_in_database(&fixture.db).unwrap()).unwrap();
    assert_eq!(before,after);
    assert_eq!(folders_before,serde_json::to_value(crate::library_papers::list_folders_in_database(&fixture.db).unwrap()).unwrap());
    let connection=Connection::open(&fixture.db).unwrap();
    let plan:String=connection.query_row("EXPLAIN QUERY PLAN SELECT id FROM notes WHERE paper_id='p0' ORDER BY updated_at DESC",[],|r|r.get(3)).unwrap();
    assert!(plan.contains("notes_by_paper_updated"),"{plan}");
}

#[test]
fn startup_backup_restore_preserves_current_library_payload() {
    let fixture=Fixture::new();fixture.populate(3);crate::guide::seed_default_guide(&fixture.root,&fixture.db).unwrap();
    let before=serde_json::to_value(list_papers_in_database(&fixture.db).unwrap()).unwrap();
    let backup=crate::backup::create_backup_for_root(&fixture.root,"startup-test").unwrap();
    let connection=Connection::open(&fixture.db).unwrap();connection.execute("UPDATE papers SET title='Changed after backup' WHERE id='p0'",[]).unwrap();drop(connection);
    let restored=crate::backup::restore_backup_into_root(&fixture.root,&backup).unwrap();
    assert!(std::path::Path::new(&restored.safety_backup_path).join("aster.db").exists());
    assert_eq!(before,serde_json::to_value(list_papers_in_database(&fixture.db).unwrap()).unwrap());
}
