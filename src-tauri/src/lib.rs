use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::Manager;

// ---------------------------------------------------------------------------
// State structs
// ---------------------------------------------------------------------------

struct SidecarState {
    child: Option<std::process::Child>,
}

struct RecordingState {
    is_recording: Arc<AtomicBool>,
    stop_signal: Arc<AtomicBool>,
    audio_data: Arc<Mutex<Vec<f32>>>,
    sample_rate: Arc<Mutex<u32>>,
}

// ---------------------------------------------------------------------------
// Sidecar management (Python backend)
// ---------------------------------------------------------------------------

fn find_sidecar_dir() -> Option<PathBuf> {
    let candidates: Vec<PathBuf> = [
        // Dev mode: python-sidecar next to CWD
        std::env::current_dir().ok().map(|p| p.join("python-sidecar")),
        std::env::current_dir()
            .ok()
            .and_then(|p| p.parent().map(|pp| pp.join("python-sidecar"))),
        // Dev mode: python-sidecar next to binary
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|pp| pp.join("python-sidecar"))),
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().and_then(|pp| pp.parent()).map(|pp| pp.join("python-sidecar"))),
        // Bundled .app: Contents/Resources/python-sidecar
        std::env::current_exe().ok().and_then(|p| {
            p.parent()
                .and_then(|pp| pp.parent())
                .map(|pp| pp.join("Resources").join("python-sidecar"))
        }),
        // Tauri bundles "../python-sidecar" as "Resources/_up_/python-sidecar"
        std::env::current_exe().ok().and_then(|p| {
            p.parent()
                .and_then(|pp| pp.parent())
                .map(|pp| pp.join("Resources").join("_up_").join("python-sidecar"))
        }),
    ]
    .into_iter()
    .flatten()
    .collect();

    for dir in &candidates {
        if dir.join("server.py").exists() {
            println!("[sidecar] Found at: {:?}", dir);
            return Some(dir.clone());
        }
    }
    eprintln!("[sidecar] Not found. Searched: {:?}", candidates);
    None
}

/// Get the app data directory for storing venv and other runtime data.
fn get_app_data_dir() -> PathBuf {
    #[cfg(target_os = "macos")]
    let base = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join("Library")
        .join("Application Support")
        .join("local-whisper");
    #[cfg(not(target_os = "macos"))]
    let base = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join(".local")
        .join("share")
        .join("local-whisper");
    let _ = std::fs::create_dir_all(&base);
    base
}

/// Ensure Python venv exists and dependencies are installed.
/// Returns the path to the Python interpreter to use.
fn ensure_venv(sidecar_dir: &PathBuf) -> PathBuf {
    let app_data = get_app_data_dir();
    let venv_dir = app_data.join("venv");
    let venv_py = venv_dir.join("bin").join("python3");

    // Dev mode: check for venv inside the sidecar dir first
    let dev_venv_py = sidecar_dir.join("venv").join("bin").join("python3");
    if dev_venv_py.exists() {
        println!("[sidecar] Using dev venv: {:?}", dev_venv_py);
        return dev_venv_py;
    }

    // Production: use venv in app data directory
    if venv_py.exists() {
        println!("[sidecar] Venv exists at: {:?}", venv_dir);
        // Check if deps are installed by looking for uvicorn
        let uvicorn_check = std::process::Command::new(&venv_py)
            .args(["-c", "import uvicorn"])
            .output();
        match uvicorn_check {
            Ok(o) if o.status.success() => return venv_py,
            _ => println!("[sidecar] Venv exists but deps missing, reinstalling..."),
        }
    }

    // Create venv if it doesn't exist
    if !venv_py.exists() {
        println!("[sidecar] Creating venv at: {:?}", venv_dir);
        let status = std::process::Command::new("python3")
            .args(["-m", "venv"])
            .arg(&venv_dir)
            .status();
        match status {
            Ok(s) if s.success() => println!("[sidecar] Venv created"),
            Ok(s) => {
                eprintln!("[sidecar] Venv creation exited with: {}", s);
                // Fallback to system python
                return PathBuf::from("python3");
            }
            Err(e) => {
                eprintln!("[sidecar] Failed to create venv: {}", e);
                return PathBuf::from("python3");
            }
        }
    }

    // Install dependencies
    let req_file = sidecar_dir.join("requirements.txt");
    if req_file.exists() {
        println!("[sidecar] Installing dependencies (this may take a few minutes on first run)...");
        let pip = venv_dir.join("bin").join("pip");
        let output = std::process::Command::new(&pip)
            .args(["install", "--upgrade", "pip"])
            .output();
        if let Err(e) = output {
            eprintln!("[sidecar] pip upgrade failed: {}", e);
        }

        let status = std::process::Command::new(&pip)
            .args(["install", "-r"])
            .arg(&req_file)
            .output();
        match status {
            Ok(o) if o.status.success() => println!("[sidecar] Dependencies installed"),
            Ok(o) => {
                let stderr = String::from_utf8_lossy(&o.stderr);
                eprintln!("[sidecar] pip install failed: {}", stderr);
            }
            Err(e) => eprintln!("[sidecar] Failed to run pip: {}", e),
        }
    }

    venv_py
}

/// Start the Python sidecar in a background thread.
/// Returns immediately so the UI is not blocked.
fn start_python_sidecar_async(sidecar_state: Arc<Mutex<SidecarState>>) {
    std::thread::spawn(move || {
        // Check if already running
        if let Ok(resp) = std::process::Command::new("curl")
            .args(["-s", "-o", "/dev/null", "-w", "%{http_code}", "http://127.0.0.1:11435/api/health"])
            .output()
        {
            if String::from_utf8_lossy(&resp.stdout).trim() == "200" {
                println!("[sidecar] Already running on port 11435");
                return;
            }
        }

        let dir = match find_sidecar_dir() {
            Some(d) => d,
            None => {
                eprintln!("[sidecar] Could not find python-sidecar directory");
                return;
            }
        };

        let python = ensure_venv(&dir);
        let python_str = python.to_string_lossy().to_string();

        println!("[sidecar] Starting: {} server.py", python_str);
        match std::process::Command::new(&python_str)
            .arg(dir.join("server.py").to_string_lossy().as_ref())
            .arg("11435")
            .current_dir(&dir)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
        {
            Ok(child) => {
                println!("[sidecar] PID: {}", child.id());
                let mut guard = sidecar_state.lock().unwrap();
                guard.child = Some(child);
            }
            Err(e) => {
                eprintln!("[sidecar] Failed to start: {}", e);
            }
        }
    });
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn get_sidecar_port() -> u16 {
    11435
}

/// Show the overlay window
#[tauri::command]
fn show_overlay(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("overlay") {
        win.show().map_err(|e| format!("show error: {}", e))?;
        win.center().map_err(|e| format!("center error: {}", e))?;
    }
    Ok(())
}

/// Hide the overlay window
#[tauri::command]
fn hide_overlay(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("overlay") {
        win.hide().map_err(|e| format!("hide error: {}", e))?;
    }
    Ok(())
}

/// Start recording audio from the default input device using cpal.
#[tauri::command]
fn start_recording(state: tauri::State<'_, RecordingState>) -> Result<(), String> {
    if state.is_recording.load(Ordering::SeqCst) {
        return Err("Already recording".into());
    }

    state.audio_data.lock().unwrap().clear();
    state.is_recording.store(true, Ordering::SeqCst);
    state.stop_signal.store(false, Ordering::SeqCst);

    let is_recording = state.is_recording.clone();
    let stop_signal = state.stop_signal.clone();
    let audio_data = state.audio_data.clone();
    let sample_rate_store = state.sample_rate.clone();

    std::thread::spawn(move || {
        use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

        let host = cpal::default_host();
        let device = match host.default_input_device() {
            Some(d) => d,
            None => {
                eprintln!("[record] No input device found");
                is_recording.store(false, Ordering::SeqCst);
                return;
            }
        };

        println!("[record] Device: {:?}", device.name());

        let config = match device.default_input_config() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[record] No input config: {}", e);
                is_recording.store(false, Ordering::SeqCst);
                return;
            }
        };

        let sr = config.sample_rate().0;
        *sample_rate_store.lock().unwrap() = sr;
        let channels = config.channels() as usize;
        println!("[record] Sample rate: {}, channels: {}", sr, channels);

        let audio_data_cb = audio_data.clone();
        let is_recording_cb = is_recording.clone();

        let err_fn = |err: cpal::StreamError| {
            eprintln!("[record] Stream error: {}", err);
        };

        let stream = match config.sample_format() {
            cpal::SampleFormat::F32 => device
                .build_input_stream(
                    &config.into(),
                    move |data: &[f32], _: &cpal::InputCallbackInfo| {
                        if !is_recording_cb.load(Ordering::SeqCst) {
                            return;
                        }
                        let mut buf = audio_data_cb.lock().unwrap();
                        if channels == 1 {
                            buf.extend_from_slice(data);
                        } else {
                            for chunk in data.chunks(channels) {
                                let sum: f32 = chunk.iter().sum();
                                buf.push(sum / channels as f32);
                            }
                        }
                    },
                    err_fn,
                    None,
                ),
            cpal::SampleFormat::I16 => {
                let audio_data_i16 = audio_data.clone();
                let is_recording_i16 = is_recording.clone();
                device.build_input_stream(
                    &config.into(),
                    move |data: &[i16], _: &cpal::InputCallbackInfo| {
                        if !is_recording_i16.load(Ordering::SeqCst) {
                            return;
                        }
                        let mut buf = audio_data_i16.lock().unwrap();
                        if channels == 1 {
                            for &s in data {
                                buf.push(s as f32 / 32768.0);
                            }
                        } else {
                            for chunk in data.chunks(channels) {
                                let sum: f32 = chunk.iter().map(|&s| s as f32 / 32768.0).sum();
                                buf.push(sum / channels as f32);
                            }
                        }
                    },
                    err_fn,
                    None,
                )
            }
            other => {
                eprintln!("[record] Unsupported sample format: {:?}", other);
                is_recording.store(false, Ordering::SeqCst);
                return;
            }
        };

        let stream = match stream {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[record] Build stream error: {}", e);
                is_recording.store(false, Ordering::SeqCst);
                return;
            }
        };

        if let Err(e) = stream.play() {
            eprintln!("[record] Play error: {}", e);
            is_recording.store(false, Ordering::SeqCst);
            return;
        }

        println!("[record] Started");

        while !stop_signal.load(Ordering::SeqCst) {
            std::thread::sleep(std::time::Duration::from_millis(20));
        }

        drop(stream);
        println!("[record] Stream dropped");
    });

    Ok(())
}

/// Stop recording and save the captured audio as a WAV file.
#[tauri::command]
fn stop_recording(state: tauri::State<'_, RecordingState>) -> Result<String, String> {
    if !state.is_recording.load(Ordering::SeqCst) {
        return Err("Not recording".into());
    }

    state.is_recording.store(false, Ordering::SeqCst);
    state.stop_signal.store(true, Ordering::SeqCst);

    std::thread::sleep(std::time::Duration::from_millis(150));

    let data = {
        let mut buf = state.audio_data.lock().unwrap();
        let d = buf.clone();
        buf.clear();
        d
    };

    let sr = *state.sample_rate.lock().unwrap();
    println!(
        "[record] Stopped. Samples: {}, Duration: {:.2}s",
        data.len(),
        data.len() as f64 / sr as f64
    );

    if data.is_empty() {
        return Err("No audio data captured".into());
    }

    // Resample to 16000 Hz if needed
    let (final_data, final_sr) = if sr != 16000 {
        let ratio = 16000.0 / sr as f64;
        let new_len = (data.len() as f64 * ratio) as usize;
        let mut resampled = Vec::with_capacity(new_len);
        for i in 0..new_len {
            let src_idx = i as f64 / ratio;
            let idx = src_idx as usize;
            let frac = src_idx - idx as f64;
            let s = if idx + 1 < data.len() {
                data[idx] * (1.0 - frac as f32) + data[idx + 1] * frac as f32
            } else if idx < data.len() {
                data[idx]
            } else {
                0.0
            };
            resampled.push(s);
        }
        (resampled, 16000u32)
    } else {
        (data, sr)
    };

    // Write WAV file
    let tmp_dir = std::env::temp_dir();
    let wav_path = tmp_dir.join("local_whisper_recording.wav");
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: final_sr,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer =
        hound::WavWriter::create(&wav_path, spec).map_err(|e| format!("WAV write error: {}", e))?;
    for &sample in &final_data {
        let s = (sample.clamp(-1.0, 1.0) * 32767.0) as i16;
        writer
            .write_sample(s)
            .map_err(|e| format!("WAV sample error: {}", e))?;
    }
    writer
        .finalize()
        .map_err(|e| format!("WAV finalize error: {}", e))?;

    let path_str = wav_path.to_string_lossy().to_string();
    println!("[record] Saved to: {}", path_str);
    Ok(path_str)
}

/// Simulate keyboard typing to insert text into the currently focused application.
#[tauri::command]
fn type_text(text: String) -> Result<(), String> {
    use enigo::{Enigo, Keyboard, Settings};

    println!("[type] Inserting {} chars", text.len());
    let mut enigo =
        Enigo::new(&Settings::default()).map_err(|e| format!("Enigo init error: {}", e))?;

    std::thread::sleep(std::time::Duration::from_millis(100));

    enigo
        .text(&text)
        .map_err(|e| format!("Enigo type error: {}", e))?;

    println!("[type] Done");
    Ok(())
}

/// Check if accessibility permissions are granted (macOS).
#[tauri::command]
fn check_accessibility() -> bool {
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("osascript")
            .arg("-e")
            .arg("tell application \"System Events\" to return name of first process")
            .output();
        match output {
            Ok(o) => o.status.success(),
            Err(_) => false,
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            // Create sidecar state and share it with the background thread
            let sidecar_state = Arc::new(Mutex::new(SidecarState { child: None }));
            app.manage(sidecar_state.clone());

            // Start Python sidecar in background thread (non-blocking)
            // This allows the UI to show immediately while venv setup happens
            start_python_sidecar_async(sidecar_state);

            // Initialize recording state
            app.manage(RecordingState {
                is_recording: Arc::new(AtomicBool::new(false)),
                stop_signal: Arc::new(AtomicBool::new(false)),
                audio_data: Arc::new(Mutex::new(Vec::new())),
                sample_rate: Arc::new(Mutex::new(16000)),
            });

            // Pre-create overlay window (hidden)
            let _overlay = tauri::WebviewWindowBuilder::new(
                app,
                "overlay",
                tauri::WebviewUrl::App("/overlay".into()),
            )
            .title("")
            .inner_size(300.0, 64.0)
            .center()
            .resizable(false)
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .focused(false)
            .shadow(false)
            .visible(false)
            .build();

            match &_overlay {
                Ok(_) => println!("[overlay] Pre-created (hidden)"),
                Err(e) => eprintln!("[overlay] Failed to create: {}", e),
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_sidecar_port,
            start_recording,
            stop_recording,
            type_text,
            check_accessibility,
            show_overlay,
            hide_overlay,
        ])
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    if window.label() == "main" {
                        // Hide the window instead of closing it (macOS standard behavior)
                        api.prevent_close();
                        let _ = window.hide();
                        println!("[window] Main window hidden (use Cmd+Q to quit)");
                    }
                }
                tauri::WindowEvent::Destroyed => {
                    if window.label() == "main" {
                        let app = window.app_handle();
                        let state = app.state::<Arc<Mutex<SidecarState>>>();
                        let mut guard = state.lock().unwrap();
                        if let Some(ref mut child) = guard.child {
                            println!("[sidecar] Killing PID: {}", child.id());
                            let _ = child.kill();
                        }
                    }
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
