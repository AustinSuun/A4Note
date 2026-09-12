use rusqlite::{params, Connection};
use serde_json::{json,Value};
use std::path::{Path,PathBuf};
use uuid::Uuid;
pub fn details(root:&Path,paper:&str)->Result<Value,String> {
    let _access=crate::library_access::operation()?;
    crate::database::initialize_database(&root.join("aster.db"))?;
    let c=Connection::open(root.join("aster.db")).map_err(|e|e.to_string())?;
    let mut snapshots=Vec::new();
    let mut q=c.prepare("SELECT capture_id,envelope_json,file_map_json FROM paper_capture_records WHERE paper_id=?1 ORDER BY created_at DESC LIMIT 20").map_err(|e|e.to_string())?;
    let rows=q.query_map([paper],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?))).map_err(|e|e.to_string())?;
    for row in rows { let(id,envelope,map)=row.map_err(|e|e.to_string())?;snapshots.push(json!({"captureId":id,"envelope":serde_json::from_str::<Value>(&envelope).map_err(|e|e.to_string())?,"fileMap":serde_json::from_str::<Value>(&map).map_err(|e|e.to_string())?})); }
    let mut files=Vec::new();
    let mut q=c.prepare("SELECT id,type,path FROM paper_files WHERE paper_id=?1 ORDER BY created_at").map_err(|e|e.to_string())?;
    for row in q.query_map([paper],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?))).map_err(|e|e.to_string())? {
        let(id,kind,path)=row.map_err(|e|e.to_string())?;
        files.push(json!({"id":id,"kind":kind,"name":Path::new(&path).file_name().map(|s|s.to_string_lossy().to_string()).unwrap_or_default()}));
    }
    Ok(json!({"snapshots":snapshots,"files":files,"snapshotLimit":20}))
}
pub fn open_file(root:&Path,paper:&str,file:&str)->Result<(),String> {
    let _access=crate::library_access::operation()?;
    crate::library_import::validate_paper_storage_id(paper)?;
    let c=Connection::open(root.join("aster.db")).map_err(|e|e.to_string())?;
    let path:String=c.query_row("SELECT path FROM paper_files WHERE paper_id=?1 AND id=?2",params![paper,file],|r|r.get(0)).map_err(|e|e.to_string())?;
    let path=PathBuf::from(path).canonicalize().map_err(|e|e.to_string())?;
    let base=root.join("files").join("papers").join(paper).canonicalize().map_err(|e|e.to_string())?;
    if !path.starts_with(base) || path.extension().and_then(|s|s.to_str()).map(|s|!s.eq_ignore_ascii_case("pdf")).unwrap_or(true) { return Err("只允许打开当前文献目录中的PDF".into()); }
    crate::app_paths::open_file_with_default_app(&path)
}
pub fn attach(root:&Path,paper:&str,path:&Path)->Result<Value,String> {
    let (hash,_)=super::download::verify(path)?;
    let draft=crate::pdf_metadata::extract_metadata_from_pdf_path(&path.to_string_lossy());
    let id=Uuid::new_v4().to_string();
    let envelope=json!({"schemaVersion":1,"captureId":id,"origin":"local_pdf","capturedAt":chrono::DateTime::<chrono::Utc>::from(std::time::SystemTime::now()).to_rfc3339(),"metadata":{"title":draft.title,
        "authors":[{"name":draft.authors,"affiliations":[]}],"identifiers":{"doi":draft.doi},"publication":{"venue":draft.venue},
        "dates":{"published":draft.year.map(|y|y.to_string())},"keywords":draft.tags},"evidence":[{"method":"user_attached_local_pdf"}],"raw":{},"warnings":draft.warnings});
    super::ingest::ingest(root,&envelope,&[super::ingest::Artifact{id:"local-pdf".into(),role:"fulltext".into(),source:path.to_path_buf(),hash}],Some(paper))
}
