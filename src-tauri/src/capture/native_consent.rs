//! One-shot desktop-only consent. No browser operation can resolve this prompt.
use super::*;
use std::sync::mpsc::{self, Receiver, SyncSender};
use tauri::Manager;
const LIMIT: Duration = Duration::from_secs(120);
struct Pending { id: String, deadline: Instant, answer: SyncSender<bool> }
#[derive(Default)]
struct Broker { pending: Mutex<Option<Pending>> }
impl Broker {
    fn begin(&self) -> Result<(String, Receiver<bool>), String> {
        let mut pending = self.pending.lock().map_err(|_| "consent_lock")?;
        if pending.as_ref().is_some_and(|p| p.deadline > Instant::now()) { return Err("consent_already_pending".into()); }
        let (sender, receiver) = mpsc::sync_channel(1);
        let id = Uuid::new_v4().to_string();
        *pending = Some(Pending { id: id.clone(), deadline: Instant::now() + LIMIT, answer: sender });
        Ok((id, receiver))
    }
    fn status(&self) -> Result<Value, String> {
        let mut pending = self.pending.lock().map_err(|_| "consent_lock")?;
        if pending.as_ref().is_some_and(|p| p.deadline <= Instant::now()) { *pending = None; }
        Ok(json!({"requestId": pending.as_ref().map(|p| &p.id)}))
    }
    fn resolve(&self, id: &str, allowed: bool) -> Result<(), String> {
        let mut pending = self.pending.lock().map_err(|_| "consent_lock")?;
        let p = pending.as_ref().ok_or("授权请求已结束，请在扩展中重试")?;
        if p.id != id { return Err("授权请求已变更，请重试".into()); }
        if p.deadline <= Instant::now() { *pending = None; return Err("授权请求已超时，请在扩展中重试".into()); }
        let p = pending.take().ok_or("consent_missing")?;
        p.answer.try_send(allowed).map_err(|_| "授权请求已结束，请在扩展中重试".into())
    }
    fn clear(&self, id: Option<&str>) {
        if let Ok(mut pending) = self.pending.lock() {
            if id.is_none() || pending.as_ref().is_some_and(|p| Some(p.id.as_str()) == id) { *pending = None; }
        }
    }
}
static BROKER: OnceLock<Broker> = OnceLock::new();
fn broker() -> &'static Broker { BROKER.get_or_init(Broker::default) }
pub(super) fn status() -> Result<Value, String> { broker().status() }
pub(super) fn resolve(id: &str, allowed: bool) -> Result<(), String> { broker().resolve(id, allowed) }
pub(super) fn cancel() { broker().clear(None); }
pub(super) fn prompt(app: &AppHandle) -> bool {
    let Some(window) = app.get_webview_window("main") else { return false; };
    let Ok((id, receiver)) = broker().begin() else { return false; };
    // NativeState calls this on a blocking worker, never on the window thread.
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
    let notified = window.emit("capture://consent-changed", ()).is_ok();
    let approved = notified && receiver.recv_timeout(LIMIT).unwrap_or(false);
    broker().clear(Some(&id));
    let _ = window.emit("capture://consent-changed", ());
    approved
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn native_consent_is_one_shot_and_rejects_stale_ids() {
        let b = Broker::default(); let (id, rx) = b.begin().unwrap();
        assert!(b.begin().is_err()); assert!(b.resolve("forged", true).is_err());
        assert!(rx.try_recv().is_err()); b.resolve(&id, true).unwrap();
        assert!(rx.recv().unwrap()); assert!(b.resolve(&id, true).is_err());
        let (next, rx) = b.begin().unwrap(); assert!(b.resolve(&id, true).is_err());
        b.resolve(&next, false).unwrap(); assert!(!rx.recv().unwrap());
    }
    #[test] fn native_consent_expiry_and_shutdown_fail_closed() {
        let b = Broker::default(); let (id, rx) = b.begin().unwrap();
        b.pending.lock().unwrap().as_mut().unwrap().deadline = Instant::now();
        assert!(b.resolve(&id, true).is_err()); assert!(rx.recv().is_err());
        let (_, rx) = b.begin().unwrap(); b.clear(None); assert!(rx.recv().is_err());
        assert!(b.status().unwrap()["requestId"].is_null());
    }
}
