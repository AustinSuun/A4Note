//! Native window controls for A4Note's frameless desktop chrome.
//!
//! These commands run in Rust instead of through Tauri's JavaScript window
//! permissions, keeping the title bar controls available to the app UI.

use tauri::WebviewWindow;

#[tauri::command]
pub(crate) fn perform_window_command(
    window: WebviewWindow,
    command: String,
) -> Result<bool, String> {
    match command.as_str() {
        "minimize" => window.minimize().map_err(|error| error.to_string()),
        "toggle_maximize" => {
            let maximized = window.is_maximized().map_err(|error| error.to_string())?;
            if maximized {
                window.unmaximize().map_err(|error| error.to_string())
            } else {
                window.maximize().map_err(|error| error.to_string())
            }
        }
        "close" => window.close().map_err(|error| error.to_string()),
        "start_dragging" => window.start_dragging().map_err(|error| error.to_string()),
        _ => return Err(format!("Unsupported window command: {command}")),
    }?;

    window.is_maximized().map_err(|error| error.to_string())
}
