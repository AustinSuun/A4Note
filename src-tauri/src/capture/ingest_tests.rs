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
    c.execute("UPDATE papers SET title='User title' WHERE id=?1",[paper]).unwrap();
    let original:String=c.query_row("SELECT id FROM paper_files WHERE paper_id=?1 AND type='source_pdf'",[paper],|r|r.get(0)).unwrap();
    pdf(&source,200);let mut second=envelope();second["metadata"]["title"]=json!("Publisher changed title");
    let result=ingest::ingest(&root,&second,&[artifact(&source)],None).unwrap();assert_eq!(result["paperId"],paper);
    let count:i64=c.query_row("SELECT COUNT(*) FROM paper_files WHERE paper_id=?1",[paper],|r|r.get(0)).unwrap();assert_eq!(count,2);
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
