//! A4Note's Tauri entry point (P2-1).
//!
//! Wiring only: module declarations, command registry and lifecycle.
//! Command bodies belong to their domain modules. `agent_cli` has no Tauri;
//! `agent_bridge` joins the two but never accesses SQLite. Agent history
//! commands remain on the database side in `state_commands` (CLI-4).
mod agent_bridge;
pub mod agent_cli;
mod agent_history;
mod app_paths;
mod backup;
mod capture;
mod database;
mod diagnostics;
mod guide;
mod library_ai;
mod library_access;
mod library_annotations;
mod library_import;
mod library_notes;
mod library_summaries;
mod library_summary_notes;
mod library_summary_provision;
mod library_papers;
mod library_state;
mod pdf_metadata;
mod plugin_sandbox;
mod project_commands;
mod project_tasks;
mod resource_annotations;
mod state_commands;
mod sync_commands;
mod workbench_store;
mod workspace_fs;
mod window_commands;

#[cfg(test)]
mod library_tests;
#[cfg(test)]
mod startup_tests;
#[cfg(test)]
mod integrity_tests;
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // The Agent supervisor needs an AppHandle to emit with, so it can only be
        // built here — before any window is able to invoke a command.
        .setup(|app| {
            let root = app_paths::app_data_root(app.handle()).map_err(std::io::Error::other)?;
            backup::recover_interrupted_restore(&root).map_err(std::io::Error::other)?;
            agent_bridge::register(app.handle());
            capture::start_native(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_paths::get_aster_paths,
            app_paths::initialize_library,
            diagnostics::get_app_diagnostics,
            capture::capture_control,
            app_paths::reveal_aster_path,
            project_commands::describe_project_folder,
            project_tasks::start_project_tasks,
            project_commands::list_directory_entries,
            project_commands::reveal_path,
            project_commands::open_path_external,
            project_commands::open_path_in_vscode,
            project_commands::open_external_url,
            project_commands::read_text_file_preview,
            project_commands::read_text_file,
            project_commands::write_text_file,
            project_commands::rename_text_file,
            project_commands::move_path,
            project_commands::create_text_file,
            project_commands::create_directory,
            project_commands::rename_directory,
            project_commands::delete_empty_directory,
            project_commands::delete_text_file,
            project_commands::read_file_bytes,
            project_commands::detect_agent_cli,
            project_commands::run_project_command,
            plugin_sandbox::capabilities,
            plugin_sandbox::run,
            agent_bridge::start_agent_session,
            agent_bridge::send_agent_message,
            agent_bridge::stop_agent_session,
            agent_bridge::close_agent_session,
            agent_bridge::agent_session_running,
            state_commands::load_agent_messages,
            state_commands::save_agent_messages,
            state_commands::load_workbench_state,
            state_commands::save_workbench_state,
            sync_commands::get_sync_state,
            sync_commands::list_sync_outbox,
            sync_commands::reconcile_sync_operations,
            sync_commands::mark_sync_retry,
            sync_commands::apply_sync_pull,
            sync_commands::record_sync_error,
            backup::create_library_backup,
            backup::restore_library_backup,
            backup::restart_after_library_restore,
            pdf_metadata::extract_pdf_metadata,
            library_import::import_pdf_to_library,
            library_import::import_translated_pdf_to_library,
            library_import::load_paper_file_bytes,
            library_import::reveal_paper_file,
            library_import::open_paper_file,
            library_papers::list_papers,
            library_state::update_paper_state,
            library_papers::list_folders,
            library_papers::create_folder,
            library_papers::rename_folder,
            library_papers::delete_folder,
            library_papers::move_papers_to_folder,
            library_annotations::create_annotation,
            library_annotations::restore_annotation,
            library_annotations::update_annotation_comment,
            library_annotations::update_annotation_color,
            library_annotations::update_annotation_position,
            library_annotations::delete_annotation,
            resource_annotations::list_resource_annotations,
            resource_annotations::create_resource_annotation,
            resource_annotations::restore_resource_annotation,
            resource_annotations::update_resource_annotation_comment,
            resource_annotations::update_resource_annotation_color,
            resource_annotations::update_resource_annotation_position,
            resource_annotations::delete_resource_annotation,
            library_summary_notes::create_paper_summary_note,
            library_summary_provision::provision_summary_notes,
            library_summaries::read_paper_summary,
            library_summaries::ensure_paper_summary,
            library_summaries::save_paper_summary,
            library_summaries::read_summary_layout,
            library_summaries::save_summary_layout,
            library_summaries::import_summary_image,
            library_summaries::read_summary_image,
            library_notes::upsert_note,
            library_notes::delete_note,
            library_papers::update_paper_metadata,
            library_papers::update_paper_tags,
            library_papers::delete_paper,
            library_ai::list_ai_threads,
            library_ai::append_ai_message,
            library_ai::clear_ai_threads,
            window_commands::perform_window_command
        ])
        .build(tauri::generate_context!())
        .expect("failed to run A4Note")
        // A CLI child must not outlive the window: Tauri's exit path does not run
        // destructors, so the sessions are closed here.
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                agent_bridge::shutdown(app);
                capture::shutdown();
            }
        });
}
