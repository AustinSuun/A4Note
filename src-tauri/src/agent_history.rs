//! Agent conversation history (CLI-4).
//!
//! The transcript's shape belongs to the frontend (`src/core/agentHistory.ts`);
//! this module only stores one row per exchange and reads it back in the same
//! shape. It is a store, not a runtime: nothing here talks to a CLI, and
//! `crate::agent_cli` never learns that SQLite exists.
//!
//! Two deliberate differences from `workbench_store`. Writes are an UPSERT of
//! the rows that changed, not a full rewrite — a streaming answer updates one
//! row many times, and rewriting a hundred turns for every delta would be
//! wasteful. And `tool_payloads_json` / `error_json` stay opaque JSON: their
//! meaning is the provider's and the UI's, so re-modelling them here would be a
//! second source of truth for a contract that already has one.
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;

/// One exchange. `(session_id, seq)` is the identity, so the answer that grows
/// while a turn streams keeps updating the same row.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessageRecord {
    pub session_id: String,
    pub seq: i64,
    pub prompt: String,
    pub run_id: String,
    pub status: String,
    #[serde(default)]
    pub answer: String,
    #[serde(default)]
    pub tool_payloads: Vec<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<Value>,
    pub created_at: String,
    pub updated_at: String,
}

pub fn load_messages(
    database_path: &Path,
    session_id: &str,
) -> Result<Vec<AgentMessageRecord>, String> {
    let connection = open_database(database_path)?;
    read_messages(&connection, session_id)
}

pub fn save_messages(database_path: &Path, records: &[AgentMessageRecord]) -> Result<(), String> {
    if records.is_empty() {
        return Ok(());
    }
    let mut connection = open_database(database_path)?;
    write_messages(&mut connection, records)
}

fn open_database(database_path: &Path) -> Result<Connection, String> {
    Connection::open(database_path).map_err(|error| error.to_string())
}

/// Ordered by `seq`, which is the turn order the frontend assigned — never by
/// insert order, because a resumed turn can be written after a later one.
fn read_messages(
    connection: &Connection,
    session_id: &str,
) -> Result<Vec<AgentMessageRecord>, String> {
    let mut statement = connection
        .prepare(
            "SELECT session_id, seq, prompt, run_id, status, answer, tool_payloads_json, \
             error_json, created_at, updated_at FROM agent_messages \
             WHERE session_id = ?1 ORDER BY seq",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![session_id], |row| {
            Ok(AgentMessageRecord {
                session_id: row.get(0)?,
                seq: row.get(1)?,
                prompt: row.get(2)?,
                run_id: row.get(3)?,
                status: row.get(4)?,
                answer: row.get(5)?,
                tool_payloads: parse_payloads(&row.get::<_, String>(6)?),
                error: parse_error(row.get::<_, Option<String>>(7)?),
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })
        .map_err(|error| error.to_string())?;
    let mut records = Vec::new();
    for row in rows {
        records.push(row.map_err(|error| error.to_string())?);
    }
    Ok(records)
}

/// A turn whose tool notices are unreadable still shows its answer, for the same
/// reason an unreadable tab state still opens the tab: losing one accessory must
/// not lose the conversation.
fn parse_payloads(raw: &str) -> Vec<Value> {
    match serde_json::from_str::<Value>(raw) {
        Ok(Value::Array(items)) => items,
        _ => Vec::new(),
    }
}

fn parse_error(raw: Option<String>) -> Option<Value> {
    let raw = raw?;
    match serde_json::from_str::<Value>(&raw) {
        Ok(Value::Null) => None,
        Ok(value) => Some(value),
        Err(_) => None,
    }
}

/// `created_at` is written once and then left alone: it is when the user sent
/// the message, and every later write of that row is the answer growing.
fn write_messages(
    connection: &mut Connection,
    records: &[AgentMessageRecord],
) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    for record in records {
        let payloads = Value::Array(record.tool_payloads.clone()).to_string();
        let error = record.error.as_ref().map(|value| value.to_string());
        transaction
            .execute(
                "INSERT INTO agent_messages \
                 (session_id, seq, prompt, run_id, status, answer, tool_payloads_json, \
                 error_json, created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) \
                 ON CONFLICT(session_id, seq) DO UPDATE SET prompt = excluded.prompt, \
                 run_id = excluded.run_id, status = excluded.status, answer = excluded.answer, \
                 tool_payloads_json = excluded.tool_payloads_json, \
                 error_json = excluded.error_json, updated_at = excluded.updated_at",
                params![
                    record.session_id,
                    record.seq,
                    record.prompt,
                    record.run_id,
                    record.status,
                    record.answer,
                    payloads,
                    error,
                    record.created_at,
                    record.updated_at,
                ],
            )
            .map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())
}

/// Drops the history of sessions that no longer exist. Called from the workbench
/// snapshot transaction (`workbench_store::write_snapshot`), which is the one
/// place that authoritatively knows which sessions are left — this table cannot
/// cascade off `agent_sessions`, because that table is rewritten wholesale.
pub(crate) fn prune_orphans(
    connection: &Connection,
    live_session_ids: &[String],
) -> Result<(), String> {
    if live_session_ids.is_empty() {
        connection
            .execute("DELETE FROM agent_messages", [])
            .map_err(|error| error.to_string())?;
        return Ok(());
    }
    let placeholders = (1..=live_session_ids.len())
        .map(|index| format!("?{index}"))
        .collect::<Vec<_>>()
        .join(", ");
    let statement = format!("DELETE FROM agent_messages WHERE session_id NOT IN ({placeholders})");
    let parameters: Vec<&dyn rusqlite::ToSql> = live_session_ids
        .iter()
        .map(|id| id as &dyn rusqlite::ToSql)
        .collect();
    connection
        .execute(&statement, parameters.as_slice())
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn memory_connection() -> Connection {
        let connection = Connection::open_in_memory().expect("open in-memory database");
        connection
            .execute_batch(crate::database::schema_sql())
            .expect("apply schema");
        connection
    }

    fn record(session_id: &str, seq: i64, prompt: &str, answer: &str) -> AgentMessageRecord {
        AgentMessageRecord {
            session_id: session_id.into(),
            seq,
            prompt: prompt.into(),
            run_id: format!("{session_id}-{}", seq + 1),
            status: "completed".into(),
            answer: answer.into(),
            tool_payloads: Vec::new(),
            error: None,
            created_at: "2026-08-11T00:00:00.000Z".into(),
            updated_at: "2026-08-11T00:00:01.000Z".into(),
        }
    }

    fn count(connection: &Connection) -> i64 {
        connection
            .query_row("SELECT COUNT(*) FROM agent_messages", [], |row| {
                row.get::<_, i64>(0)
            })
            .expect("count rows")
    }

    #[test]
    fn a_session_without_history_reads_as_an_empty_list() {
        let connection = memory_connection();
        assert_eq!(read_messages(&connection, "session-1").expect("read"), []);
    }

    #[test]
    fn messages_round_trip_with_tools_and_an_error() {
        let mut connection = memory_connection();
        let mut first = record("session-1", 0, "你好", "你好，我在。");
        first.tool_payloads = vec![
            json!({ "kind": "command", "detail": "cargo test" }),
            json!({ "kind": "patch", "status": "completed" }),
        ];
        let mut second = record("session-1", 1, "跑一下测试", "");
        second.status = "failed".into();
        second.error = Some(json!({ "kind": "exited", "message": "退出码 9", "exitCode": 9 }));
        write_messages(&mut connection, &[first.clone(), second.clone()]).expect("write");
        let restored = read_messages(&connection, "session-1").expect("read");
        assert_eq!(restored, vec![first, second]);
    }

    #[test]
    fn history_reads_back_in_turn_order_not_insert_order() {
        let mut connection = memory_connection();
        write_messages(
            &mut connection,
            &[
                record("session-1", 2, "第三条", "c"),
                record("session-1", 0, "第一条", "a"),
                record("session-1", 1, "第二条", "b"),
            ],
        )
        .expect("write");
        let seqs: Vec<i64> = read_messages(&connection, "session-1")
            .expect("read")
            .iter()
            .map(|record| record.seq)
            .collect();
        assert_eq!(seqs, vec![0, 1, 2]);
    }

    /// A streaming answer is the same turn getting longer, so it must update the
    /// row instead of adding one — and `created_at` stays when the user sent it.
    #[test]
    fn rewriting_a_turn_updates_it_in_place_and_keeps_created_at() {
        let mut connection = memory_connection();
        let mut streaming = record("session-1", 0, "你好", "你");
        streaming.status = "running".into();
        write_messages(&mut connection, &[streaming.clone()]).expect("first write");
        let mut finished = streaming.clone();
        finished.answer = "你好，我在。".into();
        finished.status = "completed".into();
        finished.created_at = "2099-01-01T00:00:00.000Z".into();
        finished.updated_at = "2026-08-11T00:00:09.000Z".into();
        write_messages(&mut connection, &[finished]).expect("second write");
        let restored = read_messages(&connection, "session-1").expect("read");
        assert_eq!(count(&connection), 1);
        assert_eq!(restored[0].answer, "你好，我在。");
        assert_eq!(restored[0].status, "completed");
        assert_eq!(restored[0].created_at, streaming.created_at);
        assert_eq!(restored[0].updated_at, "2026-08-11T00:00:09.000Z");
    }

    #[test]
    fn one_session_never_reads_anothers_history() {
        let mut connection = memory_connection();
        write_messages(
            &mut connection,
            &[
                record("session-1", 0, "我的", "a"),
                record("session-2", 0, "别人的", "b"),
            ],
        )
        .expect("write");
        let mine = read_messages(&connection, "session-1").expect("read");
        assert_eq!(mine.len(), 1);
        assert_eq!(mine[0].prompt, "我的");
    }

    #[test]
    fn unreadable_json_columns_fall_back_instead_of_failing_the_read() {
        let mut connection = memory_connection();
        write_messages(&mut connection, &[record("session-1", 0, "你好", "在")]).expect("write");
        connection
            .execute(
                "UPDATE agent_messages SET tool_payloads_json = 'not json', error_json = '{'",
                [],
            )
            .expect("corrupt json columns");
        let restored = read_messages(&connection, "session-1").expect("read");
        assert_eq!(restored[0].answer, "在");
        assert!(restored[0].tool_payloads.is_empty());
        assert_eq!(restored[0].error, None);
    }

    #[test]
    fn pruning_keeps_the_sessions_that_still_exist() {
        let mut connection = memory_connection();
        write_messages(
            &mut connection,
            &[
                record("session-live", 0, "留下", "a"),
                record("session-gone", 0, "删掉", "b"),
            ],
        )
        .expect("write");
        prune_orphans(&connection, &["session-live".to_string()]).expect("prune");
        assert_eq!(count(&connection), 1);
        assert_eq!(
            read_messages(&connection, "session-live").expect("read")[0].prompt,
            "留下"
        );
    }

    #[test]
    fn pruning_with_no_sessions_left_clears_every_row() {
        let mut connection = memory_connection();
        write_messages(&mut connection, &[record("session-1", 0, "你好", "在")]).expect("write");
        prune_orphans(&connection, &[]).expect("prune");
        assert_eq!(count(&connection), 0);
    }

    #[test]
    fn camel_case_json_matches_the_frontend_shape() {
        let mut sample = record("session-1", 0, "你好", "在");
        sample.tool_payloads = vec![json!({ "kind": "command" })];
        let raw = serde_json::to_string(&sample).expect("serialize");
        assert!(raw.contains("\"sessionId\""));
        assert!(raw.contains("\"runId\""));
        assert!(raw.contains("\"toolPayloads\""));
        assert!(raw.contains("\"createdAt\""));
        // An absent error stays absent, so the TypeScript side sees no key rather
        // than an explicit null it would have to filter out.
        assert!(!raw.contains("\"error\""));
    }

    #[test]
    fn the_command_boundary_round_trips_through_a_real_file() {
        let path = std::env::temp_dir().join(format!(
            "a4note-agent-history-{}-{}.db",
            std::process::id(),
            crate::database::current_timestamp_ms()
        ));
        let _ = std::fs::remove_file(&path);
        crate::database::initialize_database(&path).expect("initialize database");
        assert_eq!(load_messages(&path, "session-1").expect("load empty"), []);
        // An empty write is a no-op rather than an error: the frontend diffs
        // before writing, and "nothing changed" is the common case.
        save_messages(&path, &[]).expect("save nothing");
        let records = vec![record("session-1", 0, "你好", "在")];
        save_messages(&path, &records).expect("save");
        assert_eq!(load_messages(&path, "session-1").expect("load"), records);
        let _ = std::fs::remove_file(&path);
    }
}
