// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK draws a blank or flickering window with NVIDIA's driver on many Linux
    // set-ups unless DMA-BUF rendering is off. Someone who has set it either way is left alone.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() && std::path::Path::new("/proc/driver/nvidia/version").exists() {
        // SAFETY: nothing else is running yet to read the environment at the same time.
        unsafe { std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1") };
    }
    whisk_lib::run()
}
