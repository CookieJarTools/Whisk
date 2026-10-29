# Contributing

## Running it

You'll need [Node.js](https://nodejs.org) and [Rust](https://rustup.rs). On Linux you also need WebKitGTK and a few other libraries: see [Tauri's list](https://v2.tauri.app/start/prerequisites/#linux) for your distribution.

```bash
git clone https://github.com/CookieJarTools/Whisk.git
cd Whisk
npm install
npm run tauri dev
```

To open a folder and files on launch:

```bash
npm run tauri dev -- -- -- <folder> [file…]
```

- `npm test` runs the unit tests.
- `npm run typecheck` checks the TypeScript.
- `cargo test --manifest-path src-tauri/Cargo.toml` runs the Rust tests.
- `npm run tauri build` makes an installer in `src-tauri/target/release/bundle/nsis` on Windows, and an AppImage, a .deb and an .rpm under `src-tauri/target/release/bundle` on Linux.
- `npx vite`, then open http://localhost:1420/preview.html, runs the interface in a browser with a stand-in backend and a sample project ([src/dev/preview.ts](src/dev/preview.ts)). Handy for checking layout without building the app.

## Where things are

| Folder | What's in it |
|---|---|
| `src-tauri/src` | The Rust side: files (`fs.rs`), project search (`search.rs`), language server and debug adapter processes (`lsp.rs`), terminals (`pty.rs`), git (`git.rs`), shell and paths (`system.rs`), updates (`updates.rs`) |
| `src/editor` | CodeMirror setup, the block scanner (`scopes.ts`), scope rails, the find bar, the action row above methods |
| `src/lsp` | Talking to language servers, the list of known servers (`catalogue.ts`), applying their edits, and Alt+Enter code actions |
| `src/git` | Reading `git` output (`git.ts`), the repository store, gutter change markers and blame |
| `src/terminal` | Terminal sessions (xterm.js on top of `pty.rs`) |
| `src/run` | Run configurations: finding them, `.whisk/run.json`, running them |
| `src/tests` | The test runner and the report parsers (TRX, JUnit, Jest, cargo, go), with real reports in `fixtures` |
| `src/debug` | The Debug Adapter Protocol client, adapters, breakpoints and the debug session |
| `src/unity` | Spotting Unity projects, installing the Unity package, finding the editor to debug |
| `unity/com.cookiejar.ide.whisk` | The Unity package Whisk installs into projects (C#, Cookie Jar house style) |
| `scripts/build-unity-debugger.mjs` | Builds the bundled Unity debug adapter from a pinned commit; runs before every build (needs git and the .NET SDK, which local Linux builds can do without) |
| `src/lint` | Whisk's lint rules (`rules.ts`), their config and the project `.whisk/lint.json`, and merging with language-server errors |
| `src/keymap` | Actions, keymap presets and the shortcut handler |
| `src/plugins` | The plugin API and host, and the Claude plugin |
| `src/updates` | Checking for, downloading and installing updates |
| `src/wizard` | New Project templates |
| `src/components` | The interface |
| `src/theme` | Colours and styles, shared with CrumbTree |
| `assets/banner.html` | The README banner; `node scripts/render-banner.mjs` renders it to `banner.png` (needs Firefox) |
| `docs` | User guides too long for the README: the linter's checks and writing plugins |

## Releasing

```bash
npm run release -- 0.2.0
```

This sets the version in `package.json`, `tauri.conf.json` and `Cargo.toml`, commits, tags `v0.2.0` and pushes. GitHub Actions then builds the Windows installer and the Linux AppImage, .deb and .rpm, one after the other, onto a draft release, and publishes it once both are there. Installed copies pick it up from there.

To try a change to the build without releasing, run the Release workflow by hand from the Actions tab. It builds both platforms and keeps the installers as the run's artifacts.

The Linux build settings that differ from Windows are in `src-tauri/tauri.linux.conf.json`, which Tauri merges over `tauri.conf.json` on Linux.

Add a suffix to make a pre-release, for example `0.3.0-beta.1`. Only people who turn on pre-releases get those.

Updates are signed with the key in the `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` repository secrets. The maintainer keeps a copy of the key. If it's lost, installed copies can't accept new updates and everyone has to reinstall by hand.
