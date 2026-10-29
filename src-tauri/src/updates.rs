//! Updates from GitHub releases of CookieJarTools/Whisk. Each release carries a
//! signed installer and a `latest.json` describing it; the updater plugin checks
//! the signature against the public key in tauri.conf.json before installing.
//! Any release can be installed, so people can also move back to an older one.

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_updater::{Update, UpdaterExt};

const REPO: &str = "CookieJarTools/Whisk";

#[derive(Default)]
pub struct UpdateState {
    pending: Mutex<Option<Update>>,
    downloaded: Mutex<Option<Vec<u8>>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    tag: String,
    version: String,
    name: String,
    published_at: String,
    prerelease: bool,
    notes: String,
    url: String,
    /// Has a signed `latest.json`, so it can be installed from inside the app.
    installable: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    version: String,
    current_version: String,
    notes: Option<String>,
    date: Option<String>,
}

#[derive(Clone, Serialize)]
struct Progress {
    downloaded: u64,
    total: Option<u64>,
}

#[tauri::command]
pub async fn list_releases() -> Result<Vec<Release>, String> {
    let client = reqwest::Client::builder().user_agent("Whisk updater").build().map_err(|e| e.to_string())?;
    let releases: Vec<serde_json::Value> = client
        .get(format!("https://api.github.com/repos/{REPO}/releases?per_page=50"))
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("Couldn't reach GitHub: {e}"))?
        .error_for_status()
        .map_err(|e| format!("GitHub said no: {e}"))?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    Ok(releases
        .iter()
        .filter(|r| !r["draft"].as_bool().unwrap_or(false))
        .map(|r| {
            let tag = r["tag_name"].as_str().unwrap_or_default().to_string();
            let installable = r["assets"]
                .as_array()
                .map(|assets| assets.iter().any(|a| a["name"].as_str() == Some("latest.json")))
                .unwrap_or(false);
            Release {
                version: tag.trim_start_matches('v').to_string(),
                name: r["name"].as_str().filter(|n| !n.is_empty()).unwrap_or(&tag).to_string(),
                published_at: r["published_at"].as_str().unwrap_or_default().to_string(),
                prerelease: r["prerelease"].as_bool().unwrap_or(false),
                notes: r["body"].as_str().unwrap_or_default().to_string(),
                url: r["html_url"].as_str().unwrap_or_default().to_string(),
                installable,
                tag,
            }
        })
        .collect())
}

/// Checks a release for an installable update. With no `tag`, the latest stable
/// release; it only counts if it's newer. With a `tag`, that exact release, newer
/// or older, as long as it differs from the running version.
#[tauri::command]
pub async fn check_update(app: AppHandle, state: State<'_, UpdateState>, tag: Option<String>) -> Result<Option<UpdateInfo>, String> {
    let endpoint = match &tag {
        Some(tag) => format!("https://github.com/{REPO}/releases/download/{tag}/latest.json"),
        None => format!("https://github.com/{REPO}/releases/latest/download/latest.json"),
    };
    let url = endpoint.parse().map_err(|e: url::ParseError| e.to_string())?;
    let pick_any = tag.is_some();
    let update = app
        .updater_builder()
        .endpoints(vec![url])
        .map_err(|e| e.to_string())?
        .version_comparator(move |current, release| if pick_any { release.version != current } else { release.version > current })
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| format!("Update check failed: {e}"))?;

    *state.downloaded.lock().unwrap() = None;
    let info = update.as_ref().map(|u| UpdateInfo {
        version: u.version.clone(),
        current_version: u.current_version.clone(),
        notes: u.body.clone(),
        date: u.date.map(|d| d.to_string()),
    });
    *state.pending.lock().unwrap() = update;
    Ok(info)
}

/// Downloads the update found by `check_update`, emitting `update-progress`.
#[tauri::command]
pub async fn download_update(app: AppHandle, state: State<'_, UpdateState>) -> Result<(), String> {
    let update = state.pending.lock().unwrap().clone().ok_or("Check for an update first")?;
    let mut downloaded: u64 = 0;
    let bytes = update
        .download(
            |chunk, total| {
                downloaded += chunk as u64;
                let _ = app.emit("update-progress", Progress { downloaded, total });
            },
            || {},
        )
        .await
        .map_err(|e| format!("Download failed: {e}"))?;
    *state.downloaded.lock().unwrap() = Some(bytes);
    Ok(())
}

/// Installs the downloaded update and restarts into it. On Windows the
/// installer takes over and relaunches Whisk itself; on Linux the AppImage
/// (or .deb or .rpm) is replaced in place first.
#[tauri::command]
pub fn install_update(app: AppHandle, state: State<'_, UpdateState>) -> Result<(), String> {
    let update = state.pending.lock().unwrap().clone().ok_or("No update to install")?;
    let bytes = state.downloaded.lock().unwrap().take().ok_or("Download the update first")?;
    update.install(bytes).map_err(|e| format!("Install failed: {e}"))?;
    app.restart();
}
