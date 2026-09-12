//! Independent durable capture queue. Does not open or mutate aster.db.
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::{path::Path, sync::Mutex, time::{SystemTime, UNIX_EPOCH}};
use sha2::{Digest, Sha256};
pub struct Store { connection: Mutex<Connection>, _lease: Mutex<Connection> }
pub fn now() -> i64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64 }
impl Store {
    pub fn open(path: &Path) -> Result<Self, String> {
        // An independent SQLite exclusive lease prevents a second app instance
        // from resetting/claiming this process's in-flight jobs. Released on crash.
        let lease = Connection::open(path.with_extension("lock.db")).map_err(|_| "capture_lease_open")?;
        lease.busy_timeout(std::time::Duration::ZERO).map_err(|_| "capture_lease_open")?;
        lease.execute_batch("CREATE TABLE IF NOT EXISTS owner(id INTEGER); BEGIN EXCLUSIVE;").map_err(|_| "capture_inbox_in_use_by_another_process")?;
        let c = Connection::open(path).map_err(|_| "capture_db_open_failed")?;
        c.busy_timeout(std::time::Duration::from_secs(3)).map_err(|_| "capture_db_busy")?;
        c.execute_batch("PRAGMA synchronous=FULL;
            CREATE TABLE IF NOT EXISTS capture_tasks (
              id TEXT PRIMARY KEY, digest TEXT NOT NULL, envelope TEXT NOT NULL,
              state TEXT NOT NULL, result TEXT NOT NULL DEFAULT '{}', created INTEGER NOT NULL, updated INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS capture_native_settings (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
            CREATE INDEX IF NOT EXISTS capture_queue ON capture_tasks(state,created);
            UPDATE capture_tasks SET state='queued' WHERE state='downloading'; UPDATE capture_tasks SET state='needs_user' WHERE state='browser_uploading';")
            .map_err(|_| "capture_db_init_failed")?;
        Ok(Self { connection: Mutex::new(c), _lease: Mutex::new(lease) })
    }
    pub fn native_setting(&self,key:&str,default:bool)->Result<bool,String>{
        let c=self.connection.lock().map_err(|_|"capture_db_lock")?;
        c.query_row("SELECT value FROM capture_native_settings WHERE key=?1",[key],|r|r.get(0)).optional().map(|v|v.unwrap_or(default)).map_err(|_|"native_settings_read".into())
    }
    pub fn set_native_setting(&self,key:&str,value:bool)->Result<(),String>{
        let c=self.connection.lock().map_err(|_|"capture_db_lock")?;
        c.execute("INSERT INTO capture_native_settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![key,value]).map_err(|_|"native_settings_write")?;Ok(())
    }
    pub fn submit(&self, v: &Value) -> Result<Value, String> {
        self.submit_validated(v, Ok(()))
    }
    // External selection checks are computed without holding the queue lock.
    // An already accepted identical task stays replayable if its folder is deleted.
    pub fn submit_validated(&self, v: &Value, selection: Result<(), String>) -> Result<Value, String> {
        super::model::validate(v)?;
        let serialized = serde_json::to_string(v).map_err(|_| "invalid_json")?;
        if serialized.len() > super::model::MAX_BODY { return Err("capture_too_large".into()); }
        let digest = format!("{:x}", Sha256::digest(serialized.as_bytes()));
        let id = v["captureId"].as_str().ok_or("missing_capture_id")?;
        let c = self.connection.lock().map_err(|_| "capture_db_lock")?;
        let existing: Option<String> = c.query_row("SELECT digest FROM capture_tasks WHERE id=?1", [id], |r| r.get(0)).optional().map_err(|_| "capture_db_read")?;
        if let Some(old) = existing {
            if old != digest { return Err("capture_id_conflict".into()); }
            return Ok(json!({"captureId":id,"duplicate":true}));
        }
        selection?;
        let count: i64 = c.query_row("SELECT COUNT(*) FROM capture_tasks", [], |r| r.get(0)).map_err(|_| "capture_db_read")?;
        if count >= 1000 { return Err("capture_inbox_full".into()); }
        c.execute("INSERT INTO capture_tasks(id,digest,envelope,state,created,updated) VALUES(?1,?2,?3,'queued',?4,?4)", params![id,digest,serialized,now()]).map_err(|_| "capture_db_write")?;
        Ok(json!({"captureId":id,"duplicate":false}))
    }
    pub fn save_enriched(&self,id:&str,envelope:&Value)->Result<(),String>{
        let text=envelope.to_string();if text.len()>4*1024*1024{return Err("enriched_metadata_too_large".into());}
        let c=self.connection.lock().map_err(|_|"capture_db_lock")?;
        c.execute("UPDATE capture_tasks SET envelope=?2 WHERE id=?1 AND state='downloading'",params![id,text]).map_err(|_|"capture_db_write")?;
        Ok(())
    }
    pub fn begin_browser_upload(&self,id:&str,index:usize)->Result<(),String>{
        let c=self.connection.lock().map_err(|_|"capture_db_lock")?;
        let text:String=c.query_row("SELECT envelope FROM capture_tasks WHERE id=?1 AND state IN ('needs_user','failed','partial')",[id],|r|r.get(0)).map_err(|_|"请先发送任务并等待自动下载结束，再使用辅助入库")?;
        let envelope:Value=serde_json::from_str(&text).map_err(|_|"invalid_stored_capture")?;
        let a=&envelope["artifacts"][index];
        if !matches!(a["role"].as_str(),Some("fulltext"|"supplement")){return Err("unsupported_pdf_role".into());}
        super::download::checked_url(a["url"].as_str().ok_or("missing_pdf_url")?)?;
        c.execute("UPDATE capture_tasks SET state='browser_uploading',updated=?2 WHERE id=?1",params![id,now()]).map_err(|_|"capture_db_write")?;Ok(())
    }
    pub fn end_browser_upload(&self,id:&str,success:bool)->Result<(),String>{
        let c=self.connection.lock().map_err(|_|"capture_db_lock")?;
        if c.execute("UPDATE capture_tasks SET state=?2,updated=?3 WHERE id=?1 AND state='browser_uploading'",params![id,if success{"queued"}else{"needs_user"},now()]).map_err(|_|"capture_db_write")?==0{return Err("upload_cancelled_or_task_changed".into());}Ok(())
    }
    pub fn claim(&self) -> Result<Option<(String, Value)>, String> {
        let c = self.connection.lock().map_err(|_| "capture_db_lock")?;
        let row: Option<(String, String)> = c.query_row("SELECT id,envelope FROM capture_tasks WHERE state='queued' ORDER BY created,id LIMIT 1", [], |r| Ok((r.get(0)?, r.get(1)?))).optional().map_err(|_| "capture_db_read")?;
        if let Some((id, text)) = row {
            let v = serde_json::from_str(&text).map_err(|_| "capture_invalid_stored_json")?;
            c.execute("UPDATE capture_tasks SET state='downloading',updated=?2 WHERE id=?1", params![id,now()]).map_err(|_| "capture_db_write")?;
            Ok(Some((id,v)))
        } else { Ok(None) }
    }
    pub fn finish(&self, id: &str, state: &str, result: &Value) -> Result<(), String> {
        let c = self.connection.lock().map_err(|_| "capture_db_lock")?;
        // A concurrent cancel wins over a late completion.
        c.execute("UPDATE capture_tasks SET state=?2,result=?3,updated=?4 WHERE id=?1 AND state='downloading'", params![id,state,result.to_string(),now()]).map_err(|_| "capture_db_write")?;
        Ok(())
    }
    pub fn action(&self, id: &str, action: &str) -> Result<(), String> {
        let c = self.connection.lock().map_err(|_| "capture_db_lock")?;
        let sql = match action {
            "retry" => "UPDATE capture_tasks SET state='queued',updated=?2 WHERE id=?1 AND state IN ('failed','partial','needs_user','cancelled')",
            "cancel" => "UPDATE capture_tasks SET state='cancelled',updated=?2 WHERE id=?1 AND state IN ('queued','downloading','browser_uploading')",
            _ => return Err("invalid_action".into()),
        };
        if c.execute(sql, params![id,now()]).map_err(|_| "capture_db_write")? == 0 { return Err("task_not_found_or_not_actionable".into()); }
        Ok(())
    }
    pub fn cancelled(&self, id: &str) -> bool {
        let Ok(c) = self.connection.lock() else { return true; };
        c.query_row("SELECT state FROM capture_tasks WHERE id=?1", [id], |r| r.get::<_,String>(0)).map(|s| s=="cancelled").unwrap_or(true)
    }
    pub fn list(&self) -> Result<Value,String> {
        let c = self.connection.lock().map_err(|_| "capture_db_lock")?;
        let mut statement = c.prepare("SELECT id,state,result,updated,json_extract(envelope,'$.metadata.title') FROM capture_tasks ORDER BY created DESC LIMIT 100").map_err(|_| "capture_db_read")?;
        let rows = statement.query_map([], |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,i64>(3)?,r.get::<_,String>(4)?))).map_err(|_| "capture_db_read")?;
        let mut records=Vec::new();
        for row in rows {
            let (id,state,result,updated,title)=row.map_err(|_| "capture_db_read")?;
            records.push(json!({"captureId":id,"state":state,"result":serde_json::from_str::<Value>(&result).unwrap_or(json!({})),"updatedAt":updated,"title":title}));
        }
        Ok(json!({"tasks":records,"limit":100,"libraryImported":false}))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn capture_queue_idempotency_conflict_cancel_and_recovery() {
        let path=std::env::temp_dir().join(format!("a4capture-{}.db",uuid::Uuid::new_v4()));
        let s=Store::open(&path).unwrap(); assert!(Store::open(&path).is_err()); let mut v=super::super::model::fixture();
        assert_eq!(s.submit(&v).unwrap()["duplicate"],false);
        assert_eq!(s.submit(&v).unwrap()["duplicate"],true);
        v["metadata"]["title"]=json!("changed"); assert!(s.submit(&v).is_err());
        let (id, _)=s.claim().unwrap().unwrap(); drop(s);
        let s=Store::open(&path).unwrap(); assert_eq!(s.claim().unwrap().unwrap().0,id);
        s.action(&id,"cancel").unwrap(); s.finish(&id,"complete",&json!({})).unwrap();
        assert!(s.cancelled(&id)); s.action(&id,"retry").unwrap(); assert!(s.claim().unwrap().is_some());
        drop(s); std::fs::remove_file(&path).unwrap(); std::fs::remove_file(path.with_extension("lock.db")).unwrap();
    }
}
