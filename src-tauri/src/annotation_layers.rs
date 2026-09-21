//! Annotation layers (fb5e3f2f).
//!
//! A layer groups marks that belong to one pass over a document: the first read,
//! a revision, the third attempt at a problem set. Layers are owned by a stable
//! domain object — `(owner_kind, owner_id)` is `paper` for literature (source and
//! translated PDFs share the same layers) or `resource` for generic resources —
//! never by a React component. Paper annotations and resource annotations use the
//! same rules through this module: a writable layer is neither locked nor archived,
//! every owner always has at least one non-archived layer, and moving annotations
//! between layers keeps their ids so selection, undo and `@annotation(id)` notes
//! stay valid.
//!
//! The view state (which layer receives new marks, which layers are shown) is
//! remembered per owner in SQLite so the reader reopens on the same study layer
//! and the startup payload only carries the annotations of visible layers.

use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;
use tauri::AppHandle;
use uuid::Uuid;

use crate::app_paths::app_data_root;
use crate::database::{current_timestamp_ms, initialize_database};

pub(crate) const DEFAULT_LAYER_NAME: &str = "默认图层";
pub(crate) const OWNER_PAPER: &str = "paper";
pub(crate) const OWNER_RESOURCE: &str = "resource";
pub(crate) const KIND_DEFAULT: &str = "default";
pub(crate) const KIND_LAYER: &str = "layer";
pub(crate) const KIND_ATTEMPT: &str = "attempt";

#[derive(Debug, Clone, Serialize)]
pub(crate) struct AnnotationLayer {
    pub(crate) id: String,
    pub(crate) owner_kind: String,
    pub(crate) owner_id: String,
    pub(crate) name: String,
    pub(crate) sort_order: i64,
    pub(crate) kind: String,
    pub(crate) locked: bool,
    pub(crate) archived_at: Option<i64>,
    pub(crate) created_at: i64,
    pub(crate) updated_at: i64,
    pub(crate) annotation_count: i64,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct AnnotationLayerView {
    pub(crate) active_layer_id: String,
    pub(crate) visible_layer_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct AnnotationLayerState {
    pub(crate) owner_kind: String,
    pub(crate) owner_id: String,
    pub(crate) layers: Vec<AnnotationLayer>,
    pub(crate) view: AnnotationLayerView,
}

#[derive(Debug, Deserialize)]
pub(crate) struct CreateAnnotationLayerRequest {
    pub(crate) owner_kind: String,
    pub(crate) owner_id: String,
    #[serde(default)]
    pub(crate) name: String,
    /// `layer` for a blank layer, `attempt` for a new study record.
    #[serde(default)]
    pub(crate) kind: String,
    /// Make the new layer the active (writing) layer.
    #[serde(default)]
    pub(crate) activate: bool,
    /// Show only the new layer (a clean view without earlier marks).
    #[serde(default)]
    pub(crate) solo: bool,
}

#[derive(Debug, Deserialize)]
pub(crate) struct UpdateAnnotationLayerRequest {
    pub(crate) layer_id: String,
    #[serde(default)]
    pub(crate) name: Option<String>,
    #[serde(default)]
    pub(crate) locked: Option<bool>,
    #[serde(default)]
    pub(crate) archived: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ReorderAnnotationLayersRequest {
    pub(crate) owner_kind: String,
    pub(crate) owner_id: String,
    pub(crate) layer_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SetAnnotationLayerViewRequest {
    pub(crate) owner_kind: String,
    pub(crate) owner_id: String,
    pub(crate) active_layer_id: String,
    pub(crate) visible_layer_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct MoveAnnotationsToLayerRequest {
    pub(crate) annotation_ids: Vec<String>,
    pub(crate) target_layer_id: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct MoveAnnotationsResult {
    pub(crate) moved: usize,
    pub(crate) target_layer_id: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct AnnotationLayerDeletePreview {
    pub(crate) layer_id: String,
    pub(crate) name: String,
    pub(crate) annotation_count: i64,
    /// Notes whose text references one of the layer's annotations with `@annotation(id)`.
    pub(crate) referencing_note_count: i64,
    /// Layers that can receive the annotations instead of deleting them.
    pub(crate) move_targets: Vec<AnnotationLayer>,
    pub(crate) deletable: bool,
    pub(crate) reason: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct DeleteAnnotationLayerRequest {
    pub(crate) layer_id: String,
    /// `move` keeps the annotations by moving them to `target_layer_id`; `purge` deletes them with the layer.
    pub(crate) mode: String,
    #[serde(default)]
    pub(crate) target_layer_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct LayerOwner {
    pub(crate) kind: String,
    pub(crate) id: String,
}

impl LayerOwner {
    pub(crate) fn new(kind: &str, id: &str) -> Result<Self, String> {
        let kind = kind.trim();
        let id = id.trim();
        if kind != OWNER_PAPER && kind != OWNER_RESOURCE {
            return Err(format!("未知的图层归属类型：{kind}"));
        }
        if id.is_empty() {
            return Err("图层归属对象缺失".to_string());
        }
        Ok(Self { kind: kind.to_string(), id: id.to_string() })
    }

    pub(crate) fn paper(paper_id: &str) -> Result<Self, String> {
        Self::new(OWNER_PAPER, paper_id)
    }

    pub(crate) fn resource(resource_id: &str) -> Result<Self, String> {
        Self::new(OWNER_RESOURCE, resource_id)
    }

    /// Deterministic id of the owner's default layer, so migrations and repairs are idempotent.
    pub(crate) fn default_layer_id(&self) -> String {
        format!("layer-default-{}", self.id)
    }

    fn annotation_table(&self) -> &'static str {
        if self.kind == OWNER_PAPER { "annotations" } else { "resource_annotations" }
    }

    fn owner_column(&self) -> &'static str {
        if self.kind == OWNER_PAPER { "paper_id" } else { "resource_id" }
    }
}

fn db(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn open(database_path: &Path) -> Result<Connection, String> {
    initialize_database(database_path)?;
    Connection::open(database_path).map_err(db)
}

// ---------- commands ----------

#[tauri::command]
pub fn list_annotation_layers(app: AppHandle, owner_kind: String, owner_id: String) -> Result<AnnotationLayerState, String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    let owner = LayerOwner::new(&owner_kind, &owner_id)?;
    let mut connection = open(&root.join("aster.db"))?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(db)?;
    let state = layer_state(&transaction, &owner)?;
    transaction.commit().map_err(db)?;
    Ok(state)
}

#[tauri::command]
pub fn create_annotation_layer(app: AppHandle, request: CreateAnnotationLayerRequest) -> Result<AnnotationLayerState, String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    create_layer_in_database(&root.join("aster.db"), &request).map(|(state, _)| state)
}

#[tauri::command]
pub fn update_annotation_layer(app: AppHandle, request: UpdateAnnotationLayerRequest) -> Result<AnnotationLayerState, String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    update_layer_in_database(&root.join("aster.db"), &request)
}

#[tauri::command]
pub fn reorder_annotation_layers(app: AppHandle, request: ReorderAnnotationLayersRequest) -> Result<AnnotationLayerState, String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    reorder_layers_in_database(&root.join("aster.db"), &request)
}

#[tauri::command]
pub fn set_annotation_layer_view(app: AppHandle, request: SetAnnotationLayerViewRequest) -> Result<AnnotationLayerState, String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    set_view_in_database(&root.join("aster.db"), &request)
}

#[tauri::command]
pub fn move_annotations_to_layer(app: AppHandle, request: MoveAnnotationsToLayerRequest) -> Result<MoveAnnotationsResult, String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    move_annotations_in_database(&root.join("aster.db"), &request)
}

#[tauri::command]
pub fn preview_annotation_layer_delete(app: AppHandle, layer_id: String) -> Result<AnnotationLayerDeletePreview, String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    delete_preview_in_database(&root.join("aster.db"), &layer_id)
}

#[tauri::command]
pub fn delete_annotation_layer(app: AppHandle, request: DeleteAnnotationLayerRequest) -> Result<AnnotationLayerState, String> {
    let _access = crate::library_access::operation()?;
    let root = app_data_root(&app)?;
    delete_layer_in_database(&root.join("aster.db"), &request)
}

// ---------- shared rules used by the annotation modules ----------

/// Every owner keeps a default layer and a valid view; called before any layer-aware read or write.
pub(crate) fn ensure_owner_layers(connection: &Connection, owner: &LayerOwner) -> Result<String, String> {
    let default_id = owner.default_layer_id();
    // Read first: the startup summary calls this for every paper, so the common case must not write.
    let has_layers: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM annotation_layers WHERE owner_kind = ?1 AND owner_id = ?2)",
            params![owner.kind, owner.id],
            |row| row.get(0),
        )
        .map_err(db)?;
    if !has_layers {
        let now = current_timestamp_ms();
        connection
            .execute(
                "INSERT OR IGNORE INTO annotation_layers (id, owner_kind, owner_id, name, sort_order, kind, locked, archived_at, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, 0, ?5, 0, NULL, ?6, ?6)",
                params![default_id, owner.kind, owner.id, DEFAULT_LAYER_NAME, KIND_DEFAULT, now],
            )
            .map_err(db)?;
    }
    // Rows written before layers existed (or by an older build) fall into the first usable layer.
    let orphaned: bool = connection
        .query_row(
            &format!(
                "SELECT EXISTS(SELECT 1 FROM {} WHERE {} = ?1 AND (layer_id IS NULL OR layer_id = '' OR layer_id NOT IN (SELECT id FROM annotation_layers)))",
                owner.annotation_table(),
                owner.owner_column()
            ),
            params![owner.id],
            |row| row.get(0),
        )
        .map_err(db)?;
    if orphaned {
        connection
            .execute(
                &format!(
                    "UPDATE {} SET layer_id = ?1 WHERE {} = ?2 AND (layer_id IS NULL OR layer_id = '' OR layer_id NOT IN (SELECT id FROM annotation_layers))",
                    owner.annotation_table(),
                    owner.owner_column()
                ),
                params![first_layer_id(connection, owner)?.unwrap_or(default_id.clone()), owner.id],
            )
            .map_err(db)?;
    }
    Ok(default_id)
}

/// Layer that receives new marks for `owner` right now (repairing a missing/archived preference).
pub(crate) fn active_layer_id(connection: &Connection, owner: &LayerOwner) -> Result<String, String> {
    ensure_owner_layers(connection, owner)?;
    Ok(repaired_view(connection, owner)?.active_layer_id)
}

/// Layers currently shown for `owner`; the startup payload and list queries are bounded by this set.
pub(crate) fn visible_layer_ids(connection: &Connection, owner: &LayerOwner) -> Result<Vec<String>, String> {
    ensure_owner_layers(connection, owner)?;
    Ok(repaired_view(connection, owner)?.visible_layer_ids)
}

/// A layer id supplied by a client must exist, belong to `owner` and accept writes.
pub(crate) fn assert_layer_writable_for(connection: &Connection, owner: &LayerOwner, layer_id: &str) -> Result<(), String> {
    let layer = load_layer(connection, layer_id)?.ok_or_else(|| "图层不存在或已删除，请重新选择写入图层".to_string())?;
    if layer.owner_kind != owner.kind || layer.owner_id != owner.id {
        return Err("图层不属于当前文献或资源".to_string());
    }
    assert_writable(&layer)
}

/// The layer that currently holds an existing annotation must accept writes before the annotation changes.
pub(crate) fn assert_annotation_writable(connection: &Connection, table: &str, annotation_id: &str) -> Result<(), String> {
    let layer_id: Option<String> = connection
        .query_row(&format!("SELECT layer_id FROM {table} WHERE id = ?1"), params![annotation_id], |row| row.get(0))
        .optional()
        .map_err(db)?;
    let Some(layer_id) = layer_id else { return Ok(()) }; // Missing rows are reported by the caller.
    match load_layer(connection, &layer_id)? {
        Some(layer) => assert_writable(&layer),
        None => Ok(()),
    }
}

fn assert_writable(layer: &AnnotationLayer) -> Result<(), String> {
    if layer.archived_at.is_some() {
        return Err(format!("图层「{}」已归档，请先恢复该图层或切换到其他图层", layer.name));
    }
    if layer.locked {
        return Err(format!("图层「{}」已锁定，不能新增、修改或删除其中的标注", layer.name));
    }
    Ok(())
}

// ---------- layer state ----------

pub(crate) fn layer_state(connection: &Connection, owner: &LayerOwner) -> Result<AnnotationLayerState, String> {
    ensure_owner_layers(connection, owner)?;
    let view = repaired_view(connection, owner)?;
    Ok(AnnotationLayerState {
        owner_kind: owner.kind.clone(),
        owner_id: owner.id.clone(),
        layers: list_layers(connection, owner)?,
        view,
    })
}

/// Layers with their annotation counts in one aggregate query (no per-layer round trips).
pub(crate) fn list_layers(connection: &Connection, owner: &LayerOwner) -> Result<Vec<AnnotationLayer>, String> {
    let sql = format!(
        "SELECT l.id, l.owner_kind, l.owner_id, l.name, l.sort_order, l.kind, l.locked, l.archived_at, l.created_at, l.updated_at,
                COALESCE(c.total, 0)
         FROM annotation_layers l
         LEFT JOIN (SELECT layer_id, COUNT(*) AS total FROM {} WHERE {} = ?2 GROUP BY layer_id) c ON c.layer_id = l.id
         WHERE l.owner_kind = ?1 AND l.owner_id = ?2
         ORDER BY l.sort_order ASC, l.created_at ASC, l.id ASC",
        owner.annotation_table(),
        owner.owner_column()
    );
    let mut statement = connection.prepare_cached(&sql).map_err(db)?;
    let rows = statement
        .query_map(params![owner.kind, owner.id], |row| {
            Ok(AnnotationLayer {
                id: row.get(0)?,
                owner_kind: row.get(1)?,
                owner_id: row.get(2)?,
                name: row.get(3)?,
                sort_order: row.get(4)?,
                kind: row.get(5)?,
                locked: row.get::<_, i64>(6)? != 0,
                archived_at: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
                annotation_count: row.get(10)?,
            })
        })
        .map_err(db)?;
    let mut layers = Vec::new();
    for row in rows {
        layers.push(row.map_err(db)?);
    }
    Ok(layers)
}

pub(crate) fn load_layer(connection: &Connection, layer_id: &str) -> Result<Option<AnnotationLayer>, String> {
    connection
        .query_row(
            "SELECT id, owner_kind, owner_id, name, sort_order, kind, locked, archived_at, created_at, updated_at
             FROM annotation_layers WHERE id = ?1",
            params![layer_id],
            |row| {
                Ok(AnnotationLayer {
                    id: row.get(0)?,
                    owner_kind: row.get(1)?,
                    owner_id: row.get(2)?,
                    name: row.get(3)?,
                    sort_order: row.get(4)?,
                    kind: row.get(5)?,
                    locked: row.get::<_, i64>(6)? != 0,
                    archived_at: row.get(7)?,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                    annotation_count: 0,
                })
            },
        )
        .optional()
        .map_err(db)
}

fn first_layer_id(connection: &Connection, owner: &LayerOwner) -> Result<Option<String>, String> {
    connection
        .query_row(
            "SELECT id FROM annotation_layers WHERE owner_kind = ?1 AND owner_id = ?2 AND archived_at IS NULL
             ORDER BY (kind = 'default') DESC, sort_order ASC, created_at ASC, id ASC LIMIT 1",
            params![owner.kind, owner.id],
            |row| row.get(0),
        )
        .optional()
        .map_err(db)
}

fn stored_view(connection: &Connection, owner: &LayerOwner) -> Result<Option<(String, Vec<String>)>, String> {
    let row: Option<(String, String)> = connection
        .query_row(
            "SELECT active_layer_id, visible_layer_ids_json FROM annotation_layer_views WHERE owner_kind = ?1 AND owner_id = ?2",
            params![owner.kind, owner.id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(db)?;
    Ok(row.map(|(active, visible)| {
        // A damaged preference row is tolerated: it is rebuilt from the layers below.
        let visible = serde_json::from_str::<Vec<String>>(&visible).unwrap_or_default();
        (active, visible)
    }))
}

/// The remembered view, corrected against the layers that actually exist: the active layer must be a
/// non-archived layer of this owner, visible layers must exist and be non-archived, and the active layer
/// is always visible. Repairs are written back so the next read is cheap.
fn repaired_view(connection: &Connection, owner: &LayerOwner) -> Result<AnnotationLayerView, String> {
    let layers = list_layers(connection, owner)?;
    let usable: Vec<&AnnotationLayer> = layers.iter().filter(|layer| layer.archived_at.is_none()).collect();
    let fallback = usable
        .iter()
        .find(|layer| layer.kind == KIND_DEFAULT)
        .or_else(|| usable.first())
        .map(|layer| layer.id.clone())
        .ok_or_else(|| "该文献没有可用的标注图层".to_string())?;
    let stored = stored_view(connection, owner)?;
    let (mut active, mut visible, had_row) = match &stored {
        Some((active, visible)) => (active.clone(), visible.clone(), true),
        None => (fallback.clone(), Vec::new(), false),
    };
    let usable_ids: HashSet<&str> = usable.iter().map(|layer| layer.id.as_str()).collect();
    if !usable_ids.contains(active.as_str()) {
        active = fallback.clone();
    }
    let mut seen = HashSet::new();
    visible.retain(|id| usable_ids.contains(id.as_str()) && seen.insert(id.clone()));
    if !visible.iter().any(|id| id == &active) {
        visible.insert(0, active.clone());
    }
    if !had_row && visible.len() == 1 && usable.len() > 1 {
        // First contact with an upgraded database: keep showing everything the user could see before.
        visible = usable.iter().map(|layer| layer.id.clone()).collect();
    }
    let view = AnnotationLayerView { active_layer_id: active, visible_layer_ids: visible };
    let changed = match &stored {
        Some((active, visible)) => *active != view.active_layer_id || *visible != view.visible_layer_ids,
        None => true,
    };
    if changed {
        write_view(connection, owner, &view)?;
    }
    Ok(view)
}

fn write_view(connection: &Connection, owner: &LayerOwner, view: &AnnotationLayerView) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO annotation_layer_views (owner_kind, owner_id, active_layer_id, visible_layer_ids_json, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(owner_kind, owner_id) DO UPDATE SET active_layer_id = excluded.active_layer_id,
               visible_layer_ids_json = excluded.visible_layer_ids_json, updated_at = excluded.updated_at",
            params![owner.kind, owner.id, view.active_layer_id, serde_json::to_string(&view.visible_layer_ids).map_err(db)?, current_timestamp_ms()],
        )
        .map_err(db)?;
    Ok(())
}

fn owner_of_layer(connection: &Connection, layer_id: &str) -> Result<(LayerOwner, AnnotationLayer), String> {
    let layer = load_layer(connection, layer_id)?.ok_or_else(|| "图层不存在或已删除".to_string())?;
    let owner = LayerOwner::new(&layer.owner_kind, &layer.owner_id)?;
    Ok((owner, layer))
}

// ---------- mutations ----------

pub(crate) fn create_layer_in_database(database_path: &Path, request: &CreateAnnotationLayerRequest) -> Result<(AnnotationLayerState, String), String> {
    let owner = LayerOwner::new(&request.owner_kind, &request.owner_id)?;
    let kind = match request.kind.trim() {
        "" | "layer" => KIND_LAYER,
        "attempt" => KIND_ATTEMPT,
        other => return Err(format!("未知的图层类型：{other}")),
    };
    let mut connection = open(database_path)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(db)?;
    ensure_owner_layers(&transaction, &owner)?;
    let layers = list_layers(&transaction, &owner)?;
    let now = current_timestamp_ms();
    let name = {
        let trimmed = request.name.trim();
        if !trimmed.is_empty() {
            trimmed.chars().take(80).collect::<String>()
        } else if kind == KIND_ATTEMPT {
            let attempts = layers.iter().filter(|layer| layer.kind == KIND_ATTEMPT).count();
            format!("第 {} 次学习 · {}", attempts + 1, local_date(now))
        } else {
            format!("图层 {}", layers.len() + 1)
        }
    };
    let id = format!("layer-{}", Uuid::new_v4());
    let sort_order = layers.iter().map(|layer| layer.sort_order).max().unwrap_or(-1) + 1;
    transaction
        .execute(
            "INSERT INTO annotation_layers (id, owner_kind, owner_id, name, sort_order, kind, locked, archived_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, NULL, ?7, ?7)",
            params![id, owner.kind, owner.id, name, sort_order, kind, now],
        )
        .map_err(db)?;
    let mut view = repaired_view(&transaction, &owner)?;
    if request.activate || request.solo {
        view.active_layer_id = id.clone();
    }
    if request.solo {
        view.visible_layer_ids = vec![id.clone()];
    } else if !view.visible_layer_ids.iter().any(|layer_id| layer_id == &id) {
        view.visible_layer_ids.push(id.clone());
    }
    write_view(&transaction, &owner, &view)?;
    let state = layer_state(&transaction, &owner)?;
    transaction.commit().map_err(db)?;
    Ok((state, id))
}

pub(crate) fn update_layer_in_database(database_path: &Path, request: &UpdateAnnotationLayerRequest) -> Result<AnnotationLayerState, String> {
    let mut connection = open(database_path)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(db)?;
    let (owner, layer) = owner_of_layer(&transaction, &request.layer_id)?;
    let now = current_timestamp_ms();
    if let Some(name) = request.name.as_deref() {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err("图层名称不能为空".to_string());
        }
        transaction
            .execute("UPDATE annotation_layers SET name = ?1, updated_at = ?2 WHERE id = ?3", params![trimmed.chars().take(80).collect::<String>(), now, layer.id])
            .map_err(db)?;
    }
    if let Some(locked) = request.locked {
        transaction
            .execute("UPDATE annotation_layers SET locked = ?1, updated_at = ?2 WHERE id = ?3", params![locked as i64, now, layer.id])
            .map_err(db)?;
    }
    if let Some(archived) = request.archived {
        if archived && layer.archived_at.is_none() {
            let others = list_layers(&transaction, &owner)?.into_iter().filter(|other| other.id != layer.id && other.archived_at.is_none()).count();
            if others == 0 {
                return Err("不能归档唯一可用的图层，请先新建一个图层".to_string());
            }
            transaction
                .execute("UPDATE annotation_layers SET archived_at = ?1, updated_at = ?1 WHERE id = ?2", params![now, layer.id])
                .map_err(db)?;
        } else if !archived && layer.archived_at.is_some() {
            transaction
                .execute("UPDATE annotation_layers SET archived_at = NULL, updated_at = ?1 WHERE id = ?2", params![now, layer.id])
                .map_err(db)?;
        }
    }
    // Archiving drops the layer from the view; restoring shows it again next to the others.
    let mut view = repaired_view(&transaction, &owner)?;
    if request.archived == Some(false) && !view.visible_layer_ids.iter().any(|id| id == &layer.id) {
        view.visible_layer_ids.push(layer.id.clone());
        write_view(&transaction, &owner, &view)?;
    }
    let state = layer_state(&transaction, &owner)?;
    transaction.commit().map_err(db)?;
    Ok(state)
}

pub(crate) fn reorder_layers_in_database(database_path: &Path, request: &ReorderAnnotationLayersRequest) -> Result<AnnotationLayerState, String> {
    let owner = LayerOwner::new(&request.owner_kind, &request.owner_id)?;
    let mut connection = open(database_path)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(db)?;
    ensure_owner_layers(&transaction, &owner)?;
    let existing = list_layers(&transaction, &owner)?;
    let known: HashSet<&str> = existing.iter().map(|layer| layer.id.as_str()).collect();
    let mut order: Vec<String> = Vec::new();
    for id in &request.layer_ids {
        if known.contains(id.as_str()) && !order.contains(id) {
            order.push(id.clone());
        }
    }
    for layer in &existing {
        if !order.contains(&layer.id) {
            order.push(layer.id.clone());
        }
    }
    let now = current_timestamp_ms();
    for (index, id) in order.iter().enumerate() {
        transaction
            .execute("UPDATE annotation_layers SET sort_order = ?1, updated_at = ?2 WHERE id = ?3 AND sort_order <> ?1", params![index as i64, now, id])
            .map_err(db)?;
    }
    let state = layer_state(&transaction, &owner)?;
    transaction.commit().map_err(db)?;
    Ok(state)
}

pub(crate) fn set_view_in_database(database_path: &Path, request: &SetAnnotationLayerViewRequest) -> Result<AnnotationLayerState, String> {
    let owner = LayerOwner::new(&request.owner_kind, &request.owner_id)?;
    let mut connection = open(database_path)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(db)?;
    ensure_owner_layers(&transaction, &owner)?;
    let active = load_layer(&transaction, &request.active_layer_id)?
        .filter(|layer| layer.owner_kind == owner.kind && layer.owner_id == owner.id)
        .ok_or_else(|| "活动图层不存在，请重新选择".to_string())?;
    if active.archived_at.is_some() {
        return Err(format!("图层「{}」已归档，不能作为活动图层", active.name));
    }
    write_view(&transaction, &owner, &AnnotationLayerView { active_layer_id: active.id, visible_layer_ids: request.visible_layer_ids.clone() })?;
    let state = layer_state(&transaction, &owner)?;
    transaction.commit().map_err(db)?;
    Ok(state)
}

pub(crate) fn move_annotations_in_database(database_path: &Path, request: &MoveAnnotationsToLayerRequest) -> Result<MoveAnnotationsResult, String> {
    let mut connection = open(database_path)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(db)?;
    let (owner, target) = owner_of_layer(&transaction, &request.target_layer_id)?;
    assert_writable(&target)?;
    let moved = move_annotations(&transaction, &owner, &request.annotation_ids, &target)?;
    transaction.commit().map_err(db)?;
    Ok(MoveAnnotationsResult { moved, target_layer_id: target.id })
}

/// Moves rows by id only: geometry, colour, timestamps and the annotation id itself never change.
fn move_annotations(connection: &Connection, owner: &LayerOwner, annotation_ids: &[String], target: &AnnotationLayer) -> Result<usize, String> {
    let table = owner.annotation_table();
    let now = current_timestamp_ms();
    let mut moved = 0;
    for annotation_id in annotation_ids {
        let row: Option<(String, String)> = connection
            .query_row(
                &format!("SELECT {}, layer_id FROM {table} WHERE id = ?1", owner.owner_column()),
                params![annotation_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(db)?;
        let Some((owner_id, current_layer)) = row else { return Err("标注不存在或已删除，请刷新后重试".to_string()) };
        if owner_id != owner.id {
            return Err("不能把标注移动到其他文献或资源的图层".to_string());
        }
        if current_layer == target.id {
            continue;
        }
        if let Some(source) = load_layer(connection, &current_layer)? {
            assert_writable(&source)?;
        }
        moved += connection
            .execute(&format!("UPDATE {table} SET layer_id = ?1, updated_at = ?2 WHERE id = ?3"), params![target.id, now, annotation_id])
            .map_err(db)?;
    }
    Ok(moved)
}

pub(crate) fn delete_preview_in_database(database_path: &Path, layer_id: &str) -> Result<AnnotationLayerDeletePreview, String> {
    let connection = open(database_path)?;
    let (owner, layer) = owner_of_layer(&connection, layer_id)?;
    let layers = list_layers(&connection, &owner)?;
    let annotation_count = layers.iter().find(|item| item.id == layer.id).map(|item| item.annotation_count).unwrap_or(0);
    let referencing_note_count = if owner.kind == OWNER_PAPER { referencing_note_count(&connection, &owner, &layer.id)? } else { 0 };
    let move_targets: Vec<AnnotationLayer> = layers.iter().filter(|item| item.id != layer.id && item.archived_at.is_none() && !item.locked).cloned().collect();
    let remaining = layers.iter().filter(|item| item.id != layer.id && item.archived_at.is_none()).count();
    let reason = if remaining == 0 {
        Some("这是唯一可用的图层，不能删除；请先新建图层".to_string())
    } else if layer.locked {
        Some(format!("图层「{}」已锁定，请先解锁再删除", layer.name))
    } else {
        None
    };
    Ok(AnnotationLayerDeletePreview {
        layer_id: layer.id.clone(),
        name: layer.name.clone(),
        annotation_count,
        referencing_note_count,
        move_targets,
        deletable: reason.is_none(),
        reason,
    })
}

/// Notes of the paper that mention any annotation of the layer with `@annotation(id)`.
fn referencing_note_count(connection: &Connection, owner: &LayerOwner, layer_id: &str) -> Result<i64, String> {
    let mut ids = connection.prepare("SELECT id FROM annotations WHERE paper_id = ?1 AND layer_id = ?2").map_err(db)?;
    let ids: Vec<String> = ids
        .query_map(params![owner.id, layer_id], |row| row.get(0))
        .map_err(db)?
        .collect::<Result<Vec<String>, _>>()
        .map_err(db)?;
    if ids.is_empty() {
        return Ok(0);
    }
    let mut notes = connection
        .prepare("SELECT content FROM notes WHERE paper_id = ?1 AND deleted_at IS NULL AND content LIKE '%@annotation(%'")
        .map_err(db)?;
    let contents: Vec<String> = notes
        .query_map(params![owner.id], |row| row.get(0))
        .map_err(db)?
        .collect::<Result<Vec<String>, _>>()
        .map_err(db)?;
    Ok(contents
        .iter()
        .filter(|content| ids.iter().any(|id| content.contains(&format!("@annotation({id})"))))
        .count() as i64)
}

pub(crate) fn delete_layer_in_database(database_path: &Path, request: &DeleteAnnotationLayerRequest) -> Result<AnnotationLayerState, String> {
    let mut connection = open(database_path)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(db)?;
    let (owner, layer) = owner_of_layer(&transaction, &request.layer_id)?;
    let preview = {
        let layers = list_layers(&transaction, &owner)?;
        let remaining = layers.iter().filter(|item| item.id != layer.id && item.archived_at.is_none()).count();
        if remaining == 0 {
            return Err("这是唯一可用的图层，不能删除；请先新建图层".to_string());
        }
        if layer.locked {
            return Err(format!("图层「{}」已锁定，请先解锁再删除", layer.name));
        }
        layers
    };
    let table = owner.annotation_table();
    match request.mode.as_str() {
        "move" => {
            let target_id = request.target_layer_id.as_deref().filter(|id| !id.trim().is_empty()).ok_or_else(|| "请选择接收标注的目标图层".to_string())?;
            if target_id == layer.id {
                return Err("目标图层不能是正在删除的图层".to_string());
            }
            let target = preview.iter().find(|item| item.id == target_id).cloned().ok_or_else(|| "目标图层不存在".to_string())?;
            assert_writable(&target)?;
            transaction
                .execute(&format!("UPDATE {table} SET layer_id = ?1, updated_at = ?2 WHERE layer_id = ?3"), params![target.id, current_timestamp_ms(), layer.id])
                .map_err(db)?;
        }
        "purge" => {
            transaction.execute(&format!("DELETE FROM {table} WHERE layer_id = ?1"), params![layer.id]).map_err(db)?;
        }
        other => return Err(format!("未知的删除方式：{other}")),
    }
    transaction.execute("DELETE FROM annotation_layers WHERE id = ?1", params![layer.id]).map_err(db)?;
    // The view drops the deleted layer and, if it was active, falls back to the default/first layer.
    repaired_view(&transaction, &owner)?;
    let state = layer_state(&transaction, &owner)?;
    transaction.commit().map_err(db)?;
    Ok(state)
}

/// Removes every layer and view row of an owner; used when the owner itself is deleted.
pub(crate) fn delete_owner_layers(connection: &Connection, owner: &LayerOwner) -> Result<(), String> {
    connection
        .execute("DELETE FROM annotation_layer_views WHERE owner_kind = ?1 AND owner_id = ?2", params![owner.kind, owner.id])
        .map_err(db)?;
    connection
        .execute("DELETE FROM annotation_layers WHERE owner_kind = ?1 AND owner_id = ?2", params![owner.kind, owner.id])
        .map_err(db)?;
    Ok(())
}

fn local_date(timestamp_ms: i64) -> String {
    use chrono::{Local, TimeZone};
    Local
        .timestamp_millis_opt(timestamp_ms)
        .single()
        .map(|date| date.format("%Y-%m-%d").to_string())
        .unwrap_or_default()
}

/// Startup/backfill migration step: every paper and every annotated resource gets a default layer and
/// all rows without a layer join it. Idempotent (deterministic ids, `INSERT OR IGNORE`, guarded UPDATE)
/// and executed inside the caller's schema transaction so a failure leaves nothing half-applied.
pub(crate) fn backfill_layers(connection: &Connection) -> Result<(), String> {
    let now = current_timestamp_ms();
    connection
        .execute(
            "INSERT OR IGNORE INTO annotation_layers (id, owner_kind, owner_id, name, sort_order, kind, locked, archived_at, created_at, updated_at)
             SELECT 'layer-default-' || p.id, 'paper', p.id, ?1, 0, 'default', 0, NULL, ?2, ?2 FROM papers p
             WHERE NOT EXISTS (SELECT 1 FROM annotation_layers l WHERE l.owner_kind = 'paper' AND l.owner_id = p.id)",
            params![DEFAULT_LAYER_NAME, now],
        )
        .map_err(db)?;
    connection
        .execute(
            "INSERT OR IGNORE INTO annotation_layers (id, owner_kind, owner_id, name, sort_order, kind, locked, archived_at, created_at, updated_at)
             SELECT DISTINCT 'layer-default-' || a.paper_id, 'paper', a.paper_id, ?1, 0, 'default', 0, NULL, ?2, ?2 FROM annotations a
             WHERE NOT EXISTS (SELECT 1 FROM annotation_layers l WHERE l.owner_kind = 'paper' AND l.owner_id = a.paper_id)",
            params![DEFAULT_LAYER_NAME, now],
        )
        .map_err(db)?;
    connection
        .execute(
            "INSERT OR IGNORE INTO annotation_layers (id, owner_kind, owner_id, name, sort_order, kind, locked, archived_at, created_at, updated_at)
             SELECT DISTINCT 'layer-default-' || a.resource_id, 'resource', a.resource_id, ?1, 0, 'default', 0, NULL, ?2, ?2 FROM resource_annotations a
             WHERE NOT EXISTS (SELECT 1 FROM annotation_layers l WHERE l.owner_kind = 'resource' AND l.owner_id = a.resource_id)",
            params![DEFAULT_LAYER_NAME, now],
        )
        .map_err(db)?;
    connection
        .execute(
            "UPDATE annotations SET layer_id = (
               SELECT l.id FROM annotation_layers l WHERE l.owner_kind = 'paper' AND l.owner_id = annotations.paper_id AND l.archived_at IS NULL
               ORDER BY (l.kind = 'default') DESC, l.sort_order ASC, l.created_at ASC LIMIT 1)
             WHERE layer_id IS NULL OR layer_id = '' OR layer_id NOT IN (SELECT id FROM annotation_layers)",
            [],
        )
        .map_err(db)?;
    connection
        .execute(
            "UPDATE resource_annotations SET layer_id = (
               SELECT l.id FROM annotation_layers l WHERE l.owner_kind = 'resource' AND l.owner_id = resource_annotations.resource_id AND l.archived_at IS NULL
               ORDER BY (l.kind = 'default') DESC, l.sort_order ASC, l.created_at ASC LIMIT 1)
             WHERE layer_id IS NULL OR layer_id = '' OR layer_id NOT IN (SELECT id FROM annotation_layers)",
            [],
        )
        .map_err(db)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library_annotations::{
        delete_annotation_in_database, insert_annotation, list_annotations_for_paper, list_visible_annotations_for_paper, restore_annotation_in_database,
        update_annotation_color_in_database, CreateAnnotationRequest, DeleteAnnotationRequest, RestoreAnnotationRequest, UpdateAnnotationColorRequest,
    };

    fn fresh_db(name: &str) -> (std::path::PathBuf, std::path::PathBuf) {
        let root = std::env::temp_dir().join(format!("a4note-layers-{name}-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        (root.clone(), root.join("aster.db"))
    }

    fn seed_paper(db: &Path, paper_id: &str) {
        let connection = Connection::open(db).unwrap();
        connection.execute("INSERT OR IGNORE INTO papers(id,title,created_at,updated_at) VALUES (?1,'Layer test',1,1)", params![paper_id]).unwrap();
        connection.execute("INSERT OR IGNORE INTO paper_files(id,paper_id,type,path,created_at) VALUES (?1,?2,'source_pdf','/synthetic/test.pdf',1)", params![format!("{paper_id}-file"), paper_id]).unwrap();
    }

    fn request(paper_id: &str, layer_id: &str) -> CreateAnnotationRequest {
        CreateAnnotationRequest {
            paper_id: paper_id.into(),
            file_id: format!("{paper_id}-file"),
            page: 1,
            annotation_type: "highlight".into(),
            quote: "layer fixture".into(),
            comment: String::new(),
            color: "yellow".into(),
            position_json: "{\"x\":1,\"y\":2,\"width\":3,\"height\":4}".into(),
            layer_id: layer_id.into(),
        }
    }

    #[test]
    fn legacy_rows_join_the_default_layer_and_keep_identity_across_repeated_migrations() {
        let (root, db) = fresh_db("legacy");
        initialize_database(&db).unwrap();
        seed_paper(&db, "paper-a");
        {
            // Simulate rows written before layers existed: no layer id at all.
            let connection = Connection::open(&db).unwrap();
            connection.execute("DELETE FROM annotation_layers", []).unwrap();
            connection.execute(
                "INSERT INTO annotations (id, paper_id, file_id, page, type, quote, comment, color, position_json, created_at, updated_at, layer_id)
                 VALUES ('anno-legacy', 'paper-a', 'paper-a-file', 3, 'underline', 'q', 'c', 'blue', '{\"x\":5}', 1234, 1234, '')",
                [],
            ).unwrap();
        }
        for _ in 0..3 {
            let connection = Connection::open(&db).unwrap();
            backfill_layers(&connection).unwrap();
            let owner = LayerOwner::paper("paper-a").unwrap();
            let state = layer_state(&connection, &owner).unwrap();
            assert_eq!(state.layers.len(), 1, "repeated backfill never duplicates the default layer");
            assert_eq!(state.layers[0].id, "layer-default-paper-a");
            assert_eq!(state.layers[0].kind, KIND_DEFAULT);
            assert_eq!(state.layers[0].annotation_count, 1);
            assert_eq!(state.view.active_layer_id, "layer-default-paper-a");
            let row: (String, i64, String, i64) = connection
                .query_row("SELECT layer_id, created_at, position_json, page FROM annotations WHERE id = 'anno-legacy'", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
                .unwrap();
            assert_eq!(row, ("layer-default-paper-a".into(), 1234, "{\"x\":5}".into(), 3));
        }
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn attempts_are_blank_active_and_solo_while_history_stays_intact() {
        let (root, db) = fresh_db("attempt");
        initialize_database(&db).unwrap();
        seed_paper(&db, "paper-b");
        let connection = Connection::open(&db).unwrap();
        let owner = LayerOwner::paper("paper-b").unwrap();
        let default_id = ensure_owner_layers(&connection, &owner).unwrap();
        let first = insert_annotation(&db, &request("paper-b", &default_id)).unwrap();
        let mut names = Vec::new();
        for _ in 0..3 {
            let (state, id) = create_layer_in_database(&db, &CreateAnnotationLayerRequest { owner_kind: "paper".into(), owner_id: "paper-b".into(), name: String::new(), kind: "attempt".into(), activate: true, solo: true }).unwrap();
            assert_eq!(state.view.active_layer_id, id);
            assert_eq!(state.view.visible_layer_ids, vec![id.clone()], "a new study record shows only itself");
            let layer = state.layers.iter().find(|layer| layer.id == id).unwrap();
            assert_eq!(layer.annotation_count, 0);
            assert_eq!(layer.kind, KIND_ATTEMPT);
            names.push(layer.name.clone());
        }
        assert!(names[0].starts_with("第 1 次学习"), "{names:?}");
        assert!(names[1].starts_with("第 2 次学习"));
        assert!(names[2].starts_with("第 3 次学习"));
        let state = layer_state(&connection, &owner).unwrap();
        assert_eq!(state.layers.iter().map(|layer| layer.sort_order).collect::<Vec<_>>(), vec![0, 1, 2, 3], "creation order is stable");
        assert_eq!(state.layers[0].annotation_count, 1, "the earlier mark is still stored in the default layer");
        let all = list_annotations_for_paper(&connection, "paper-b").unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].id, first);
        assert_eq!(all[0].layer_id, default_id);
        drop(connection);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn locked_layers_reject_writes_and_moves_keep_annotation_ids() {
        let (root, db) = fresh_db("locked");
        initialize_database(&db).unwrap();
        seed_paper(&db, "paper-c");
        let connection = Connection::open(&db).unwrap();
        let owner = LayerOwner::paper("paper-c").unwrap();
        let default_id = ensure_owner_layers(&connection, &owner).unwrap();
        let id = insert_annotation(&db, &request("paper-c", &default_id)).unwrap();
        let (state, second) = create_layer_in_database(&db, &CreateAnnotationLayerRequest { owner_kind: "paper".into(), owner_id: "paper-c".into(), name: "复习".into(), kind: String::new(), activate: false, solo: false }).unwrap();
        assert_eq!(state.view.visible_layer_ids.len(), 2, "a blank layer is added to the visible set without hiding others");
        update_layer_in_database(&db, &UpdateAnnotationLayerRequest { layer_id: default_id.clone(), name: None, locked: Some(true), archived: None }).unwrap();
        let denied = insert_annotation(&db, &request("paper-c", &default_id)).unwrap_err();
        assert!(denied.contains("已锁定"), "{denied}");
        let denied = update_annotation_color_in_database(&db, &UpdateAnnotationColorRequest { annotation_id: id.clone(), color: "green".into() }).unwrap_err();
        assert!(denied.contains("已锁定"), "{denied}");
        let denied = delete_annotation_in_database(&db, &DeleteAnnotationRequest { annotation_id: id.clone() }).unwrap_err();
        assert!(denied.contains("已锁定"), "{denied}");
        let denied = move_annotations_in_database(&db, &MoveAnnotationsToLayerRequest { annotation_ids: vec![id.clone()], target_layer_id: second.clone() }).unwrap_err();
        assert!(denied.contains("已锁定"), "moving out of a locked layer is refused: {denied}");
        update_layer_in_database(&db, &UpdateAnnotationLayerRequest { layer_id: default_id.clone(), name: None, locked: Some(false), archived: None }).unwrap();
        let before: (i64, String, String) = connection.query_row("SELECT created_at, position_json, color FROM annotations WHERE id = ?1", params![id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
        let moved = move_annotations_in_database(&db, &MoveAnnotationsToLayerRequest { annotation_ids: vec![id.clone()], target_layer_id: second.clone() }).unwrap();
        assert_eq!(moved.moved, 1);
        let after: (String, i64, String, String) = connection.query_row("SELECT layer_id, created_at, position_json, color FROM annotations WHERE id = ?1", params![id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).unwrap();
        assert_eq!(after, (second.clone(), before.0, before.1, before.2), "move changes only the layer");
        let state = layer_state(&connection, &owner).unwrap();
        assert_eq!(state.layers.iter().find(|layer| layer.id == second).unwrap().annotation_count, 1);
        // Restore after delete lands in the layer recorded in the snapshot, not in whatever is active now.
        delete_annotation_in_database(&db, &DeleteAnnotationRequest { annotation_id: id.clone() }).unwrap();
        set_view_in_database(&db, &SetAnnotationLayerViewRequest { owner_kind: "paper".into(), owner_id: "paper-c".into(), active_layer_id: default_id.clone(), visible_layer_ids: vec![default_id.clone()] }).unwrap();
        restore_annotation_in_database(&db, &RestoreAnnotationRequest {
            annotation_id: id.clone(), paper_id: "paper-c".into(), file_id: "paper-c-file".into(), page: 1, annotation_type: "highlight".into(),
            quote: "layer fixture".into(), comment: String::new(), color: "yellow".into(), position_json: "{\"x\":1,\"y\":2,\"width\":3,\"height\":4}".into(), created_at: before.0, layer_id: second.clone(),
        }).unwrap();
        let restored_layer: String = connection.query_row("SELECT layer_id FROM annotations WHERE id = ?1", params![id], |r| r.get(0)).unwrap();
        assert_eq!(restored_layer, second);
        drop(connection);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn delete_requires_a_remaining_layer_and_moves_or_purges_atomically() {
        let (root, db) = fresh_db("delete");
        initialize_database(&db).unwrap();
        seed_paper(&db, "paper-d");
        let connection = Connection::open(&db).unwrap();
        let owner = LayerOwner::paper("paper-d").unwrap();
        let default_id = ensure_owner_layers(&connection, &owner).unwrap();
        let only = delete_preview_in_database(&db, &default_id).unwrap();
        assert!(!only.deletable && only.reason.as_deref().unwrap_or("").contains("唯一"));
        assert!(delete_layer_in_database(&db, &DeleteAnnotationLayerRequest { layer_id: default_id.clone(), mode: "purge".into(), target_layer_id: None }).is_err());
        let (_, second) = create_layer_in_database(&db, &CreateAnnotationLayerRequest { owner_kind: "paper".into(), owner_id: "paper-d".into(), name: String::new(), kind: "attempt".into(), activate: true, solo: true }).unwrap();
        let a = insert_annotation(&db, &request("paper-d", &second)).unwrap();
        let b = insert_annotation(&db, &request("paper-d", &second)).unwrap();
        connection.execute("INSERT INTO notes (id, paper_id, title, content, created_at, updated_at) VALUES ('note-1', 'paper-d', 't', ?1, 1, 1)", params![format!("see @annotation({a})")]).unwrap();
        let preview = delete_preview_in_database(&db, &second).unwrap();
        assert_eq!((preview.annotation_count, preview.referencing_note_count), (2, 1));
        assert_eq!(preview.move_targets.iter().map(|layer| layer.id.clone()).collect::<Vec<_>>(), vec![default_id.clone()]);
        assert!(delete_layer_in_database(&db, &DeleteAnnotationLayerRequest { layer_id: second.clone(), mode: "move".into(), target_layer_id: None }).is_err(), "move needs a target");
        let state = delete_layer_in_database(&db, &DeleteAnnotationLayerRequest { layer_id: second.clone(), mode: "move".into(), target_layer_id: Some(default_id.clone()) }).unwrap();
        assert_eq!(state.layers.len(), 1);
        assert_eq!(state.view.active_layer_id, default_id, "the active layer falls back after its deletion");
        let kept: Vec<String> = connection.prepare("SELECT id FROM annotations WHERE layer_id = ?1 ORDER BY id").unwrap().query_map(params![default_id], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
        let mut expected = vec![a.clone(), b.clone()];
        expected.sort();
        assert_eq!(kept, expected, "moved annotations keep their ids");
        let (_, third) = create_layer_in_database(&db, &CreateAnnotationLayerRequest { owner_kind: "paper".into(), owner_id: "paper-d".into(), name: "purge me".into(), kind: String::new(), activate: false, solo: false }).unwrap();
        insert_annotation(&db, &request("paper-d", &third)).unwrap();
        let state = delete_layer_in_database(&db, &DeleteAnnotationLayerRequest { layer_id: third.clone(), mode: "purge".into(), target_layer_id: None }).unwrap();
        assert!(state.layers.iter().all(|layer| layer.id != third));
        let remaining: i64 = connection.query_row("SELECT COUNT(*) FROM annotations WHERE paper_id = 'paper-d'", [], |r| r.get(0)).unwrap();
        assert_eq!(remaining, 2, "purge removes only the deleted layer's annotations");
        drop(connection);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn view_state_is_repaired_when_the_preference_is_missing_or_damaged() {
        let (root, db) = fresh_db("view");
        initialize_database(&db).unwrap();
        seed_paper(&db, "paper-e");
        let connection = Connection::open(&db).unwrap();
        let owner = LayerOwner::paper("paper-e").unwrap();
        let default_id = ensure_owner_layers(&connection, &owner).unwrap();
        let (_, second) = create_layer_in_database(&db, &CreateAnnotationLayerRequest { owner_kind: "paper".into(), owner_id: "paper-e".into(), name: "b".into(), kind: String::new(), activate: true, solo: false }).unwrap();
        connection.execute("UPDATE annotation_layer_views SET active_layer_id = 'layer-missing', visible_layer_ids_json = 'not json' WHERE owner_id = 'paper-e'", []).unwrap();
        let view = repaired_view(&connection, &owner).unwrap();
        assert_eq!(view.active_layer_id, default_id, "a missing active layer falls back to the default layer");
        assert_eq!(view.visible_layer_ids, vec![default_id.clone()]);
        // Archiving the active layer moves the activity to another usable layer; the archived layer leaves the view.
        set_view_in_database(&db, &SetAnnotationLayerViewRequest { owner_kind: "paper".into(), owner_id: "paper-e".into(), active_layer_id: second.clone(), visible_layer_ids: vec![second.clone(), default_id.clone()] }).unwrap();
        let state = update_layer_in_database(&db, &UpdateAnnotationLayerRequest { layer_id: second.clone(), name: None, locked: None, archived: Some(true) }).unwrap();
        assert_eq!(state.view.active_layer_id, default_id);
        assert!(!state.view.visible_layer_ids.contains(&second));
        assert!(update_layer_in_database(&db, &UpdateAnnotationLayerRequest { layer_id: default_id.clone(), name: None, locked: None, archived: Some(true) }).is_err(), "the last usable layer cannot be archived");
        let state = update_layer_in_database(&db, &UpdateAnnotationLayerRequest { layer_id: second.clone(), name: Some("  复习二  ".into()), locked: None, archived: Some(false) }).unwrap();
        let restored = state.layers.iter().find(|layer| layer.id == second).unwrap();
        assert_eq!((restored.name.as_str(), restored.archived_at), ("复习二", None));
        assert!(state.view.visible_layer_ids.contains(&second), "restoring shows the layer again");
        // Resources share the same rules and keep a separate owner space.
        let resource = LayerOwner::resource("res-1").unwrap();
        connection.execute("INSERT INTO resource_annotations (id, resource_id, page, type, quote, comment, color, position_json, created_at, updated_at, layer_id) VALUES ('ra-1','res-1',1,'highlight','','','yellow','{}',1,1,'')", []).unwrap();
        let state = layer_state(&connection, &resource).unwrap();
        assert_eq!(state.layers.len(), 1);
        assert_eq!(state.layers[0].annotation_count, 1);
        let assigned: String = connection.query_row("SELECT layer_id FROM resource_annotations WHERE id = 'ra-1'", [], |r| r.get(0)).unwrap();
        assert_eq!(assigned, "layer-default-res-1");
        drop(connection);
        let _ = std::fs::remove_dir_all(root);
    }

    /// Repeatable performance fixture (fb5e3f2f §performance): 20 layers × 500 annotations = 10,000 rows
    /// on one paper. Checks that the bounded reads use the layer/page index and stay far below the cost
    /// of loading every layer, and prints the measured numbers as JSON for the delivery report.
    #[test]
    fn perf_fixture_twenty_layers_ten_thousand_annotations_use_the_layer_index() {
        let (root, db) = fresh_db("perf");
        initialize_database(&db).unwrap();
        seed_paper(&db, "paper-perf");
        let mut connection = Connection::open(&db).unwrap();
        let owner = LayerOwner::paper("paper-perf").unwrap();
        let default_id = ensure_owner_layers(&connection, &owner).unwrap();
        let mut layer_ids = vec![default_id.clone()];
        for index in 1..20 {
            let (_, id) = create_layer_in_database(&db, &CreateAnnotationLayerRequest { owner_kind: "paper".into(), owner_id: "paper-perf".into(), name: format!("第 {index} 次"), kind: "attempt".into(), activate: false, solo: false }).unwrap();
            layer_ids.push(id);
        }
        let seed_started = std::time::Instant::now();
        {
            let transaction = connection.transaction().unwrap();
            let mut insert = transaction.prepare("INSERT INTO annotations (id, paper_id, file_id, page, type, quote, comment, color, position_json, created_at, updated_at, layer_id) VALUES (?1, 'paper-perf', 'paper-perf-file', ?2, 'highlight', 'perf', '', 'yellow', ?3, ?4, ?4, ?5)").unwrap();
            for (layer_index, layer_id) in layer_ids.iter().enumerate() {
                for item in 0..500 {
                    let page = (item % 40) + 1;
                    insert.execute(params![format!("anno-perf-{layer_index}-{item}"), page, format!("{{\"x\":{},\"y\":{},\"width\":30,\"height\":2.5}}", item % 60, (item * 7) % 90), 1_700_000_000_000i64 + (layer_index * 500 + item) as i64, layer_id]).unwrap();
                }
            }
            drop(insert);
            transaction.commit().unwrap();
        }
        let seed_ms = seed_started.elapsed().as_secs_f64() * 1000.0;
        set_view_in_database(&db, &SetAnnotationLayerViewRequest { owner_kind: "paper".into(), owner_id: "paper-perf".into(), active_layer_id: layer_ids[19].clone(), visible_layer_ids: vec![layer_ids[19].clone()] }).unwrap();

        let plan: Vec<String> = connection
            .prepare("EXPLAIN QUERY PLAN SELECT id FROM annotations WHERE paper_id = ?1 AND layer_id = ?2 ORDER BY created_at DESC")
            .unwrap()
            .query_map(params!["paper-perf", layer_ids[19]], |row| row.get::<_, String>(3))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert!(plan.iter().any(|step| step.contains("annotations_by_layer_created") || step.contains("annotations_by_layer_page")), "layer reads must use a (paper_id, layer_id, …) index: {plan:?}");
        let count_plan: Vec<String> = connection
            .prepare("EXPLAIN QUERY PLAN SELECT layer_id, COUNT(*) FROM annotations WHERE paper_id = ?1 GROUP BY layer_id")
            .unwrap()
            .query_map(params!["paper-perf"], |row| row.get::<_, String>(3))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert!(count_plan.iter().any(|step| step.contains("annotations_by_layer_") || step.contains("COVERING INDEX")), "layer counts must be served by an index: {count_plan:?}");

        let timed = |label: &str, runs: u32, body: &dyn Fn() -> usize| {
            let started = std::time::Instant::now();
            let mut rows = 0;
            for _ in 0..runs { rows = body(); }
            (label.to_string(), rows, started.elapsed().as_secs_f64() * 1000.0 / runs as f64)
        };
        let visible = timed("visible layer (500 rows)", 20, &|| list_visible_annotations_for_paper(&connection, "paper-perf").unwrap().len());
        let everything = timed("all 20 layers (10,000 rows)", 5, &|| list_annotations_for_paper(&connection, "paper-perf").unwrap().len());
        let counts = timed("layer list with counts", 20, &|| list_layers(&connection, &owner).unwrap().len());
        let switch = timed("switch active/visible layer", 20, &|| {
            let target = layer_ids[(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().subsec_nanos() as usize) % 20].clone();
            set_view_in_database(&db, &SetAnnotationLayerViewRequest { owner_kind: "paper".into(), owner_id: "paper-perf".into(), active_layer_id: target.clone(), visible_layer_ids: vec![target] }).unwrap();
            list_visible_annotations_for_paper(&connection, "paper-perf").unwrap().len()
        });
        assert_eq!(visible.1, 500, "the startup/reader read is bounded by the visible layer");
        assert_eq!(everything.1, 10_000);
        assert_eq!(counts.1, 20);
        assert!(visible.2 * 4.0 < everything.2, "visible-layer read ({:.2} ms) must be far cheaper than loading every layer ({:.2} ms)", visible.2, everything.2);
        assert!(counts.2 < 250.0, "layer counts took {:.2} ms", counts.2);
        println!(
            "ANNOTATION_LAYER_PERF {{\"layers\":20,\"annotations\":10000,\"seed_ms\":{seed_ms:.1},\"visible_layer_read_ms\":{:.2},\"visible_rows\":{},\"all_layers_read_ms\":{:.2},\"all_rows\":{},\"layer_counts_ms\":{:.2},\"switch_layer_ms\":{:.2},\"plan\":{:?}}}",
            visible.2, visible.1, everything.2, everything.1, counts.2, switch.2, plan
        );
        drop(connection);
        let _ = std::fs::remove_dir_all(root);
    }
}
