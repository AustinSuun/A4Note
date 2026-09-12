//! Shared library ingestion. Network I/O is finished before entering this module.
//! Immutable capture snapshots coexist with the legacy editable papers projection.
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde_json::{json, Value};
use std::{collections::BTreeSet, fs::{self, OpenOptions}, io::{Read,Write}, path::{Path,PathBuf}};
use uuid::Uuid;
use crate::database::{initialize_database,current_timestamp_ms,normalized_tags,stable_tag_id};
pub struct Artifact { pub id:String, pub role:String, pub source:PathBuf, pub hash:String }
fn text<'a>(v:&'a Value,key:&str)->&'a str { v[key].as_str().unwrap_or("").trim() }
fn normalize_doi(value:&str)->String { value.trim().to_lowercase().trim_start_matches("https://doi.org/").trim_start_matches("http://doi.org/").trim_start_matches("doi:").trim().to_string() }
pub fn snapshot(c:&Connection,id:&str,paper:&str,envelope:&Value,map:&Value)->Result<(),String> {
    c.execute("INSERT INTO paper_capture_records(capture_id,paper_id,envelope_json,file_map_json,created_at)
      VALUES(?1,?2,?3,?4,?5) ON CONFLICT(capture_id) DO UPDATE SET envelope_json=excluded.envelope_json,file_map_json=excluded.file_map_json
      WHERE paper_capture_records.paper_id=excluded.paper_id",params![id,paper,envelope.to_string(),map.to_string(),current_timestamp_ms()]).map_err(|e|e.to_string())?;
    Ok(())
}
pub(crate) fn record_local(c:&Connection,paper:&str,file:&str,request:&crate::library_import::ImportPdfRequest)->Result<(),String> {
    let id=format!("local-{file}");
    let envelope=json!({"schemaVersion":1,"captureId":id,"origin":"local_pdf","capturedAt":chrono::DateTime::<chrono::Utc>::from(std::time::SystemTime::now()).to_rfc3339(),"metadata":{
        "title":request.title,"authors":[],"authorsDisplay":request.authors,"identifiers":{"doi":request.doi},
        "publication":{"venue":request.venue},"dates":{"published":request.year.map(|y|y.to_string())},"keywords":request.tags},
        "evidence":[{"field":"metadata","method":"local_pdf_user_confirmed"}],"raw":{},"warnings":["作者为本地导入显示文本，未猜测机构或拆分同名作者"]});
    snapshot(c,&id,paper,&envelope,&json!({"local-pdf":file}))
}
pub fn browser_files(root:&Path,envelope:&Value,result:&Value)->Result<Vec<Artifact>,String> {
    let id=text(envelope,"captureId");
    if Uuid::parse_str(id).map(|v|v.to_string()!=id).unwrap_or(true) { return Err("invalid_capture_id".into()); }
    let mut files=Vec::new();
    for (index,a) in envelope["artifacts"].as_array().ok_or("invalid_artifacts")?.iter().enumerate() {
        if let Some(row)=result["artifacts"].as_array().and_then(|rows|rows.iter().find(|r|r["id"]==a["id"] && r["state"]=="verified")) {
            // Never interpret client-supplied storedPath. The native index determines the path.
            files.push(Artifact{id:text(a,"id").into(),role:text(a,"role").into(),source:root.join("items").join(id).join(format!("{index}.pdf")),hash:text(row,"sha256").into()});
        }
    }
    Ok(files)
}
pub fn ingest(root:&Path,envelope:&Value,files:&[Artifact],target:Option<&str>)->Result<Value,String> {
    let _access=crate::library_access::operation()?;
    let _lock=crate::library_import::IMPORT_LOCK.lock().map_err(|_|"import_lock_unavailable")?;
    let id=text(envelope,"captureId");
    if Uuid::parse_str(id).map(|v|v.to_string()!=id).unwrap_or(true) { return Err("invalid_capture_id".into()); }
    let db=root.join("aster.db");initialize_database(&db)?;
    let mut c=Connection::open(&db).map_err(|e|e.to_string())?;
    c.busy_timeout(std::time::Duration::from_secs(3)).map_err(|e|e.to_string())?;
    let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
    let bound:Option<Option<String>>=tx.query_row("SELECT paper_id FROM paper_capture_records WHERE capture_id=?1",[id],|r|r.get(0)).optional().map_err(|e|e.to_string())?;
    if bound==Some(None) { return Err("文献已被删除；原任务不会自动重新创建，请重新采集".into()); }
    let m=&envelope["metadata"];let doi=normalize_doi(text(&m["identifiers"],"doi"));
    let mut candidates=BTreeSet::new();
    if let Some(Some(paper))=bound { candidates.insert(paper); }
    else if let Some(paper)=target { candidates.insert(paper.to_string()); }
    else {
        if !doi.is_empty() {
            let mut q=tx.prepare("SELECT id FROM papers WHERE lower(trim(replace(replace(doi,'https://doi.org/',''),'http://doi.org/','')))=?1").map_err(|e|e.to_string())?;
            for row in q.query_map([&doi],|r|r.get::<_,String>(0)).map_err(|e|e.to_string())? { candidates.insert(row.map_err(|e|e.to_string())?); }
        }
        if let Some(primary)=files.iter().find(|f|f.role=="fulltext") {
            let mut q=tx.prepare("SELECT DISTINCT paper_id FROM paper_files WHERE content_hash=?1 AND type IN ('source_pdf','version_pdf')").map_err(|e|e.to_string())?;
            for row in q.query_map([&primary.hash],|r|r.get::<_,String>(0)).map_err(|e|e.to_string())? { candidates.insert(row.map_err(|e|e.to_string())?); }
        }
        let arxiv=text(&m["identifiers"],"arxiv");
        if !arxiv.is_empty() {
            let mut q=tx.prepare("SELECT DISTINCT paper_id FROM paper_capture_records WHERE paper_id IS NOT NULL AND json_extract(envelope_json,'$.metadata.identifiers.arxiv')=?1").map_err(|e|e.to_string())?;
            for row in q.query_map([arxiv],|r|r.get::<_,String>(0)).map_err(|e|e.to_string())? { candidates.insert(row.map_err(|e|e.to_string())?); }
        }
    }
    if candidates.len()>1 { return Err("DOI和文件指向不同文献，请人工核对，未覆盖任何记录".into()); }
    let is_new=candidates.is_empty();
    let paper=candidates.into_iter().next().unwrap_or_else(||format!("paper-capture-{id}"));
    crate::library_import::validate_paper_storage_id(&paper)?;
    if !is_new {
        let exists:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM papers WHERE id=?1)",[&paper],|r|r.get(0)).map_err(|e|e.to_string())?;
        if !exists { return Err("目标文献不存在".into()); }
        let old_doi:String=tx.query_row("SELECT COALESCE(doi,'') FROM papers WHERE id=?1",[&paper],|r|r.get(0)).map_err(|e|e.to_string())?;
        if target.is_none() && !doi.is_empty() && !old_doi.is_empty() && doi!=normalize_doi(&old_doi) { return Err("相同文件存在不同DOI，已保留采集结果但未合并".into()); }
    }
    let now=current_timestamp_ms();
    if is_new {
        // Validate inside the same write transaction as insertion: a folder
        // deleted while downloading must never silently fall back to root.
        let folder = super::folders::requested(envelope)?;
        super::folders::ensure_exists(&tx, folder)?;
        let title=text(m,"title");let title=if title.is_empty(){"未命名论文（待核对）"}else{title};
        let authors=m["authors"].as_array().map(|a|a.iter().filter_map(|x|x["name"].as_str()).collect::<Vec<_>>().join("; ")).unwrap_or_default();
        let date=text(&m["dates"],"published");let date=if date.is_empty(){text(&m["dates"],"online")}else{date};
        let date=if date.is_empty(){text(&m["dates"],"submitted")}else{date};
        let year=date.get(..4).and_then(|s|s.parse::<i64>().ok()).filter(|y|(1000..=9999).contains(y));
        tx.execute("INSERT INTO papers(id,title,authors,year,venue,doi,url,abstract,status,folder_id,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'unread',?10,?9,?9)",params![paper,title,authors,year,text(&m["publication"],"venue"),doi,text(envelope,"sourceUrl"),text(m,"abstract"),now,folder]).map_err(|e|e.to_string())?;
        let keywords=m["keywords"].as_array().map(|v|v.iter().filter_map(|s|s.as_str().map(String::from)).take(40).collect::<Vec<_>>()).unwrap_or_default();
        for tag in normalized_tags(&keywords) {
            let tag_id=stable_tag_id(&tag);tx.execute("INSERT OR IGNORE INTO tags(id,name,created_at) VALUES(?1,?2,?3)",params![tag_id,tag,now]).map_err(|e|e.to_string())?;
            tx.execute("INSERT OR IGNORE INTO paper_tags(paper_id,tag_id) VALUES(?1,?2)",params![paper,tag_id]).map_err(|e|e.to_string())?;
        }
    }
    let oldmap:Option<String>=tx.query_row("SELECT file_map_json FROM paper_capture_records WHERE capture_id=?1",[id],|r|r.get(0)).optional().map_err(|e|e.to_string())?;
    let mut map=oldmap.and_then(|s|serde_json::from_str::<Value>(&s).ok()).unwrap_or(json!({}));
    let mut has_source:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM paper_files WHERE paper_id=?1 AND type='source_pdf')",[&paper],|r|r.get(0)).map_err(|e|e.to_string())?;
    for artifact in files {
        let (actual,_)=super::download::verify(&artifact.source)?;
        if actual!=artifact.hash { return Err("采集文件哈希发生变化，拒绝入库".into()); }
        let existing:Option<String>=tx.query_row("SELECT id FROM paper_files WHERE paper_id=?1 AND content_hash=?2 LIMIT 1",params![paper,actual],|r|r.get(0)).optional().map_err(|e|e.to_string())?;
        if let Some(file)=existing { map[&artifact.id]=json!(file);continue; }
        let directory=root.join("files").join("papers").join(&paper).join("captures").join(id);
        fs::create_dir_all(&directory).map_err(|e|e.to_string())?;
        let base=root.join("files").join("papers").canonicalize().map_err(|e|e.to_string())?;
        if !directory.canonicalize().map_err(|e|e.to_string())?.starts_with(&base) { return Err("文献存储目录越界".into()); }
        let dest=directory.join(format!("{actual}.pdf"));
        if !dest.exists() {
            let temp=directory.join(format!(".{}.part",Uuid::new_v4()));
            let written=(||->Result<(),String>{
                let mut output=OpenOptions::new().write(true).create_new(true).open(&temp).map_err(|e|e.to_string())?;
                let input=fs::File::open(&artifact.source).map_err(|e|e.to_string())?;
                let copied=std::io::copy(&mut input.take(super::download::FILE_LIMIT+1),&mut output).map_err(|e|e.to_string())?;
                output.flush().map_err(|e|e.to_string())?;output.sync_all().map_err(|e|e.to_string())?;drop(output);
                if copied>super::download::FILE_LIMIT || super::download::verify(&temp)?.0!=actual { return Err("入库副本校验失败".into()); }
                // hard_link is create-only: unlike rename on POSIX it cannot overwrite a destination.
                fs::hard_link(&temp,&dest).map_err(|e|format!("无法原子发布入库副本：{e}"))?;
                Ok(())
            })();
            let _=fs::remove_file(&temp);written?;
        }
        if super::download::verify(&dest)?.0!=actual { return Err("同名入库副本内容不一致，拒绝覆盖".into()); }
        let file=format!("file-{}",Uuid::new_v4());
        let kind=if artifact.role=="fulltext" && !has_source { has_source=true;"source_pdf" } else if artifact.role=="fulltext" {"version_pdf"} else {"supplement_pdf"};
        tx.execute("INSERT INTO paper_files(id,paper_id,type,path,language,content_hash,created_at) VALUES(?1,?2,?3,?4,'',?5,?6)",params![file,paper,kind,dest.to_string_lossy(),actual,now]).map_err(|e|e.to_string())?;
        map[&artifact.id]=json!(file);
    }
    snapshot(&tx,id,&paper,envelope,&map)?;
    let folder = super::folders::paper_folder(&tx, &paper)?;
    tx.commit().map_err(|e|e.to_string())?;
    Ok(json!({"paperId":paper,"fileMap":map,"created":is_new,"libraryImported":true,"hasSourcePdf":has_source,"folderId":folder["id"],"folderName":folder["name"],"requestedFolderId":envelope["targetFolderId"]}))
}
