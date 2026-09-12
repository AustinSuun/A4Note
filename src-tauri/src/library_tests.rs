//! End-to-end tests for the library store (P2-1).
//!
//! They drive the root-level functions against a temporary `AsterData` root, so
//! they cover the real SQLite schema and the real file copies without a Tauri
//! handle. They stayed one module after the split on purpose: each one crosses
//! several domains — import, tags, notes, annotations, threads — which is exactly
//! the seam a per-module test would stop covering.
//!
//! The `mod tests` block is nested rather than flattened into the file so P2-1
//! moved no test body at all: what a test asserts is unchanged, only where the
//! functions it calls now live.

use rusqlite::Connection;
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

use crate::app_paths::path_to_string;
use crate::database::{current_timestamp_ms, FALLBACK_TAG};
use crate::library_ai::{append_ai_message_in_database, AppendAiMessageRequest};
use crate::library_annotations::{
    delete_annotation_in_database, insert_annotation, list_annotations_for_paper,
    restore_annotation_in_database, CreateAnnotationRequest, DeleteAnnotationRequest,
    RestoreAnnotationRequest,
};
use crate::library_import::{
    import_pdf_into_root, import_translation_into_root, load_paper_file_bytes_from_database,
    ImportPdfRequest, ImportTranslationRequest, LoadPaperFileRequest,
};
use crate::library_notes::{upsert_note_in_database, UpsertNoteRequest};
use crate::library_papers::{
    create_folder_in_database, delete_folder_in_database, list_folders_in_database,
    list_papers_in_database, move_papers_to_folder_in_database, update_paper_tags_in_database,
    CreateFolderRequest, MovePapersToFolderRequest, RenameFolderRequest,
    rename_folder_in_database,
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn note_write_and_sync_outbox_share_one_transaction() {
        let root = test_root();
        fs::create_dir_all(&root).unwrap();
        let database = root.join("aster.db");
        crate::database::initialize_database(&database).unwrap();
        let connection = Connection::open(&database).unwrap();
        connection
            .execute(
                "INSERT INTO papers (id, title, created_at, updated_at) VALUES ('paper-sync', 'Sync', 1, 1)",
                [],
            )
            .unwrap();
        drop(connection);

        upsert_note_in_database(
            &database,
            UpsertNoteRequest { expected: None,
                paper_id: "paper-sync".to_string(),
                note_id: Some("note-sync".to_string()),
                title: "First".to_string(),
                content: "one".to_string(),
            },
        )
        .unwrap();
        let connection = Connection::open(&database).unwrap();
        let queued: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sync_outbox WHERE entity_id = 'note-sync'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(queued, 1);
        let base_version: i64 = connection
            .query_row(
                "SELECT base_version FROM sync_outbox WHERE entity_id = 'note-sync'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(base_version, 0);
        connection
            .execute(
                "UPDATE notes SET server_version = 4 WHERE id = 'note-sync'",
                [],
            )
            .unwrap();
        drop(connection);

        upsert_note_in_database(
            &database,
            UpsertNoteRequest { expected: None,
                paper_id: "paper-sync".to_string(),
                note_id: Some("note-sync".to_string()),
                title: "Second".to_string(),
                content: "two".to_string(),
            },
        )
        .unwrap();
        let connection = Connection::open(&database).unwrap();
        let (queued, base_version): (i64, i64) = connection
            .query_row(
                "SELECT COUNT(*), MAX(base_version) FROM sync_outbox WHERE entity_id = 'note-sync'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(queued, 1);
        assert_eq!(base_version, 4);
    }

    #[test]
    fn import_pdf_tags_translation_and_ai_thread_roundtrip() {
        let root = test_root();
        fs::create_dir_all(&root).unwrap();
        let database = root.join("aster.db");
        let source_pdf = root.join("source-input.pdf");
        let translated_pdf = root.join("translated-input.pdf");
        fs::write(&source_pdf, b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF").unwrap();
        fs::write(&translated_pdf, b"%PDF-1.4\ntranslated\n%%EOF").unwrap();

        let import_result = import_pdf_into_root(
            &root,
            ImportPdfRequest {
                original_path: path_to_string(&source_pdf),
                paper_id: Some("paper-test".to_string()),
                title: "  Test Paper  ".to_string(),
                authors: "  Ada Lovelace  ".to_string(),
                year: Some(2026),
                venue: "  Aster Conf  ".to_string(),
                doi: "10.1000/aster.test".to_string(),
                tags: vec![],
            },
        )
        .unwrap();

        assert!(import_result.copied);
        assert_eq!(import_result.paper_id, "paper-test");
        assert!(PathBuf::from(&import_result.source_pdf).exists());

        let papers = list_papers_in_database(&database).unwrap();
        assert_eq!(papers.len(), 1);
        assert_eq!(papers[0].title, "Test Paper");
        assert_eq!(papers[0].authors, "Ada Lovelace");
        assert_eq!(papers[0].tags, vec![FALLBACK_TAG.to_string()]);
        assert_eq!(
            papers[0].source_file_id.as_deref(),
            Some(import_result.file_id.as_str())
        );

        update_paper_tags_in_database(
            &database,
            "paper-test",
            &[
                "  AI  ".to_string(),
                "".to_string(),
                "阅读".to_string(),
                "ai".to_string(),
                FALLBACK_TAG.to_string(),
                "AI".to_string(),
            ],
        )
        .unwrap();
        let papers = list_papers_in_database(&database).unwrap();
        assert_eq!(papers[0].tags.len(), 2);
        assert!(papers[0].tags.contains(&"AI".to_string()));
        assert!(papers[0].tags.contains(&"阅读".to_string()));

        let translation = import_translation_into_root(
            &root,
            ImportTranslationRequest {
                paper_id: "paper-test".to_string(),
                original_path: path_to_string(&translated_pdf),
                language: Some("zh".to_string()),
            },
        )
        .unwrap();
        assert!(translation.copied);
        assert!(PathBuf::from(&translation.translated_pdf).exists());
        assert!(translation.translated_pdf.contains(&translation.file_id));

        append_ai_message_in_database(
            &database,
            &AppendAiMessageRequest {
                paper_id: "paper-test".to_string(),
                thread_id: None,
                role: "user".to_string(),
                content: "Summarize this paper".to_string(),
            },
        )
        .unwrap();

        let papers = list_papers_in_database(&database).unwrap();
        assert_eq!(papers[0].translated_file_ids, vec![translation.file_id]);
        assert_eq!(papers[0].translated_pdfs, vec![translation.translated_pdf]);
        assert_eq!(papers[0].ai_threads.len(), 1);
        assert!(papers[0].ai_threads[0].starts_with("thread-"));

        let translated_bytes = load_paper_file_bytes_from_database(
            &database,
            &LoadPaperFileRequest {
                paper_id: "paper-test".to_string(),
                kind: "translated".to_string(),
                file_id: None,
            },
        )
        .unwrap();
        assert!(translated_bytes.starts_with(b"%PDF"));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn translated_pdf_import_requires_existing_paper_and_keeps_multiple_files() {
        let root = test_root();
        fs::create_dir_all(&root).unwrap();
        let source_pdf = root.join("translation-source.pdf");
        let translated_pdf = root.join("translation-target.pdf");
        fs::write(&source_pdf, b"%PDF-1.4\nsource\n%%EOF").unwrap();
        fs::write(&translated_pdf, b"%PDF-1.4\ntranslated-v1\n%%EOF").unwrap();

        let missing = import_translation_into_root(
            &root,
            ImportTranslationRequest {
                paper_id: "missing-paper".to_string(),
                original_path: path_to_string(&translated_pdf),
                language: Some("zh".to_string()),
            },
        );
        assert!(missing.is_err());
        assert!(!root
            .join("files")
            .join("papers")
            .join("missing-paper")
            .exists());

        let import_result = import_pdf_into_root(
            &root,
            ImportPdfRequest {
                original_path: path_to_string(&source_pdf),
                paper_id: Some("paper-translation".to_string()),
                title: "Translation Paper".to_string(),
                authors: String::new(),
                year: None,
                venue: String::new(),
                doi: String::new(),
                tags: vec![],
            },
        )
        .unwrap();
        assert_eq!(import_result.paper_id, "paper-translation");

        let first = import_translation_into_root(
            &root,
            ImportTranslationRequest {
                paper_id: "paper-translation".to_string(),
                original_path: path_to_string(&translated_pdf),
                language: Some("zh".to_string()),
            },
        )
        .unwrap();
        fs::write(&translated_pdf, b"%PDF-1.4\ntranslated-v2\n%%EOF").unwrap();
        let second = import_translation_into_root(
            &root,
            ImportTranslationRequest {
                paper_id: "paper-translation".to_string(),
                original_path: path_to_string(&translated_pdf),
                language: Some("zh".to_string()),
            },
        )
        .unwrap();

        assert_ne!(first.file_id, second.file_id);
        assert_ne!(first.translated_pdf, second.translated_pdf);
        assert!(PathBuf::from(&first.translated_pdf).exists());
        assert!(PathBuf::from(&second.translated_pdf).exists());
        let papers = list_papers_in_database(&root.join("aster.db")).unwrap();
        assert_eq!(papers[0].translated_file_ids.len(), 2);
        assert_eq!(papers[0].translated_pdfs.len(), 2);
        assert_eq!(papers[0].translated_file_ids[0], second.file_id);
        assert_eq!(papers[0].translated_file_ids[1], first.file_id);
        let latest_bytes = load_paper_file_bytes_from_database(
            &root.join("aster.db"),
            &LoadPaperFileRequest {
                paper_id: "paper-translation".to_string(),
                kind: "translated".to_string(),
                file_id: None,
            },
        )
        .unwrap();
        assert!(String::from_utf8_lossy(&latest_bytes).contains("translated-v2"));
        let first_bytes = load_paper_file_bytes_from_database(
            &root.join("aster.db"),
            &LoadPaperFileRequest {
                paper_id: "paper-translation".to_string(),
                kind: "translated".to_string(),
                file_id: Some(first.file_id),
            },
        )
        .unwrap();
        assert!(String::from_utf8_lossy(&first_bytes).contains("translated-v1"));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn duplicate_import_uses_existing_paper_by_hash() {
        let root = test_root();
        fs::create_dir_all(&root).unwrap();
        let source_pdf = root.join("duplicate.pdf");
        fs::write(&source_pdf, b"%PDF-1.4\nduplicate-content\n%%EOF").unwrap();
        let request = ImportPdfRequest {
            original_path: path_to_string(&source_pdf),
            paper_id: Some("paper-duplicate".to_string()),
            title: "Duplicate Paper".to_string(),
            authors: String::new(),
            year: None,
            venue: String::new(),
            doi: String::new(),
            tags: vec!["重复".to_string()],
        };

        let first = import_pdf_into_root(&root, request).unwrap();
        assert!(first.copied);
        let second = import_pdf_into_root(
            &root,
            ImportPdfRequest {
                original_path: path_to_string(&source_pdf),
                paper_id: Some("paper-duplicate-second".to_string()),
                title: "Duplicate Paper Again".to_string(),
                authors: String::new(),
                year: None,
                venue: String::new(),
                doi: String::new(),
                tags: vec![],
            },
        )
        .unwrap();

        assert!(second.duplicate);
        assert_eq!(second.existing_paper_id.as_deref(), Some("paper-duplicate"));
        let papers = list_papers_in_database(&root.join("aster.db")).unwrap();
        assert_eq!(papers.len(), 1);

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn annotation_delete_is_idempotent_and_restorable() {
        let root = test_root();
        fs::create_dir_all(&root).unwrap();
        let database = root.join("aster.db");
        let source_pdf = root.join("annotation-source.pdf");
        fs::write(&source_pdf, b"%PDF-1.4\nannotation-source\n%%EOF").unwrap();
        let import_result = import_pdf_into_root(
            &root,
            ImportPdfRequest {
                original_path: path_to_string(&source_pdf),
                paper_id: Some("paper-annotation".to_string()),
                title: "Annotation Paper".to_string(),
                authors: String::new(),
                year: None,
                venue: String::new(),
                doi: String::new(),
                tags: vec![],
            },
        )
        .unwrap();

        let annotation_id = insert_annotation(
            &database,
            &CreateAnnotationRequest {
                paper_id: "paper-annotation".to_string(),
                file_id: import_result.file_id.clone(),
                page: 3,
                annotation_type: "highlight".to_string(),
                quote: "Important sentence".to_string(),
                comment: String::new(),
                color: "yellow".to_string(),
                position_json: "{\"x\":10,\"y\":20,\"width\":30,\"height\":4}".to_string(),
            },
        )
        .unwrap();

        let delete_request = DeleteAnnotationRequest {
            annotation_id: annotation_id.clone(),
        };
        delete_annotation_in_database(&database, &delete_request).unwrap();
        delete_annotation_in_database(&database, &delete_request).unwrap();
        assert!(list_annotations_for_paper(
            &Connection::open(&database).unwrap(),
            "paper-annotation"
        )
        .unwrap()
        .is_empty());

        restore_annotation_in_database(
            &database,
            &RestoreAnnotationRequest {
                annotation_id: annotation_id.clone(),
                paper_id: "paper-annotation".to_string(),
                file_id: import_result.file_id,
                page: 3,
                annotation_type: "highlight".to_string(),
                quote: "Important sentence".to_string(),
                comment: "Restored".to_string(),
                color: "green".to_string(),
                position_json: "{\"x\":10,\"y\":20,\"width\":30,\"height\":4}".to_string(),
                created_at: current_timestamp_ms(),
            },
        )
        .unwrap();

        let restored =
            list_annotations_for_paper(&Connection::open(&database).unwrap(), "paper-annotation")
                .unwrap();
        assert_eq!(restored.len(), 1);
        assert_eq!(restored[0].id, annotation_id);
        assert_eq!(restored[0].comment, "Restored");
        assert_eq!(restored[0].color, "green");

        delete_annotation_in_database(&database, &delete_request).unwrap();
        assert!(list_annotations_for_paper(
            &Connection::open(&database).unwrap(),
            "paper-annotation"
        )
        .unwrap()
        .is_empty());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn source_and_translated_annotations_are_isolated_by_file_id() {
        let root = test_root();
        fs::create_dir_all(&root).unwrap();
        let database = root.join("aster.db");
        let source_pdf = root.join("source-independent.pdf");
        let translated_pdf = root.join("translated-independent.pdf");
        fs::write(&source_pdf, b"%PDF-1.4\nsource-independent\n%%EOF").unwrap();
        fs::write(&translated_pdf, b"%PDF-1.4\ntranslated-independent\n%%EOF").unwrap();

        let import_result = import_pdf_into_root(
            &root,
            ImportPdfRequest {
                original_path: path_to_string(&source_pdf),
                paper_id: Some("paper-independent-annotations".to_string()),
                title: "Independent Annotations".to_string(),
                authors: String::new(),
                year: None,
                venue: String::new(),
                doi: String::new(),
                tags: vec![],
            },
        )
        .unwrap();
        let translation = import_translation_into_root(
            &root,
            ImportTranslationRequest {
                paper_id: "paper-independent-annotations".to_string(),
                original_path: path_to_string(&translated_pdf),
                language: Some("zh".to_string()),
            },
        )
        .unwrap();

        let source_annotation_id = insert_annotation(
            &database,
            &CreateAnnotationRequest {
                paper_id: "paper-independent-annotations".to_string(),
                file_id: import_result.file_id.clone(),
                page: 1,
                annotation_type: "highlight".to_string(),
                quote: "Source quote".to_string(),
                comment: "Source note".to_string(),
                color: "yellow".to_string(),
                position_json: "{\"x\":10,\"y\":12,\"width\":30,\"height\":4}".to_string(),
            },
        )
        .unwrap();
        let translated_annotation_id = insert_annotation(
            &database,
            &CreateAnnotationRequest {
                paper_id: "paper-independent-annotations".to_string(),
                file_id: translation.file_id.clone(),
                page: 1,
                annotation_type: "underline".to_string(),
                quote: "Translated quote".to_string(),
                comment: "Translated note".to_string(),
                color: "blue".to_string(),
                position_json: "{\"x\":12,\"y\":22,\"width\":28,\"height\":3}".to_string(),
            },
        )
        .unwrap();

        let papers = list_papers_in_database(&database).unwrap();
        let annotations = &papers[0].annotations;
        assert_eq!(annotations.len(), 2);
        assert!(annotations
            .iter()
            .any(|annotation| annotation.id == source_annotation_id
                && annotation.file_id == import_result.file_id));
        assert!(annotations
            .iter()
            .any(|annotation| annotation.id == translated_annotation_id
                && annotation.file_id == translation.file_id));

        delete_annotation_in_database(
            &database,
            &DeleteAnnotationRequest {
                annotation_id: source_annotation_id,
            },
        )
        .unwrap();
        let remaining = list_annotations_for_paper(
            &Connection::open(&database).unwrap(),
            "paper-independent-annotations",
        )
        .unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, translated_annotation_id);
        assert_eq!(remaining[0].file_id, translation.file_id);
        assert_eq!(remaining[0].comment, "Translated note");

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn folder_management_round_trip_preserves_papers_when_deleting_a_folder() {
        let root = test_root();
        fs::create_dir_all(&root).unwrap();
        let database = root.join("aster.db");
        crate::database::initialize_database(&database).unwrap();
        let parent = create_folder_in_database(
            &database,
            &CreateFolderRequest { name: "Research".to_string(), parent_id: Some("library".to_string()) },
        ).unwrap();
        let child = create_folder_in_database(
            &database,
            &CreateFolderRequest { name: "Methods".to_string(), parent_id: Some(parent.folder_id.clone()) },
        ).unwrap();
        let connection = Connection::open(&database).unwrap();
        connection.execute(
            "INSERT INTO papers (id, title, folder_id, created_at, updated_at) VALUES ('paper-folder', 'Folder paper', ?1, 1, 1)",
            [&child.folder_id],
        ).unwrap();
        drop(connection);
        move_papers_to_folder_in_database(
            &database,
            &MovePapersToFolderRequest { paper_ids: vec!["paper-folder".to_string()], folder_id: Some(parent.folder_id.clone()) },
        ).unwrap();
        rename_folder_in_database(
            &database,
            &RenameFolderRequest { folder_id: parent.folder_id.clone(), name: "Research renamed".to_string() },
        ).unwrap();
        delete_folder_in_database(&database, &parent.folder_id).unwrap();
        let papers = list_papers_in_database(&database).unwrap();
        assert_eq!(papers[0].folder_id.as_deref(), Some("library"));
        let folders = list_folders_in_database(&database).unwrap();
        assert!(folders.iter().all(|folder| folder.folder_id != parent.folder_id));
        assert_eq!(folders.iter().find(|folder| folder.folder_id == child.folder_id).and_then(|folder| folder.parent_id.as_deref()), Some("library"));
        fs::remove_dir_all(root).unwrap();
    }

    fn test_root() -> PathBuf {
        std::env::temp_dir().join(format!("aster-test-{}", Uuid::new_v4()))
    }
}
