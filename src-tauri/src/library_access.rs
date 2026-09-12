//! Command-boundary maintenance gate. Never acquire this inside DB helpers.
//! Nonblocking acquisition avoids nested helper/writer-priority deadlocks.
use std::sync::{
    atomic::{AtomicBool, Ordering},
    RwLock, RwLockReadGuard, RwLockWriteGuard,
};
struct Access {
    lock: RwLock<()>,
    restart: AtomicBool,
}
impl Access {
    const fn new() -> Self {
        Self {
            lock: RwLock::new(()),
            restart: AtomicBool::new(false),
        }
    }
    fn operation(&self) -> Result<RwLockReadGuard<'_, ()>, String> {
        let guard = self
            .lock
            .try_read()
            .map_err(|_| "资料库正在备份或恢复，请稍后重试".to_string())?;
        if self.restart.load(Ordering::Acquire) {
            return Err("资料库已恢复或正在恢复保护中，请重启应用后继续，旧会话禁止写入".into());
        }
        Ok(guard)
    }
    fn maintenance(&self) -> Result<RwLockWriteGuard<'_, ()>, String> {
        let guard = self
            .lock
            .try_write()
            .map_err(|_| "资料库正在读写，请等待保存完成后重试备份或恢复".to_string())?;
        if self.restart.load(Ordering::Acquire) {
            return Err("请先重启应用完成恢复".into());
        }
        Ok(guard)
    }
}
static ACCESS: Access = Access::new();
pub(crate) fn operation() -> Result<RwLockReadGuard<'static, ()>, String> {
    ACCESS.operation()
}
pub(crate) fn maintenance() -> Result<RwLockWriteGuard<'static, ()>, String> {
    ACCESS.maintenance()
}
pub(crate) fn require_restart() {
    ACCESS.restart.store(true, Ordering::Release);
}
pub(crate) fn restart_required() -> bool {
    ACCESS.restart.load(Ordering::Acquire)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn integrity_maintenance_excludes_io_and_old_sessions_after_restore() {
        let access = Access::new();
        let reader = access.operation().unwrap();
        assert!(access.maintenance().is_err());
        drop(reader);
        let writer = access.maintenance().unwrap();
        assert!(access.operation().is_err());
        assert!(access.maintenance().is_err());
        drop(writer);
        assert!(access.operation().is_ok());
        access.restart.store(true, Ordering::Release);
        assert!(access.operation().is_err());
        assert!(access.maintenance().is_err());
    }
}
