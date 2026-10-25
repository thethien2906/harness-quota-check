#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use serde_json::{json, Value};
use std::{collections::BTreeMap, io::{BufRead, BufReader, Write}, process::{Child, ChildStdin, Command, Stdio}, sync::Mutex, time::{Duration, Instant}};
use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow};
mod worker_paths;
mod edge_geometry;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UiState { mode: String, pinned: bool }
struct Worker { child: Child, input: ChildStdin, job: usize }
struct AppState {
    snapshots: Mutex<BTreeMap<String, Value>>,
    ui: Mutex<UiState>,
    worker: Mutex<Option<Worker>>,
}
impl Default for AppState {
    fn default() -> Self { Self { snapshots: Mutex::new(BTreeMap::new()), ui: Mutex::new(UiState { mode: "hidden".into(), pinned: false }), worker: Mutex::new(None) } }
}

fn place(window: &WebviewWindow, mode: &str) -> tauri::Result<()> {
    let Some(monitor) = window.primary_monitor()? else { return Ok(()) };
    let area = monitor.work_area(); let scale = monitor.scale_factor();
    let (width, height) = edge_geometry::window_size(mode);
    let height = (height * scale).min((area.size.height as f64 - 24.0 * scale).max(100.0));
    let width = (width * scale).min(area.size.width as f64);
    let size = PhysicalSize::new(width as u32, height as u32);
    let position = PhysicalPosition::new(area.position.x + area.size.width as i32 - width as i32, area.position.y + (area.size.height as i32 - height as i32) / 2);
    if window.outer_size()? != size { window.set_size(size)?; }
    if window.outer_position()? != position { window.set_position(position)?; }
    Ok(())
}
fn change_mode(app: &tauri::AppHandle, mode: &str) -> Result<(), String> {
    if !["hidden", "compact", "detail"].contains(&mode) { return Err("INVALID_MODE".into()) }
    let state = app.state::<AppState>();
    let Some(window) = app.get_webview_window("main") else { return Err("WINDOW_UNAVAILABLE".into()) };
    place(&window, mode).map_err(|_| "WINDOW_UNAVAILABLE")?;
    // Native pointer tracking opens the 5-DIP trigger. The rest of the hidden
    // envelope must pass clicks to the application underneath.
    window.set_ignore_cursor_events(mode == "hidden").map_err(|_| "WINDOW_UNAVAILABLE")?;
    let ui = { let mut ui = state.ui.lock().unwrap(); ui.mode = mode.into(); ui.clone() };
    let _ = app.emit("view-state", ui);
    Ok(())
}
#[tauri::command]
fn initial_state(state: State<AppState>) -> Value {
    json!({ "providers": *state.snapshots.lock().unwrap(), "view": *state.ui.lock().unwrap() })
}
#[tauri::command]
fn set_mode(app: tauri::AppHandle, mode: String) -> Result<(), String> {
    change_mode(&app, &mode)?;
    if mode == "detail" { if let Some(window) = app.get_webview_window("main") { let _ = window.set_focus(); } }
    Ok(())
}
#[tauri::command]
fn set_pinned(app: tauri::AppHandle, pinned: bool) {
    let state = app.state::<AppState>();
    let ui = { let mut ui = state.ui.lock().unwrap(); ui.pinned = pinned; ui.clone() };
    let _ = app.emit("view-state", ui);
}
#[tauri::command]
fn refresh_provider(state: State<AppState>, provider: String) -> Result<(), String> {
    if !["codex", "antigravity", "claude"].contains(&provider.as_str()) { return Err("INVALID_PROVIDER".into()); }
    let mut worker = state.worker.lock().unwrap();
    let Some(worker) = worker.as_mut() else { return Err("WORKER_UNAVAILABLE".into()) };
    writeln!(worker.input, "{}", json!({ "type": "refresh", "provider": provider })).map_err(|_| "WORKER_UNAVAILABLE".into())
}
#[tauri::command]
fn quit(app: tauri::AppHandle) { app.exit(0); }

fn worker_error(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    for provider in ["codex", "antigravity", "claude"] {
        let value = json!({ "provider": provider, "running": null, "loading": false, "snapshot": null, "error": { "code": "WORKER_UNAVAILABLE", "error": "The quota reader is unavailable. Reopen Quota Peek." } });
        state.snapshots.lock().unwrap().insert(provider.into(), value.clone());
        let _ = app.emit("provider-state", value);
    }
}
fn start_worker(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let resources = app.path().resource_dir()?;
    let packaged = resources.join("resources");
    let base = if packaged.join("runtime/node.exe").is_file() && packaged.join("providers/worker.mjs").is_file() {
        packaged
    } else if cfg!(debug_assertions) {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("resources")
    } else { return Err("PACKAGED_RUNTIME_MISSING".into()); };
    let base = worker_paths::for_node(&base);
    let mut command = Command::new(base.join("runtime/node.exe"));
    command.arg(base.join("providers/worker.mjs")).current_dir(&base).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
    let mut child = command.spawn()?;
    let job = attach_job(&child);
    let input = child.stdin.take().ok_or("WORKER_UNAVAILABLE")?;
    let output = child.stdout.take().ok_or("WORKER_UNAVAILABLE")?;
    *app.state::<AppState>().worker.lock().unwrap() = Some(Worker { child, input, job });
    let handle = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(output).lines() {
            let Ok(line) = line else { break };
            if line.len() > 1024 * 1024 { continue; }
            let Ok(value) = serde_json::from_str::<Value>(&line) else { continue };
            let Some(provider) = value["provider"].as_str() else { continue };
            if !["codex", "antigravity", "claude"].contains(&provider) { continue; }
            handle.state::<AppState>().snapshots.lock().unwrap().insert(provider.into(), value.clone());
            let _ = handle.emit("provider-state", value);
        }
        worker_error(&handle);
    });
    Ok(())
}
#[cfg(windows)]
fn attach_job(child: &Child) -> usize {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::{Foundation::CloseHandle, System::JobObjects::*};
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() { return 0; }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if SetInformationJobObject(job, JobObjectExtendedLimitInformation, &info as *const _ as *const _, std::mem::size_of_val(&info) as u32) == 0 || AssignProcessToJobObject(job, child.as_raw_handle()) == 0 {
            CloseHandle(job); return 0;
        }
        job as usize
    }
}
#[cfg(not(windows))]
fn attach_job(_: &Child) -> usize { 0 }
fn stop_worker(app: &tauri::AppHandle) {
    if let Some(mut worker) = app.state::<AppState>().worker.lock().unwrap().take() {
        let _ = worker.child.kill();
        #[cfg(windows)] if worker.job != 0 { unsafe { windows_sys::Win32::Foundation::CloseHandle(worker.job as _); } }
        let _ = worker.child.wait();
    }
}

fn start_edge_watcher(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut entered: Option<Instant> = None;
        let mut left: Option<Instant> = None;
        let mut last_layout = Instant::now();
        loop {
            std::thread::sleep(Duration::from_millis(32));
            let Some(window) = app.get_webview_window("main") else { break };
            let state = app.state::<AppState>();
            let ui = state.ui.lock().unwrap().clone();
            if last_layout.elapsed() > Duration::from_secs(3) { let _ = place(&window, &ui.mode); last_layout = Instant::now(); }
            let Some((x, y)) = cursor_position() else { continue };
            let (Ok(pos), Ok(size)) = (window.outer_position(), window.outer_size()) else { continue };
            let inside = if ui.mode == "hidden" {
                edge_geometry::in_trigger((x, y), (pos.x, pos.y), (size.width, size.height), window.scale_factor().unwrap_or(1.0))
            } else { x >= pos.x && x < pos.x + size.width as i32 && y >= pos.y && y < pos.y + size.height as i32 };
            if inside {
                left = None;
                if ui.mode == "hidden" && entered.get_or_insert_with(Instant::now).elapsed() >= Duration::from_millis(180) { let _ = change_mode(&app, "compact"); entered = None; }
            } else {
                entered = None;
                if ui.mode != "hidden" && !ui.pinned && !window.is_focused().unwrap_or(false) && left.get_or_insert_with(Instant::now).elapsed() >= Duration::from_millis(650) {
                    let _ = change_mode(&app, "hidden"); left = None;
                }
            }
        }
    });
}
#[cfg(windows)]
fn cursor_position() -> Option<(i32, i32)> {
    let mut point = windows_sys::Win32::Foundation::POINT { x: 0, y: 0 };
    if unsafe { windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos(&mut point) } != 0 { Some((point.x, point.y)) } else { None }
}
#[cfg(not(windows))]
fn cursor_position() -> Option<(i32, i32)> { None }

fn main() {
    let context = tauri::generate_context!();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| { let _ = change_mode(app, "compact"); }))
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![initial_state, set_mode, set_pinned, refresh_provider, quit])
        .setup(|app| {
            let trace = |stage: &str| { if std::env::var_os("QUOTA_PEEK_SMOKE_TRACE").is_some() { eprintln!("[quota-peek] {stage}"); } };
            trace("setup-start");
            let config = app.config().app.windows.first().ok_or("WINDOW_CONFIG_MISSING")?.clone();
            let mut builder = tauri::WebviewWindowBuilder::from_config(app.handle(), &config)
                .map_err(|e| std::io::Error::other(format!("WINDOW_CONFIG: {e}")))?;
            // The config file's dataDirectory is relative-only; the builder
            // accepts an explicit absolute profile for isolated smoke checks.
            // This does not change provider credential locations.
            if let Some(path) = std::env::var_os("QUOTA_PEEK_WEBVIEW_DIR") {
                builder = builder.data_directory(path.into());
            } else if cfg!(debug_assertions) {
                builder = builder.data_directory(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.cache/webview-dev"));
            }
            builder.build().map_err(|e| std::io::Error::other(format!("WINDOW_CREATE: {e}")))?;
            trace("webview-created");
            use tauri::{menu::{Menu, MenuItem}, tray::TrayIconBuilder};
            let open = MenuItem::with_id(app, "open", "Open Quota Peek", true, None::<&str>)?;
            let hide = MenuItem::with_id(app, "hide", "Hide to screen edge", true, None::<&str>)?;
            let exit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &hide, &exit])?;
            TrayIconBuilder::new().icon(tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?).tooltip("Quota Peek").menu(&menu).show_menu_on_left_click(false)
                .on_menu_event(|app, event| { match event.id.as_ref() { "open" => { let _ = change_mode(app, "compact"); }, "hide" => { let _ = change_mode(app, "hidden"); }, "quit" => app.exit(0), _ => {} } })
                .on_tray_icon_event(|tray, event| { if matches!(event, tauri::tray::TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, button_state: tauri::tray::MouseButtonState::Up, .. }) { let _ = change_mode(tray.app_handle(), "compact"); } }).build(app).map_err(|e| std::io::Error::other(format!("TRAY_CREATE: {e}")))?;
            trace("tray-created");
            let window = app.get_webview_window("main").ok_or("WINDOW_UNAVAILABLE")?;
            change_mode(app.handle(), "hidden").map_err(std::io::Error::other)?;
            window.show()?;
            trace("window-visible");
            let handle = app.handle().clone();
            std::thread::spawn(move || { if start_worker(&handle).is_err() { worker_error(&handle); } });
            start_edge_watcher(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| { if let tauri::WindowEvent::CloseRequested { api, .. } = event { api.prevent_close(); let _ = change_mode(window.app_handle(), "hidden"); } })
        .build(context).expect("Could not start Quota Peek");
    app.run(|handle, event| { if matches!(event, tauri::RunEvent::ExitRequested { .. }) { stop_worker(handle); } });
}
