//! Workbench state persistence (PWS-1).
//!
//! The frontend owns the model in `src/core/workspace.ts`; this module only
//! stores one snapshot of it in normalized SQLite rows and reads it back in the
//! same shape. Timestamps stay ISO-8601 strings so the round trip is lossless.
//!
//! Saving replaces the whole snapshot inside one transaction. The workbench
//! holds tens of rows, so a full rewrite is cheaper to keep correct than a
//! row-level diff, and it can never leave rows behind from a removed project.
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::path::Path;

/// `workbench_state` holds a single row; the snapshot is global, not per project.
const SNAPSHOT_ROW_ID: i64 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbenchSnapshot {
    pub version: i64,
    #[serde(default)]
    pub projects: Vec<ProjectRecord>,
    #[serde(default)]
    pub workspaces: Vec<WorkspaceRecord>,
    #[serde(default)]
    pub resources: Vec<ResourceRecord>,
    #[serde(default)]
    pub agent_sessions: Vec<AgentSessionRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_project_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_workspace_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRecord {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub kind: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_opened_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceLayoutRecord {
    #[serde(default)]
    pub file_tree_visible: bool,
    #[serde(default)]
    pub right_drawer_visible: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRecord {
    pub id: String,
    pub project_id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_tab_id: Option<String>,
    pub layout: WorkspaceLayoutRecord,
    #[serde(default)]
    pub tabs: Vec<WorkspaceTabRecord>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTabRecord {
    pub id: String,
    pub workspace_id: String,
    pub kind: String,
    pub key: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    /// Free-form per-tab UI state owned by whichever view renders the tab.
    #[serde(default)]
    pub state: Map<String, Value>,
    #[serde(default)]
    pub pinned: bool,
    pub order: i64,
}

/// RES-2: one row per thing a tab can point at. `uri` arrives already normalized
/// by the frontend (`normalizeResourceUri`) and is stored verbatim — the URI
/// grammar lives in TypeScript only, so the two languages cannot drift apart.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceRecord {
    pub id: String,
    /// `None` is a workbench-wide resource; a project id scopes it to that project.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    pub kind: String,
    pub uri: String,
    pub title: String,
    /// Free-form per-resource facts owned by whichever feature registered it.
    #[serde(default)]
    pub metadata: Map<String, Value>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionRecord {
    pub id: String,
    pub project_id: String,
    pub workspace_id: String,
    pub provider_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    pub permission_mode: String,
    pub status: String,
    pub working_directory: String,
    pub created_at: String,
    pub updated_at: String,
}

/// `None` means the workbench has never been saved, so the caller keeps its
/// own empty state instead of overwriting it with a fabricated snapshot.
pub fn load_snapshot(database_path: &Path) -> Result<Option<WorkbenchSnapshot>, String> {
    let connection = open_database(database_path)?;
    read_snapshot(&connection)
}

pub fn save_snapshot(database_path: &Path, snapshot: &WorkbenchSnapshot) -> Result<(), String> {
    let mut connection = open_database(database_path)?;
    write_snapshot(&mut connection, snapshot)
}

/// The frontend already owns serialization (`serializeWorkbenchState`), so the
/// command boundary carries its JSON text verbatim instead of a second DTO.
/// Parsing here still validates the shape before any of it reaches SQL.
pub fn load_snapshot_json(database_path: &Path) -> Result<Option<String>, String> {
    match load_snapshot(database_path)? {
        Some(snapshot) => serde_json::to_string(&snapshot)
            .map(Some)
            .map_err(|error| format!("工作台快照序列化失败：{error}")),
        None => Ok(None),
    }
}

pub fn save_snapshot_json(database_path: &Path, raw: &str) -> Result<(), String> {
    let snapshot: WorkbenchSnapshot =
        serde_json::from_str(raw).map_err(|error| format!("工作台快照解析失败：{error}"))?;
    save_snapshot(database_path, &snapshot)
}

fn open_database(database_path: &Path) -> Result<Connection, String> {
    Connection::open(database_path).map_err(|error| error.to_string())
}

fn read_snapshot(connection: &Connection) -> Result<Option<WorkbenchSnapshot>, String> {
    let header = connection
        .query_row(
            "SELECT version, active_project_id, active_workspace_id FROM workbench_state WHERE id = ?1",
            params![SNAPSHOT_ROW_ID],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some((version, active_project_id, active_workspace_id)) = header else {
        return Ok(None);
    };
    Ok(Some(WorkbenchSnapshot {
        version,
        projects: read_projects(connection)?,
        workspaces: read_workspaces(connection)?,
        resources: read_resources(connection)?,
        agent_sessions: read_agent_sessions(connection)?,
        active_project_id,
        active_workspace_id,
    }))
}

fn read_projects(connection: &Connection) -> Result<Vec<ProjectRecord>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, name, root_path, kind, created_at, updated_at, last_opened_at \
             FROM projects ORDER BY rowid",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(ProjectRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                root_path: row.get(2)?,
                kind: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
                last_opened_at: row.get(6)?,
            })
        })
        .map_err(|error| error.to_string())?;
    let mut projects = Vec::new();
    for row in rows {
        projects.push(row.map_err(|error| error.to_string())?);
    }
    Ok(projects)
}

fn read_workspaces(connection: &Connection) -> Result<Vec<WorkspaceRecord>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, project_id, name, active_tab_id, file_tree_visible, right_drawer_visible, \
             created_at, updated_at FROM workspaces ORDER BY rowid",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(WorkspaceRecord {
                id: row.get(0)?,
                project_id: row.get(1)?,
                name: row.get(2)?,
                active_tab_id: row.get(3)?,
                layout: WorkspaceLayoutRecord {
                    file_tree_visible: row.get::<_, i64>(4)? != 0,
                    right_drawer_visible: row.get::<_, i64>(5)? != 0,
                },
                tabs: Vec::new(),
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(|error| error.to_string())?;
    let mut workspaces = Vec::new();
    for row in rows {
        let mut workspace = row.map_err(|error| error.to_string())?;
        workspace.tabs = read_tabs(connection, &workspace.id)?;
        workspaces.push(workspace);
    }
    Ok(workspaces)
}

fn read_tabs(
    connection: &Connection,
    workspace_id: &str,
) -> Result<Vec<WorkspaceTabRecord>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, workspace_id, kind, tab_key, title, resource_id, session_id, state_json, \
             pinned, tab_order FROM workspace_tabs WHERE workspace_id = ?1 ORDER BY tab_order",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![workspace_id], |row| {
            Ok(WorkspaceTabRecord {
                id: row.get(0)?,
                workspace_id: row.get(1)?,
                kind: row.get(2)?,
                key: row.get(3)?,
                title: row.get(4)?,
                resource_id: row.get(5)?,
                session_id: row.get(6)?,
                state: parse_state(&row.get::<_, String>(7)?),
                pinned: row.get::<_, i64>(8)? != 0,
                order: row.get(9)?,
            })
        })
        .map_err(|error| error.to_string())?;
    let mut tabs = Vec::new();
    for row in rows {
        tabs.push(row.map_err(|error| error.to_string())?);
    }
    Ok(tabs)
}

/// A tab whose `state_json` is unreadable still opens; the view falls back to
/// its own defaults instead of the whole snapshot failing to load. Resource
/// metadata is read the same way, for the same reason.
fn parse_state(raw: &str) -> Map<String, Value> {
    match serde_json::from_str::<Value>(raw) {
        Ok(Value::Object(map)) => map,
        _ => Map::new(),
    }
}

fn read_resources(connection: &Connection) -> Result<Vec<ResourceRecord>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, project_id, kind, uri, title, metadata_json, created_at, updated_at \
             FROM resources ORDER BY rowid",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(ResourceRecord {
                id: row.get(0)?,
                project_id: row.get(1)?,
                kind: row.get(2)?,
                uri: row.get(3)?,
                title: row.get(4)?,
                metadata: parse_state(&row.get::<_, String>(5)?),
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(|error| error.to_string())?;
    let mut resources = Vec::new();
    for row in rows {
        resources.push(row.map_err(|error| error.to_string())?);
    }
    Ok(resources)
}

fn read_agent_sessions(connection: &Connection) -> Result<Vec<AgentSessionRecord>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, project_id, workspace_id, provider_id, provider_session_id, model_id, \
             permission_mode, status, working_directory, created_at, updated_at \
             FROM agent_sessions ORDER BY rowid",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(AgentSessionRecord {
                id: row.get(0)?,
                project_id: row.get(1)?,
                workspace_id: row.get(2)?,
                provider_id: row.get(3)?,
                provider_session_id: row.get(4)?,
                model_id: row.get(5)?,
                permission_mode: row.get(6)?,
                status: row.get(7)?,
                working_directory: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })
        .map_err(|error| error.to_string())?;
    let mut sessions = Vec::new();
    for row in rows {
        sessions.push(row.map_err(|error| error.to_string())?);
    }
    Ok(sessions)
}

fn write_snapshot(connection: &mut Connection, snapshot: &WorkbenchSnapshot) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    // Children before parents so the order stays valid whether or not
    // `PRAGMA foreign_keys` is enabled on this connection.
    for statement in [
        "DELETE FROM workspace_tabs",
        "DELETE FROM agent_sessions",
        "DELETE FROM workspaces",
        "DELETE FROM resources",
        "DELETE FROM projects",
    ] {
        transaction
            .execute(statement, [])
            .map_err(|error| error.to_string())?;
    }
    for project in &snapshot.projects {
        transaction
            .execute(
                "INSERT INTO projects \
                 (id, name, root_path, kind, created_at, updated_at, last_opened_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    project.id,
                    project.name,
                    project.root_path,
                    project.kind,
                    project.created_at,
                    project.updated_at,
                    project.last_opened_at,
                ],
            )
            .map_err(|error| error.to_string())?;
    }
    for resource in &snapshot.resources {
        let metadata = Value::Object(resource.metadata.clone()).to_string();
        transaction
            .execute(
                "INSERT INTO resources \
                 (id, project_id, kind, uri, title, metadata_json, created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    resource.id,
                    resource.project_id,
                    resource.kind,
                    resource.uri,
                    resource.title,
                    metadata,
                    resource.created_at,
                    resource.updated_at,
                ],
            )
            .map_err(|error| error.to_string())?;
    }
    for workspace in &snapshot.workspaces {
        transaction
            .execute(
                "INSERT INTO workspaces \
                 (id, project_id, name, active_tab_id, file_tree_visible, right_drawer_visible, \
                 created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    workspace.id,
                    workspace.project_id,
                    workspace.name,
                    workspace.active_tab_id,
                    i64::from(workspace.layout.file_tree_visible),
                    i64::from(workspace.layout.right_drawer_visible),
                    workspace.created_at,
                    workspace.updated_at,
                ],
            )
            .map_err(|error| error.to_string())?;
        for tab in &workspace.tabs {
            let state = Value::Object(tab.state.clone()).to_string();
            transaction
                .execute(
                    "INSERT INTO workspace_tabs \
                     (id, workspace_id, kind, tab_key, title, resource_id, session_id, \
                     state_json, pinned, tab_order) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                    params![
                        tab.id,
                        tab.workspace_id,
                        tab.kind,
                        tab.key,
                        tab.title,
                        tab.resource_id,
                        tab.session_id,
                        state,
                        i64::from(tab.pinned),
                        tab.order,
                    ],
                )
                .map_err(|error| error.to_string())?;
        }
    }
    for session in &snapshot.agent_sessions {
        transaction
            .execute(
                "INSERT INTO agent_sessions \
                 (id, project_id, workspace_id, provider_id, provider_session_id, model_id, \
                 permission_mode, status, working_directory, created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    session.id,
                    session.project_id,
                    session.workspace_id,
                    session.provider_id,
                    session.provider_session_id,
                    session.model_id,
                    session.permission_mode,
                    session.status,
                    session.working_directory,
                    session.created_at,
                    session.updated_at,
                ],
            )
            .map_err(|error| error.to_string())?;
    }
    // `agent_messages` is deliberately not a child of `agent_sessions` (see
    // `schema.sql`): the table above is rewritten wholesale on every save, so a
    // cascade would erase every conversation on a tab drag. Sweeping from inside
    // this transaction keeps the two consistent anyway — this is the only place
    // that authoritatively knows which sessions are left.
    let live_session_ids: Vec<String> = snapshot
        .agent_sessions
        .iter()
        .map(|session| session.id.clone())
        .collect();
    crate::agent_history::prune_orphans(&transaction, &live_session_ids)?;
    transaction
        .execute(
            "INSERT INTO workbench_state \
             (id, version, active_project_id, active_workspace_id, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5) \
             ON CONFLICT(id) DO UPDATE SET version = excluded.version, \
             active_project_id = excluded.active_project_id, \
             active_workspace_id = excluded.active_workspace_id, \
             updated_at = excluded.updated_at",
            params![
                SNAPSHOT_ROW_ID,
                snapshot.version,
                snapshot.active_project_id,
                snapshot.active_workspace_id,
                crate::database::current_timestamp_ms(),
            ],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory_connection() -> Connection {
        let connection = Connection::open_in_memory().expect("open in-memory database");
        connection
            .execute_batch(crate::database::schema_sql())
            .expect("apply schema");
        connection
    }

    fn tab(id: &str, kind: &str, key: &str, order: i64) -> WorkspaceTabRecord {
        WorkspaceTabRecord {
            id: id.into(),
            workspace_id: "workspace-main".into(),
            kind: kind.into(),
            key: key.into(),
            title: key.into(),
            resource_id: None,
            session_id: None,
            state: Map::new(),
            pinned: false,
            order,
        }
    }

    fn session(id: &str) -> AgentSessionRecord {
        AgentSessionRecord {
            id: id.into(),
            project_id: "project-folder".into(),
            workspace_id: "workspace-main".into(),
            provider_id: "codex".into(),
            provider_session_id: None,
            model_id: Some("gpt-5-codex".into()),
            permission_mode: "default".into(),
            status: "failed".into(),
            working_directory: "D:/WorkSpace/Aster".into(),
            created_at: "2026-07-31T00:00:00.000Z".into(),
            updated_at: "2026-07-31T00:10:00.000Z".into(),
        }
    }

    fn project(id: &str, kind: &str, root_path: &str) -> ProjectRecord {
        ProjectRecord {
            id: id.into(),
            name: id.into(),
            root_path: root_path.into(),
            kind: kind.into(),
            created_at: "2026-07-31T00:00:00.000Z".into(),
            updated_at: "2026-07-31T00:00:00.000Z".into(),
            last_opened_at: None,
        }
    }

    fn sample_snapshot() -> WorkbenchSnapshot {
        let mut reader_state = Map::new();
        reader_state.insert("page".to_string(), Value::from(12));
        reader_state.insert("mode".to_string(), Value::from("translated"));
        let mut pdf_tab = tab("tab-pdf", "file", "file:D:/paper.pdf", 1);
        pdf_tab.state = reader_state;
        pdf_tab.pinned = true;
        pdf_tab.resource_id = Some("resource-1".into());
        let mut metadata = Map::new();
        metadata.insert("pages".to_string(), Value::from(24));
        WorkbenchSnapshot {
            version: 1,
            projects: vec![
                project("project-library", "builtin", "aster://library"),
                project("project-folder", "folder", "D:/WorkSpace/Aster"),
            ],
            workspaces: vec![WorkspaceRecord {
                id: "workspace-main".into(),
                project_id: "project-folder".into(),
                name: "主工作区".into(),
                active_tab_id: Some("tab-pdf".into()),
                layout: WorkspaceLayoutRecord {
                    file_tree_visible: true,
                    right_drawer_visible: false,
                },
                tabs: vec![tab("tab-overview", "tool", "tool:overview", 0), pdf_tab],
                created_at: "2026-07-31T00:00:00.000Z".into(),
                updated_at: "2026-07-31T00:05:00.000Z".into(),
            }],
            resources: vec![
                ResourceRecord {
                    id: "resource-1".into(),
                    project_id: Some("project-folder".into()),
                    kind: "pdf".into(),
                    uri: "file:///D:/paper.pdf".into(),
                    title: "paper.pdf".into(),
                    metadata,
                    created_at: "2026-07-31T00:00:00.000Z".into(),
                    updated_at: "2026-07-31T00:00:00.000Z".into(),
                },
                ResourceRecord {
                    id: "resource-2".into(),
                    project_id: None,
                    kind: "web".into(),
                    uri: "https://example.com/spec".into(),
                    title: "spec".into(),
                    metadata: Map::new(),
                    created_at: "2026-07-31T00:01:00.000Z".into(),
                    updated_at: "2026-07-31T00:01:00.000Z".into(),
                },
            ],
            agent_sessions: vec![session("session-1")],
            active_project_id: Some("project-folder".into()),
            active_workspace_id: Some("workspace-main".into()),
        }
    }

    fn count(connection: &Connection, table: &str) -> i64 {
        connection
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get::<_, i64>(0)
            })
            .expect("count rows")
    }

    #[test]
    fn never_saved_workbench_reads_as_none() {
        let connection = memory_connection();
        assert_eq!(read_snapshot(&connection).expect("read"), None);
    }

    #[test]
    fn snapshot_round_trips() {
        let mut connection = memory_connection();
        let snapshot = sample_snapshot();
        write_snapshot(&mut connection, &snapshot).expect("write");
        let restored = read_snapshot(&connection).expect("read").expect("snapshot");
        assert_eq!(restored, snapshot);
    }

    #[test]
    fn tabs_restore_by_order_not_insert_sequence() {
        let mut connection = memory_connection();
        let mut snapshot = sample_snapshot();
        snapshot.workspaces[0].tabs = vec![
            tab("tab-c", "tool", "tool:aiChat", 2),
            tab("tab-a", "tool", "tool:overview", 0),
            tab("tab-b", "tool", "tool:library", 1),
        ];
        write_snapshot(&mut connection, &snapshot).expect("write");
        let restored = read_snapshot(&connection).expect("read").expect("snapshot");
        let ids: Vec<&str> = restored.workspaces[0]
            .tabs
            .iter()
            .map(|tab| tab.id.as_str())
            .collect();
        assert_eq!(ids, vec!["tab-a", "tab-b", "tab-c"]);
    }

    #[test]
    fn tab_state_survives_the_round_trip() {
        let mut connection = memory_connection();
        let snapshot = sample_snapshot();
        write_snapshot(&mut connection, &snapshot).expect("write");
        let restored = read_snapshot(&connection).expect("read").expect("snapshot");
        let state = &restored.workspaces[0].tabs[1].state;
        assert_eq!(state.get("page"), Some(&Value::from(12)));
        assert_eq!(state.get("mode"), Some(&Value::from("translated")));
    }

    #[test]
    fn unreadable_tab_state_falls_back_to_empty_map() {
        let mut connection = memory_connection();
        write_snapshot(&mut connection, &sample_snapshot()).expect("write");
        connection
            .execute("UPDATE workspace_tabs SET state_json = 'not json'", [])
            .expect("corrupt state");
        let restored = read_snapshot(&connection).expect("read").expect("snapshot");
        assert!(restored.workspaces[0].tabs[1].state.is_empty());
    }

    #[test]
    fn resaving_leaves_no_rows_from_removed_projects() {
        let mut connection = memory_connection();
        write_snapshot(&mut connection, &sample_snapshot()).expect("first write");
        let smaller = WorkbenchSnapshot {
            version: 1,
            projects: vec![project("project-library", "builtin", "aster://library")],
            workspaces: Vec::new(),
            resources: Vec::new(),
            agent_sessions: Vec::new(),
            active_project_id: Some("project-library".into()),
            active_workspace_id: None,
        };
        write_snapshot(&mut connection, &smaller).expect("second write");
        assert_eq!(count(&connection, "projects"), 1);
        assert_eq!(count(&connection, "workspaces"), 0);
        assert_eq!(count(&connection, "workspace_tabs"), 0);
        assert_eq!(count(&connection, "resources"), 0);
        assert_eq!(count(&connection, "agent_sessions"), 0);
        assert_eq!(count(&connection, "workbench_state"), 1);
        let restored = read_snapshot(&connection).expect("read").expect("snapshot");
        assert_eq!(restored, smaller);
    }

    /// The snapshot rewrites `agent_sessions` wholesale on every tab drag, so the
    /// one thing this must never do is take the conversations with it.
    #[test]
    fn agent_history_survives_a_snapshot_rewrite() {
        let mut connection = memory_connection();
        write_snapshot(&mut connection, &sample_snapshot()).expect("first write");
        connection
            .execute(
                "INSERT INTO agent_messages \
                 (session_id, seq, prompt, run_id, status, answer, created_at, updated_at) \
                 VALUES ('session-1', 0, '你好', 'session-1-1', 'completed', '在', \
                 '2026-08-11T00:00:00.000Z', '2026-08-11T00:00:01.000Z')",
                [],
            )
            .expect("insert history");
        write_snapshot(&mut connection, &sample_snapshot()).expect("second write");
        assert_eq!(count(&connection, "agent_messages"), 1);
    }

    /// A session the user actually closed is different: its history goes with it,
    /// swept from inside the same transaction because no cascade can do it.
    #[test]
    fn history_of_a_removed_session_is_swept_with_it() {
        let mut connection = memory_connection();
        write_snapshot(&mut connection, &sample_snapshot()).expect("first write");
        connection
            .execute(
                "INSERT INTO agent_messages \
                 (session_id, seq, prompt, run_id, status, answer, created_at, updated_at) \
                 VALUES ('session-gone', 0, '你好', 'session-gone-1', 'completed', '在', \
                 '2026-08-11T00:00:00.000Z', '2026-08-11T00:00:01.000Z')",
                [],
            )
            .expect("insert history");
        write_snapshot(&mut connection, &sample_snapshot()).expect("second write");
        assert_eq!(count(&connection, "agent_messages"), 0);
    }

    #[test]
    fn resources_survive_the_round_trip_with_and_without_a_project() {
        let mut connection = memory_connection();
        let snapshot = sample_snapshot();
        write_snapshot(&mut connection, &snapshot).expect("write");
        let restored = read_snapshot(&connection).expect("read").expect("snapshot");
        assert_eq!(restored.resources, snapshot.resources);
        assert_eq!(
            restored.resources[0].metadata.get("pages"),
            Some(&Value::from(24))
        );
        assert_eq!(restored.resources[1].project_id, None);
    }

    /// Dedup lives in the frontend model, so two rows for one URI must still save:
    /// a model bug should show up as a duplicate record, never as a failed write.
    #[test]
    fn two_resources_may_share_one_uri() {
        let mut connection = memory_connection();
        let mut snapshot = sample_snapshot();
        let mut twin = snapshot.resources[0].clone();
        twin.id = "resource-1-twin".into();
        snapshot.resources.push(twin);
        write_snapshot(&mut connection, &snapshot).expect("write");
        assert_eq!(count(&connection, "resources"), 3);
    }

    /// A snapshot written before RES-2 has no `resources` key at all.
    #[test]
    fn a_snapshot_without_resources_loads_as_an_empty_registry() {
        let path = std::env::temp_dir().join(format!(
            "a4note-workbench-legacy-{}-{}.db",
            std::process::id(),
            crate::database::current_timestamp_ms()
        ));
        let _ = std::fs::remove_file(&path);
        crate::database::initialize_database(&path).expect("initialize database");
        let raw = r#"{"version":1,"projects":[],"workspaces":[],"agentSessions":[]}"#;
        save_snapshot_json(&path, raw).expect("save");
        let restored = load_snapshot(&path).expect("load").expect("snapshot");
        assert_eq!(restored.resources, Vec::new());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn schema_can_be_applied_to_an_existing_database() {
        let connection = memory_connection();
        connection
            .execute_batch(crate::database::schema_sql())
            .expect("re-apply schema");
        assert_eq!(count(&connection, "workbench_state"), 0);
    }

    #[test]
    fn json_boundary_round_trips_through_a_real_file() {
        let path = std::env::temp_dir().join(format!(
            "a4note-workbench-{}-{}.db",
            std::process::id(),
            crate::database::current_timestamp_ms()
        ));
        let _ = std::fs::remove_file(&path);
        crate::database::initialize_database(&path).expect("initialize database");
        assert_eq!(load_snapshot_json(&path).expect("load empty"), None);
        let raw = serde_json::to_string(&sample_snapshot()).expect("serialize");
        save_snapshot_json(&path, &raw).expect("save");
        let restored = load_snapshot_json(&path).expect("load").expect("snapshot");
        assert_eq!(
            serde_json::from_str::<Value>(&restored).expect("parse restored"),
            serde_json::from_str::<Value>(&raw).expect("parse original")
        );
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn camel_case_json_matches_the_frontend_shape() {
        let raw = serde_json::to_string(&sample_snapshot()).expect("serialize");
        assert!(raw.contains("\"agentSessions\""));
        assert!(raw.contains("\"activeWorkspaceId\""));
        assert!(raw.contains("\"rightDrawerVisible\""));
        assert!(raw.contains("\"workspaceId\""));
        assert!(raw.contains("\"resources\""));
        // Absent optionals stay absent so the TypeScript normalizer keeps its
        // own defaults instead of seeing explicit nulls.
        assert!(!raw.contains("\"lastOpenedAt\":null"));
        assert!(!raw.contains("\"providerSessionId\":null"));
        assert!(!raw.contains("\"projectId\":null"));
    }

    #[test]
    fn unknown_fields_from_a_newer_frontend_do_not_break_saving() {
        let path = std::env::temp_dir().join(format!(
            "a4note-workbench-forward-{}-{}.db",
            std::process::id(),
            crate::database::current_timestamp_ms()
        ));
        let _ = std::fs::remove_file(&path);
        crate::database::initialize_database(&path).expect("initialize database");
        let raw =
            r#"{"version":1,"projects":[],"workspaces":[],"agentSessions":[],"futureFlag":true}"#;
        save_snapshot_json(&path, raw).expect("save");
        let restored = load_snapshot_json(&path).expect("load").expect("snapshot");
        assert!(restored.contains("\"version\":1"));
        let _ = std::fs::remove_file(&path);
    }
}
