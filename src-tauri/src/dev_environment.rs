//! Runtime identity / isolation verdict for Agent test entry points.
//!
//! Debug builds fail closed: a debug process may only touch a library once it
//! can prove which identity it runs under and, for launcher-managed instances
//! (`npm run dev:live`), that identity, data root and WebView profile are exactly
//! the ones the launcher admitted. Release builds are never labelled or blocked.
//! The verdict is computed once during setup and read by `library_access`, so a
//! blocked process still starts and can explain itself, but every library command
//! is refused. This is data-path isolation, not an operating-system sandbox.
use serde::Serialize;
use std::path::{Component, Path};
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};

pub(crate) const PRODUCTION_IDENTIFIER: &str = "app.aster.research";
const DEV_PREFIX: &str = "app.aster.research.dev.";
/// Explicit, human-only escape hatch for `npm run tauri:dev` against the real library.
pub(crate) const ALLOW_PRODUCTION_ENV: &str = "A4NOTE_ALLOW_PRODUCTION_LIBRARY";
const EXPECTED_ID_ENV: &str = "A4NOTE_DEV_EXPECTED_ID";
const EXPECTED_ROOT_ENV: &str = "A4NOTE_DEV_EXPECTED_ROOT";
const EXPECTED_PROFILE_ENV: &str = "A4NOTE_DEV_EXPECTED_PROFILE";
const WEBVIEW_PROFILE_ENV: &str = "WEBVIEW2_USER_DATA_FOLDER";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Mode {
    /// Release build: normal product behaviour, no badge, no gate.
    Release,
    /// Debug build explicitly allowed onto the real library by a human.
    ProductionDebug,
    /// Launcher-admitted isolated instance; identity, root and profile verified.
    Isolated,
    /// Debug build that could not prove isolation; all library commands refused.
    Blocked,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DevEnvironment {
    pub(crate) mode: Mode,
    pub(crate) identifier: String,
    pub(crate) product_name: String,
    pub(crate) version: String,
    pub(crate) debug: bool,
    pub(crate) isolated: bool,
    pub(crate) blocked: bool,
    /// Launcher instance name derived from the identifier (`xq-a` of `…dev.xq-a.w1234`).
    pub(crate) instance: Option<String>,
    /// Stable machine-readable cause (`production-library-in-debug`, `root-mismatch`, …).
    pub(crate) code: Option<String>,
    /// Actionable explanation; never contains user paths.
    pub(crate) reason: Option<String>,
    /// Last two components of the data root (`<identifier>/AsterData`), no user directory.
    pub(crate) data_root_tail: String,
}

pub(crate) struct Inputs<'a> {
    pub(crate) identifier: &'a str,
    pub(crate) root: &'a Path,
    pub(crate) debug: bool,
    pub(crate) expected_id: Option<&'a str>,
    pub(crate) expected_root: Option<&'a str>,
    pub(crate) expected_profile: Option<&'a str>,
    pub(crate) actual_profile: Option<&'a str>,
    pub(crate) allow_production: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Verdict {
    pub(crate) mode: Mode,
    pub(crate) instance: Option<String>,
    pub(crate) code: Option<&'static str>,
    pub(crate) reason: Option<String>,
}

const GUIDANCE: &str = "请用 `npm run dev:live -- --instance <名称> --port <端口> --cdp-port <端口>` 启动独立实例后再测试；不会回退到正式资料库。";

fn blocked(code: &'static str, reason: impl Into<String>) -> Verdict {
    Verdict { mode: Mode::Blocked, instance: None, code: Some(code), reason: Some(reason.into()) }
}

pub(crate) fn dev_instance_name(identifier: &str) -> Option<String> {
    let suffix = identifier.strip_prefix(DEV_PREFIX).filter(|suffix| !suffix.is_empty())?;
    Some(suffix.rsplit_once(".w").map(|(instance, _)| instance).unwrap_or(suffix).to_string())
}

/// Pure decision. Never reads the environment or the file system except for the
/// symlink/junction walk in `safe_path`, which only inspects metadata.
pub(crate) fn classify(inputs: &Inputs<'_>) -> Verdict {
    if !inputs.debug {
        return Verdict { mode: Mode::Release, instance: None, code: None, reason: None };
    }
    let instance = dev_instance_name(inputs.identifier);
    let has_expectations = inputs.expected_id.is_some() || inputs.expected_root.is_some() || inputs.expected_profile.is_some();
    if instance.is_none() && !has_expectations {
        if inputs.identifier == PRODUCTION_IDENTIFIER && inputs.allow_production {
            return Verdict {
                mode: Mode::ProductionDebug,
                instance: None,
                code: Some("production-allowed"),
                reason: Some(format!("调试构建已按 {ALLOW_PRODUCTION_ENV} 明确放行，正在使用正式资料库；这不是隔离测试环境，Agent 测试禁止使用。")),
            };
        }
        return blocked(
            "production-library-in-debug",
            format!("调试构建默认不打开正式资料库（{}）。{GUIDANCE} 开发者本人确需在调试构建中使用正式库时，可设置 {ALLOW_PRODUCTION_ENV}=1。", inputs.identifier),
        );
    }
    let Some(instance) = instance else {
        return blocked("identity-not-isolated", format!("启动器要求隔离身份，但当前身份 `{}` 不是 app.aster.research.dev.* 独立实例。{GUIDANCE}", inputs.identifier));
    };
    if inputs.allow_production {
        return blocked("conflicting-override", format!("独立实例不能同时设置 {ALLOW_PRODUCTION_ENV}；请清除该环境变量后重新启动。"));
    }
    match inputs.expected_id {
        None => return blocked("missing-expected-identity", format!("身份 `{}` 不是由启动器登记的实例（缺少 {EXPECTED_ID_ENV}）。{GUIDANCE}", inputs.identifier)),
        Some(expected) if expected != inputs.identifier => {
            return blocked("identity-mismatch", format!("原生身份 `{}` 与启动器登记的 `{expected}` 不一致；前端/后端可能来自不同实例。{GUIDANCE}", inputs.identifier));
        }
        Some(_) => {}
    }
    let Some(expected_root) = inputs.expected_root else {
        return blocked("missing-expected-root", format!("启动器未登记资料库目录（缺少 {EXPECTED_ROOT_ENV}）。{GUIDANCE}"));
    };
    if !same_path(inputs.root, Path::new(expected_root)) {
        return blocked("root-mismatch", format!("实际资料库目录与启动器登记的目录不一致（可能指向其它实例或正式库）。{GUIDANCE}"));
    }
    let shaped = inputs.root.file_name().and_then(|name| name.to_str()) == Some("AsterData")
        && inputs.root.parent().and_then(Path::file_name).and_then(|name| name.to_str()) == Some(inputs.identifier);
    if !shaped {
        return blocked("root-shape", format!("资料库目录不在 `<身份>/AsterData` 之下，拒绝使用。{GUIDANCE}"));
    }
    let Some(expected_profile) = inputs.expected_profile else {
        return blocked("missing-expected-profile", format!("启动器未登记 WebView profile（缺少 {EXPECTED_PROFILE_ENV}）。{GUIDANCE}"));
    };
    match inputs.actual_profile {
        Some(actual) if same_path(Path::new(actual), Path::new(expected_profile)) => {}
        _ => return blocked("profile-mismatch", format!("WebView profile 与启动器登记的目录不一致（{WEBVIEW_PROFILE_ENV}）。{GUIDANCE}")),
    }
    let profile = Path::new(expected_profile);
    if profile.starts_with(inputs.root) || inputs.root.starts_with(profile) {
        return blocked("profile-overlaps-root", "WebView profile 与资料库目录互相包含，拒绝使用。");
    }
    if let Err(reason) = safe_path(inputs.root).and_then(|_| safe_path(profile)) {
        return blocked("unsafe-path", reason);
    }
    Verdict { mode: Mode::Isolated, instance: Some(instance), code: None, reason: None }
}

/// Absolute, no `..`, and no symlink/junction anywhere on the existing ancestry.
pub(crate) fn safe_path(path: &Path) -> Result<(), String> {
    if !path.is_absolute() || path.components().any(|component| matches!(component, Component::ParentDir)) {
        return Err("隔离目录必须是绝对路径且不含 `..`。".into());
    }
    for ancestor in path.ancestors() {
        match std::fs::symlink_metadata(ancestor) {
            Ok(meta) => {
                if meta.file_type().is_symlink() {
                    return Err("隔离目录经过符号链接/联接点，可能指向其它资料库，拒绝使用。".into());
                }
                #[cfg(windows)]
                {
                    use std::os::windows::fs::MetadataExt;
                    const REPARSE_POINT: u32 = 0x400;
                    if meta.file_attributes() & REPARSE_POINT != 0 {
                        return Err("隔离目录经过符号链接/联接点，可能指向其它资料库，拒绝使用。".into());
                    }
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("无法检查隔离目录的元数据，拒绝使用。".into()),
        }
    }
    Ok(())
}

fn same_path(a: &Path, b: &Path) -> bool {
    if cfg!(windows) {
        normalize(a) == normalize(b)
    } else {
        a.components().eq(b.components())
    }
}

fn normalize(path: &Path) -> String {
    let text = path.to_string_lossy().replace('/', "\\");
    text.trim_end_matches('\\').to_lowercase()
}

pub(crate) fn data_root_tail(root: &Path) -> String {
    let mut parts: Vec<String> = root
        .components()
        .rev()
        .take(2)
        .filter_map(|component| component.as_os_str().to_str().map(str::to_string))
        .collect();
    parts.reverse();
    parts.join("/")
}

fn build(identifier: String, product_name: String, root: &Path, verdict: Verdict) -> DevEnvironment {
    DevEnvironment {
        isolated: verdict.mode == Mode::Isolated,
        blocked: verdict.mode == Mode::Blocked,
        mode: verdict.mode,
        identifier,
        product_name,
        version: env!("CARGO_PKG_VERSION").to_string(),
        debug: cfg!(debug_assertions),
        instance: verdict.instance,
        code: verdict.code.map(str::to_string),
        reason: verdict.reason,
        data_root_tail: data_root_tail(root),
    }
}

static VERDICT: OnceLock<DevEnvironment> = OnceLock::new();

fn env_value(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|value| !value.trim().is_empty())
}

fn compute(app: &AppHandle) -> DevEnvironment {
    let identifier = app.config().identifier.clone();
    let product_name = app.config().product_name.clone().unwrap_or_else(|| "A4 Note".to_string());
    let root = match app.path().app_data_dir() {
        Ok(base) => base.join("AsterData"),
        Err(error) => {
            let verdict = if cfg!(debug_assertions) {
                blocked("data-dir-unavailable", format!("无法解析应用数据目录：{error}"))
            } else {
                Verdict { mode: Mode::Release, instance: None, code: None, reason: None }
            };
            return build(identifier, product_name, Path::new(""), verdict);
        }
    };
    let expected_id = env_value(EXPECTED_ID_ENV);
    let expected_root = env_value(EXPECTED_ROOT_ENV);
    let expected_profile = env_value(EXPECTED_PROFILE_ENV);
    let actual_profile = env_value(WEBVIEW_PROFILE_ENV);
    let verdict = classify(&Inputs {
        identifier: &identifier,
        root: &root,
        debug: cfg!(debug_assertions),
        expected_id: expected_id.as_deref(),
        expected_root: expected_root.as_deref(),
        expected_profile: expected_profile.as_deref(),
        actual_profile: actual_profile.as_deref(),
        allow_production: env_value(ALLOW_PRODUCTION_ENV).is_some_and(|value| value == "1" || value.eq_ignore_ascii_case("true")),
    });
    build(identifier, product_name, &root, verdict)
}

/// Computed once in `setup`, before any window can invoke a command.
pub(crate) fn initialize(app: &AppHandle) -> &'static DevEnvironment {
    VERDICT.get_or_init(|| compute(app))
}

/// `None` when the process may use its library. Before `initialize` (unit tests
/// that call command bodies directly) nothing is blocked; the real app always
/// initializes in `setup`.
pub(crate) fn block_reason() -> Option<String> {
    let verdict = VERDICT.get()?;
    if !verdict.blocked {
        return None;
    }
    Some(format!(
        "DEV 隔离校验失败（{}）：{}",
        verdict.code.as_deref().unwrap_or("blocked"),
        verdict.reason.as_deref().unwrap_or("")
    ))
}

/// Deliberately not behind `library_access::operation()`: a blocked window must
/// still be able to explain why it is blocked.
#[tauri::command]
pub(crate) fn get_dev_environment(app: AppHandle) -> DevEnvironment {
    initialize(&app).clone()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    struct Sandbox {
        root: PathBuf,
    }
    impl Sandbox {
        fn new(tag: &str) -> Self {
            let root = std::env::temp_dir().join(format!("a4-dev-env-{tag}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&root);
            std::fs::create_dir_all(root.join("app.aster.research")).unwrap();
            std::fs::write(root.join("app.aster.research").join("sentinel"), "DO NOT TOUCH").unwrap();
            Self { root }
        }
        fn production_untouched(&self) {
            let production = self.root.join("app.aster.research");
            assert_eq!(std::fs::read_to_string(production.join("sentinel")).unwrap(), "DO NOT TOUCH");
            assert_eq!(std::fs::read_dir(&production).unwrap().count(), 1);
        }
    }
    impl Drop for Sandbox {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    const ID: &str = "app.aster.research.dev.alpha.w1234567890";

    fn inputs<'a>(identifier: &'a str, root: &'a Path, profile: &'a str, expected_root: &'a str) -> Inputs<'a> {
        Inputs {
            identifier,
            root,
            debug: true,
            expected_id: Some(ID),
            expected_root: Some(expected_root),
            expected_profile: Some(profile),
            actual_profile: Some(profile),
            allow_production: false,
        }
    }

    #[test]
    fn launcher_admitted_instance_is_isolated() {
        let sandbox = Sandbox::new("ok");
        let root = sandbox.root.join(ID).join("AsterData");
        let profile = sandbox.root.join("state").join("webview");
        let (r, p) = (root.to_str().unwrap(), profile.to_str().unwrap());
        let verdict = classify(&inputs(ID, &root, p, r));
        assert_eq!(verdict.mode, Mode::Isolated);
        assert_eq!(verdict.instance.as_deref(), Some("alpha"));
        assert!(!root.exists(), "classification must not create directories");
        sandbox.production_untouched();
    }

    #[test]
    fn release_builds_are_never_labelled_or_blocked() {
        let sandbox = Sandbox::new("release");
        let production = sandbox.root.join("app.aster.research").join("AsterData");
        let verdict = classify(&Inputs { debug: false, ..inputs(PRODUCTION_IDENTIFIER, &production, "x", "y") });
        assert_eq!(verdict.mode, Mode::Release);
        let verdict = classify(&Inputs { debug: false, expected_id: None, expected_root: None, expected_profile: None, actual_profile: None, ..inputs(PRODUCTION_IDENTIFIER, &production, "x", "y") });
        assert_eq!(verdict.mode, Mode::Release);
        sandbox.production_untouched();
    }

    #[test]
    fn debug_build_refuses_production_library_unless_explicitly_allowed() {
        let sandbox = Sandbox::new("prod");
        let production = sandbox.root.join("app.aster.research").join("AsterData");
        let base = Inputs { identifier: PRODUCTION_IDENTIFIER, root: &production, debug: true, expected_id: None, expected_root: None, expected_profile: None, actual_profile: None, allow_production: false };
        let verdict = classify(&base);
        assert_eq!(verdict.mode, Mode::Blocked);
        assert_eq!(verdict.code, Some("production-library-in-debug"));
        assert!(verdict.reason.as_deref().unwrap().contains(ALLOW_PRODUCTION_ENV));
        let allowed = classify(&Inputs { allow_production: true, ..base });
        assert_eq!(allowed.mode, Mode::ProductionDebug);
        assert_eq!(allowed.code, Some("production-allowed"));
        sandbox.production_untouched();
    }

    #[test]
    fn every_mismatch_is_blocked_with_a_specific_code() {
        let sandbox = Sandbox::new("mismatch");
        let root = sandbox.root.join(ID).join("AsterData");
        let profile = sandbox.root.join("state").join("webview");
        let (r, p) = (root.to_str().unwrap(), profile.to_str().unwrap());
        let code = |verdict: Verdict| {
            assert_eq!(verdict.mode, Mode::Blocked);
            verdict.code.unwrap()
        };
        // Dev identity started without the launcher (no expectations at all).
        assert_eq!(code(classify(&Inputs { expected_id: None, expected_root: None, expected_profile: None, actual_profile: None, ..inputs(ID, &root, p, r) })), "missing-expected-identity");
        assert_eq!(code(classify(&Inputs { expected_id: Some("app.aster.research.dev.beta.w1"), ..inputs(ID, &root, p, r) })), "identity-mismatch");
        // Launcher expectations present but the binary carries the production identity.
        let production = sandbox.root.join("app.aster.research").join("AsterData");
        assert_eq!(code(classify(&inputs(PRODUCTION_IDENTIFIER, &production, p, production.to_str().unwrap()))), "identity-not-isolated");
        // Expected root pointing at a (synthetic) production directory.
        assert_eq!(code(classify(&inputs(ID, &root, p, production.to_str().unwrap()))), "root-mismatch");
        // Actual root under another instance.
        let other = sandbox.root.join("app.aster.research.dev.beta.w1").join("AsterData");
        assert_eq!(code(classify(&inputs(ID, &other, p, other.to_str().unwrap()))), "root-shape");
        assert_eq!(code(classify(&Inputs { expected_root: None, ..inputs(ID, &root, p, r) })), "missing-expected-root");
        assert_eq!(code(classify(&Inputs { expected_profile: None, ..inputs(ID, &root, p, r) })), "missing-expected-profile");
        assert_eq!(code(classify(&Inputs { actual_profile: None, ..inputs(ID, &root, p, r) })), "profile-mismatch");
        assert_eq!(code(classify(&Inputs { actual_profile: Some(r), ..inputs(ID, &root, p, r) })), "profile-mismatch");
        let nested = root.join("webview");
        let n = nested.to_str().unwrap();
        assert_eq!(code(classify(&Inputs { expected_profile: Some(n), actual_profile: Some(n), ..inputs(ID, &root, p, r) })), "profile-overlaps-root");
        assert_eq!(code(classify(&Inputs { allow_production: true, ..inputs(ID, &root, p, r) })), "conflicting-override");
        assert!(!root.exists());
        sandbox.production_untouched();
    }

    #[test]
    fn unsafe_paths_are_rejected() {
        assert!(safe_path(Path::new("relative/profile")).is_err());
        assert!(safe_path(&std::env::temp_dir().join("..").join("production")).is_err());
        let sandbox = Sandbox::new("safe");
        assert!(safe_path(&sandbox.root.join("missing").join("AsterData")).is_ok());
    }

    #[cfg(windows)]
    #[test]
    fn junction_ancestors_are_rejected() {
        let sandbox = Sandbox::new("junction");
        let target = sandbox.root.join("real");
        std::fs::create_dir_all(&target).unwrap();
        let alias = sandbox.root.join("alias");
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J", alias.to_str().unwrap(), target.to_str().unwrap()])
            .status()
            .unwrap();
        assert!(status.success());
        assert!(safe_path(&alias.join("AsterData")).is_err());
        assert!(safe_path(&target.join("AsterData")).is_ok());
        let _ = std::fs::remove_dir(&alias);
    }

    #[test]
    fn instance_name_and_root_tail_hide_user_directories() {
        assert_eq!(dev_instance_name(ID).as_deref(), Some("alpha"));
        assert_eq!(dev_instance_name("app.aster.research.dev.noHash").as_deref(), Some("noHash"));
        assert_eq!(dev_instance_name(PRODUCTION_IDENTIFIER), None);
        assert_eq!(dev_instance_name("app.aster.research.dev."), None);
        let tail = data_root_tail(Path::new("C:\\Users\\someone\\AppData\\Roaming\\app.aster.research.dev.alpha.w1\\AsterData"));
        assert!(!tail.contains("someone"));
        assert!(tail.ends_with("AsterData"));
    }

    #[test]
    fn same_path_tolerates_separator_and_case_differences_on_windows() {
        if cfg!(windows) {
            assert!(same_path(Path::new("C:\\Users\\A\\AppData\\Roaming\\x\\AsterData"), Path::new("c:/users/a/appdata/roaming/x/AsterData/")));
        }
        assert!(!same_path(Path::new("/a/b"), Path::new("/a/c")));
    }
}
