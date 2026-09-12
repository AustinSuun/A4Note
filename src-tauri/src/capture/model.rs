//! Wire validation is separate from the library's legacy data model.
use serde_json::{json, Value};
use std::collections::HashSet;
use uuid::Uuid;
pub const MAX_BODY: usize = 1024 * 1024;
pub const MAX_FILES: usize = 100;
pub fn validate(v: &Value) -> Result<(), String> {
    if v["schemaVersion"] != 1 || v["origin"] != "browser" { return Err("unsupported_capture_schema".into()); }
    let id = v["captureId"].as_str().ok_or("missing_capture_id")?;
    let parsed = Uuid::parse_str(id).map_err(|_| "invalid_capture_id")?;
    if parsed.to_string() != id { return Err("invalid_capture_id".into()); }
    let source = v["sourceUrl"].as_str().ok_or("missing_source")?;
    let url = reqwest::Url::parse(source).map_err(|_| "invalid_source")?;
    if !matches!(url.scheme(), "https" | "http") || !url.username().is_empty() || url.password().is_some() { return Err("invalid_source".into()); }
    if v["capturedAt"].as_str().filter(|s| s.len() <= 80).is_none() || !v["metadata"].is_object()
        || v["metadata"]["title"].as_str().filter(|s| s.len() <= 24000).is_none()
        || !v["metadata"]["authors"].is_array() || !v["metadata"]["identifiers"].is_object()
        || !v["evidence"].is_array() || !v["raw"].is_object() || !v["warnings"].is_array() {
        return Err("invalid_capture_metadata".into());
    }
    super::folders::requested(v)?;
    let files = v["artifacts"].as_array().ok_or("invalid_artifacts")?;
    if files.len() > MAX_FILES { return Err("too_many_artifacts_max_100".into()); }
    let mut seen = HashSet::new();
    for f in files {
        let id = f["id"].as_str().filter(|s| !s.is_empty() && s.len() <= 100).ok_or("invalid_artifact_id")?;
        if !seen.insert(id) { return Err("duplicate_artifact_id".into()); }
        if !matches!(f["role"].as_str(), Some("fulltext" | "supplement" | "citation" | "dataset" | "code"))
            || f["state"] != "discovered" || f["url"].as_str().filter(|s| s.len() <= 8192).is_none() {
            return Err("invalid_artifact".into());
        }
        for key in ["storedPath", "sha256", "byteLength", "path", "original_path"] {
            if f.get(key).is_some() { return Err("client_must_not_assign_local_files".into()); }
        }
    }
    Ok(())
}
pub fn failure(code: &str) -> Value { json!({"error": code}) }
#[cfg(test)]
pub fn fixture() -> Value {
    json!({"schemaVersion":1,"captureId":Uuid::new_v4().to_string(),"origin":"browser",
        "capturedAt":"2026-09-11T00:00:00Z","sourceUrl":"https://arxiv.org/abs/2401.12345",
        "metadata":{"title":"Fixture","authors":[],"identifiers":{}},"artifacts":[],"evidence":[],"raw":{},"warnings":[]})
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn capture_wire_rejects_local_paths_and_schema_changes() {
        let mut v = fixture(); assert!(validate(&v).is_ok());
        v["schemaVersion"] = json!(2); assert!(validate(&v).is_err()); v["schemaVersion"] = json!(1);
        v["artifacts"] = json!([{"id":"a","role":"fulltext","state":"discovered","url":"https://example.org/a.pdf","storedPath":"C:/secret"}]);
        assert!(validate(&v).is_err());
        v["captureId"] = json!("../../outside"); assert!(validate(&v).is_err());
    }
}
