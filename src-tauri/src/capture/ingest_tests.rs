use super::*;
use serde_json::{json,Value};
use std::{fs,path::{Path,PathBuf}};
use rusqlite::Connection;
use lopdf::{dictionary,Object};
struct Fixture(PathBuf);
impl Fixture { fn new()->Self { let p=std::env::temp_dir().join(format!("a4-ingest-{}",uuid::Uuid::new_v4()));fs::create_dir_all(&p).unwrap();Self(p) } }
impl Drop for Fixture {fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}
pub(super) fn pdf(path:&Path,size:i64){
    let mut d=lopdf::Document::with_version("1.5");let pages=d.new_object_id();
    let page=d.add_object(dictionary!{"Type"=>"Page","Parent"=>pages,"MediaBox"=>vec![0.into(),0.into(),size.into(),size.into()]});
    d.objects.insert(pages,dictionary!{"Type"=>"Pages","Kids"=>vec![Object::Reference(page)],"Count"=>1}.into());
    let catalog=d.add_object(dictionary!{"Type"=>"Catalog","Pages"=>pages});d.trailer.set("Root",catalog);d.save(path).unwrap();
}
fn envelope()->Value {let mut v=model::fixture();v["metadata"]=json!({"title":"Original title","authors":[{"name":"Ada","affiliations":["Lab"]}],"abstract":"Full abstract","identifiers":{"doi":"10.1000/test"},"publication":{"venue":"Journal"},"dates":{"online":"2025-02-03","published":"2026"},"keywords":["science"]});v}
fn artifact(path:&Path)->ingest::Artifact {ingest::Artifact{id:"pdf".into(),role:"fulltext".into(),source:path.to_path_buf(),hash:download::verify(path).unwrap().0}}
#[test] fn capture_ingest_idempotency_versions_user_edits_and_delete_tombstone(){
    let f=Fixture::new();let source=f.0.join("source.pdf");pdf(&source,100);
    let root=f.0.join("library");let first=envelope();
    let a=ingest::ingest(&root,&first,&[artifact(&source)],None).unwrap();let paper=a["paperId"].as_str().unwrap();
    let b=ingest::ingest(&root,&first,&[artifact(&source)],None).unwrap();assert_eq!(a["fileMap"],b["fileMap"]);
    let c=Connection::open(root.join("aster.db")).unwrap();
    let source_hash=download::verify(&source).unwrap().0;
    let original_path:String=c.query_row("SELECT path FROM paper_files WHERE paper_id=?1 AND type='source_pdf'",[paper],|r|r.get(0)).unwrap();
    assert_eq!(Path::new(&original_path).file_name().unwrap().to_str().unwrap(),format!("Original title - 原文 - {}.pdf",&source_hash[..16]));
    assert!(Path::new(&original_path).is_file());
    c.execute("UPDATE papers SET title='User title' WHERE id=?1",[paper]).unwrap();
    let original:String=c.query_row("SELECT id FROM paper_files WHERE paper_id=?1 AND type='source_pdf'",[paper],|r|r.get(0)).unwrap();
    pdf(&source,200);let mut second=envelope();second["metadata"]["title"]=json!("Publisher changed title");
    let result=ingest::ingest(&root,&second,&[artifact(&source)],None).unwrap();assert_eq!(result["paperId"],paper);
    let count:i64=c.query_row("SELECT COUNT(*) FROM paper_files WHERE paper_id=?1",[paper],|r|r.get(0)).unwrap();assert_eq!(count,2);
    let version_hash=download::verify(&source).unwrap().0;
    let version_path:String=c.query_row("SELECT path FROM paper_files WHERE paper_id=?1 AND type='version_pdf'",[paper],|r|r.get(0)).unwrap();
    assert_eq!(Path::new(&version_path).file_name().unwrap().to_str().unwrap(),format!("User title - 其他版本 - {}.pdf",&version_hash[..16]));
    assert_eq!(c.query_row("SELECT title FROM papers WHERE id=?1",[paper],|r|r.get::<_,String>(0)).unwrap(),"User title");
    assert_eq!(c.query_row("SELECT id FROM paper_files WHERE paper_id=?1 AND type='source_pdf'",[paper],|r|r.get::<_,String>(0)).unwrap(),original);
    assert_eq!(library_api::details(&root,paper).unwrap()["snapshots"].as_array().unwrap().len(),2);
    c.execute("DELETE FROM papers WHERE id=?1",[paper]).unwrap();
    assert!(ingest::ingest(&root,&first,&[],None).unwrap_err().contains("已被删除"));
    assert_eq!(c.query_row("SELECT envelope_json FROM paper_capture_records WHERE capture_id=?1",[first["captureId"].as_str().unwrap()],|r|r.get::<_,String>(0)).unwrap(),"{}");
}
#[test] fn capture_metadata_only_then_local_pdf_uses_same_paper_and_native_import_records_snapshot(){
    let f=Fixture::new();let root=f.0.join("library");let first=envelope();
    let record=ingest::ingest(&root,&first,&[],None).unwrap();let paper=record["paperId"].as_str().unwrap();assert_eq!(record["hasSourcePdf"],false);
    let source=f.0.join("sample.pdf");pdf(&source,100);
    let attached=library_api::attach(&root,paper,&source).unwrap();assert_eq!(attached["paperId"],paper);assert_eq!(attached["hasSourcePdf"],true);
    let other=f.0.join("old-import.pdf");pdf(&other,150);
    let imported=crate::library_import::import_pdf_into_root(&root,crate::library_import::ImportPdfRequest{original_path:other.to_string_lossy().to_string(),paper_id:None,title:"Local".into(),authors:"A; B".into(),year:Some(2020),venue:"".into(),doi:"".into(),tags:vec![]}).unwrap();
    let details=library_api::details(&root,&imported.paper_id).unwrap();assert_eq!(details["snapshots"][0]["envelope"]["origin"],"local_pdf");
    assert_eq!(details["snapshots"][0]["envelope"]["metadata"]["authorsDisplay"],"A; B");
}
#[test] fn capture_ingest_refuses_tampered_file_and_rolls_back_projection(){
    let f=Fixture::new();let root=f.0.join("library");let source=f.0.join("source.pdf");pdf(&source,100);let file=artifact(&source);pdf(&source,200);
    assert!(ingest::ingest(&root,&envelope(),&[file],None).is_err());
    let c=Connection::open(root.join("aster.db")).unwrap();assert_eq!(c.query_row("SELECT COUNT(*) FROM papers",[],|r|r.get::<_,i64>(0)).unwrap(),0);
}

#[test]
fn captured_pdf_filenames_are_readable_bounded_and_safe_on_windows() {
    let hash = "0123456789abcdef".repeat(4);
    assert_eq!(ingest::captured_file_name("Study: why? / 结果*", "source_pdf", &hash, "pdf"),
        "Study why 结果 - 原文 - 0123456789abcdef.pdf");
    let title = format!("..\\CON:<报告🧪> {}", "研究🧪".repeat(100));
    let name = ingest::captured_file_name(&title, "supplement_pdf", &hash, "pdf");
    assert!(name.contains("报告🧪"));
    assert!(name.ends_with(" - 补充材料 - 0123456789abcdef.pdf"));
    assert!(name.encode_utf16().count() <= 68);
    assert!(!name.chars().any(|c| c.is_control() || "<>:\"/\\|?*".contains(c)));
    assert!(!name.contains('\u{202e}'));
    assert_eq!(ingest::captured_file_name("\u{202e}???", "source_pdf", &hash, "pdf"),
        "论文 - 原文 - 0123456789abcdef.pdf");
    assert_eq!(ingest::captured_file_name("Study", "supplement_file", &hash, "txt"), format!("{hash}.txt"));
}

#[test]
fn capture_pdf_title_falls_back_to_known_identifier_not_page_guess() {
    let f = Fixture::new(); let root = f.0.join("library"); let source = f.0.join("source.pdf"); pdf(&source, 100);
    let mut first = envelope(); first["metadata"]["title"] = json!("");
    first["metadata"]["identifiers"] = json!({"arxiv": "2401.12345"});
    let result = ingest::ingest(&root, &first, &[artifact(&source)], None).unwrap();
    let c = Connection::open(root.join("aster.db")).unwrap();
    let path:String = c.query_row("SELECT path FROM paper_files WHERE paper_id=?1",
        [result["paperId"].as_str().unwrap()], |r| r.get(0)).unwrap();
    assert!(Path::new(&path).file_name().unwrap().to_str().unwrap().starts_with("arXiv 2401.12345 - 原文 - "));
    assert_eq!(c.query_row("SELECT title FROM papers WHERE id=?1",
        [result["paperId"].as_str().unwrap()], |r| r.get::<_,String>(0)).unwrap(), "未命名论文（待核对）");
}

#[test]
fn captured_pdf_and_manually_imported_translation_share_paper_not_capture_folder() {
    let f = Fixture::new(); let root = f.0.join("library"); let source = f.0.join("source.pdf"); pdf(&source, 100);
    let first = envelope(); let result = ingest::ingest(&root, &first, &[artifact(&source)], None).unwrap();
    let paper = result["paperId"].as_str().unwrap();
    let translated = f.0.join("translation.pdf"); pdf(&translated, 120);
    let bound = crate::library_import::import_translation_into_root(&root, crate::library_import::ImportTranslationRequest {
        paper_id: paper.into(), original_path: translated.to_string_lossy().into_owned(), language: Some("zh".into()),
    }).unwrap();
    let paper_dir = root.join("files").join("papers").join(paper);
    assert_eq!(Path::new(&bound.translated_pdf).parent(), Some(paper_dir.as_path()));
    assert!(Path::new(&bound.translated_pdf).file_name().unwrap().to_str().unwrap().starts_with("translated.zh.file-"));
    assert_eq!(fs::read(&bound.translated_pdf).unwrap(), fs::read(&translated).unwrap());
    let c = Connection::open(root.join("aster.db")).unwrap();
    let kind:String = c.query_row("SELECT type FROM paper_files WHERE id=?1 AND paper_id=?2",
        rusqlite::params![bound.file_id, paper], |r| r.get(0)).unwrap();
    assert_eq!(kind, "translated_pdf");
    let capture_path:String = c.query_row("SELECT path FROM paper_files WHERE paper_id=?1 AND type='source_pdf'",
        [paper], |r| r.get(0)).unwrap();
    assert_eq!(Path::new(&capture_path).parent().unwrap(),
        paper_dir.join("captures").join(first["captureId"].as_str().unwrap()).as_path());
}

#[test]
fn recapture_reuses_legacy_hash_named_pdf_without_renaming_it() {
    let f = Fixture::new(); let root = f.0.join("library"); let source = f.0.join("source.pdf"); pdf(&source, 100);
    let first = envelope(); let file = artifact(&source);
    let result = ingest::ingest(&root, &first, &[artifact(&source)], None).unwrap();
    let file_id = result["fileMap"]["pdf"].as_str().unwrap();
    let c = Connection::open(root.join("aster.db")).unwrap();
    let named_path:String = c.query_row("SELECT path FROM paper_files WHERE id=?1", [file_id], |r| r.get(0)).unwrap();
    let legacy_path = Path::new(&named_path).with_file_name(format!("{}.pdf", file.hash));
    fs::rename(&named_path, &legacy_path).unwrap();
    let legacy = legacy_path.to_string_lossy().into_owned();
    c.execute("UPDATE paper_files SET path=?1 WHERE id=?2", rusqlite::params![legacy, file_id]).unwrap();
    let again = ingest::ingest(&root, &first, &[artifact(&source)], None).unwrap();
    assert_eq!(again["fileMap"]["pdf"].as_str().unwrap(), file_id);
    assert!(!Path::new(&named_path).exists());
    assert!(legacy_path.is_file());
}

#[test]
fn capture_pdf_does_not_overwrite_a_conflicting_readable_name() {
    let f = Fixture::new(); let root = f.0.join("library"); let source = f.0.join("source.pdf"); pdf(&source, 100);
    let first = envelope(); let record = ingest::ingest(&root, &first, &[], None).unwrap();
    let file = artifact(&source);
    let directory = root.join("files").join("papers").join(record["paperId"].as_str().unwrap())
        .join("captures").join(first["captureId"].as_str().unwrap());
    fs::create_dir_all(&directory).unwrap();
    let dest = directory.join(ingest::captured_file_name("Original title", "source_pdf", &file.hash, "pdf"));
    pdf(&dest, 200);
    let original = fs::read(&dest).unwrap();
    assert!(ingest::ingest(&root, &first, &[file], None).unwrap_err().contains("同名入库副本内容不一致"));
    assert_eq!(fs::read(&dest).unwrap(), original);
    let c = Connection::open(root.join("aster.db")).unwrap();
    assert_eq!(c.query_row("SELECT COUNT(*) FROM paper_files", [], |r| r.get::<_,i64>(0)).unwrap(), 0);
}
