//! Programs Whisk starts get the environment the user started Whisk with. An AppImage's
//! launcher points LD_LIBRARY_PATH, PYTHONHOME, PATH and GTK's settings at the libraries
//! bundled inside it. Whisk needs those, but other programs break on them: the system's
//! node picks up the AppImage's older libffi and won't start, Python can't find its
//! standard library, and login shells print library errors.

use std::ffi::OsString;
use std::sync::OnceLock;

/// Set by the AppImage runtime for the program inside it, and by nothing else.
const BOOKKEEPING: &[&str] = &["APPDIR", "APPIMAGE", "ARGV0", "OWD"];

/// What to change in the environment of every program Whisk starts: a variable with the
/// AppImage's parts taken out, or `None` to remove it. Empty outside an AppImage.
pub fn changes() -> &'static [(String, Option<String>)] {
    static CHANGES: OnceLock<Vec<(String, Option<String>)>> = OnceLock::new();
    CHANGES.get_or_init(|| match std::env::var("APPDIR") {
        Ok(appdir) => changes_for(&appdir, std::env::vars_os().filter_map(|(k, v)| Some((k.into_string().ok()?, v.into_string().ok()?)))),
        Err(_) => Vec::new(),
    })
}

fn changes_for(appdir: &str, vars: impl Iterator<Item = (String, String)>) -> Vec<(String, Option<String>)> {
    let appdir = appdir.trim_end_matches('/');
    vars.filter_map(|(key, value)| {
        if BOOKKEEPING.contains(&key.as_str()) || is_forced_theme(&key, &value) {
            return Some((key, None));
        }
        if !value.contains(appdir) {
            return None;
        }
        let kept: Vec<&str> = value.split(':').filter(|p| !p.is_empty() && !p.starts_with(appdir)).collect();
        Some((key, (!kept.is_empty()).then(|| kept.join(":"))))
    })
    .collect()
}

/// The AppImage's GTK hook sets GTK_THEME to Adwaita whatever was there before, so there's
/// nothing to put back; left in, it would force Adwaita on any GTK app Whisk opens.
fn is_forced_theme(key: &str, value: &str) -> bool {
    key == "GTK_THEME" && value.starts_with("Adwaita:")
}

/// The user's own PATH, for finding programs.
pub fn user_path() -> Option<OsString> {
    match changes().iter().find(|(key, _)| key == "PATH") {
        Some((_, value)) => value.as_ref().map(OsString::from),
        None => std::env::var_os("PATH"),
    }
}

#[cfg(test)]
mod tests {
    use super::changes_for;

    #[test]
    fn takes_the_appimage_out_and_leaves_the_rest() {
        let appdir = "/tmp/.mount_WhiskAb12";
        let vars = [
            ("PATH", "/tmp/.mount_WhiskAb12/usr/bin/:/tmp/.mount_WhiskAb12/bin/:/home/me/.local/bin:/usr/bin"),
            ("LD_LIBRARY_PATH", "/tmp/.mount_WhiskAb12/usr/lib/:/tmp/.mount_WhiskAb12/lib/"),
            ("PYTHONHOME", "/tmp/.mount_WhiskAb12/usr/"),
            ("PYTHONPATH", "/tmp/.mount_WhiskAb12/usr/share/pyshared/:"),
            ("XDG_DATA_DIRS", "/tmp/.mount_WhiskAb12/usr/share:/usr/share:/usr/local/share"),
            ("GDK_PIXBUF_MODULE_FILE", "/tmp/.mount_WhiskAb12//usr/lib/gdk-pixbuf-2.0/2.10.0/loaders.cache"),
            ("GTK_THEME", "Adwaita:dark"),
            ("APPIMAGE", "/home/me/Applications/Whisk.AppImage"),
            ("OWD", "/home/me"),
            ("HOME", "/home/me"),
            ("PYTHONDONTWRITEBYTECODE", "1"),
        ];
        let mut changes = changes_for(appdir, vars.iter().map(|(k, v)| (k.to_string(), v.to_string())));
        changes.sort();
        let expected: Vec<(String, Option<String>)> = vec![
            ("APPIMAGE", None),
            ("GDK_PIXBUF_MODULE_FILE", None),
            ("GTK_THEME", None),
            ("LD_LIBRARY_PATH", None),
            ("OWD", None),
            ("PATH", Some("/home/me/.local/bin:/usr/bin")),
            ("PYTHONHOME", None),
            ("PYTHONPATH", None),
            ("XDG_DATA_DIRS", Some("/usr/share:/usr/local/share")),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.map(str::to_string)))
        .collect();
        assert_eq!(changes, expected);
    }

    #[test]
    fn changes_nothing_else() {
        let vars = [("PATH", "/usr/bin"), ("GTK_THEME", "Breeze")];
        assert!(changes_for("/tmp/.mount_X", vars.iter().map(|(k, v)| (k.to_string(), v.to_string()))).is_empty());
    }
}
