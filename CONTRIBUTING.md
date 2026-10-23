# Contributing

## Running it

```bash
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
- `npx vite`, then open http://localhost:1420/preview.html, runs the interface in a browser with a stand-in backend and a sample project ([src/dev/preview.ts](src/dev/preview.ts)). Handy for checking layout without building the app.

## Where things are

| Folder | What's in it |
|---|---|
| `src-tauri/src` | The Rust side: files (`fs.rs`), project search (`search.rs`), language server processes (`lsp.rs`), shell and paths (`system.rs`), updates (`updates.rs`) |
| `src/editor` | CodeMirror setup, the block scanner (`scopes.ts`), scope rails, the find bar, the action row above methods |
| `src/lsp` | Talking to language servers, and the list of known servers (`catalogue.ts`) |
| `src/lint` | Whisk's lint rules (`rules.ts`), their config and the project `.whisk/lint.json`, and merging with language-server errors |
| `src/keymap` | Actions, keymap presets and the shortcut handler |
| `src/plugins` | The plugin API and host, and the Claude plugin |
| `src/updates` | Checking for, downloading and installing updates |
| `src/wizard` | New Project templates |
| `src/components` | The interface |
| `src/theme` | Colours and styles, shared with CrumbTree |

## Releasing

```bash
npm run release -- 0.2.0
```

This sets the version in `package.json`, `tauri.conf.json` and `Cargo.toml`, commits, tags `v0.2.0` and pushes. GitHub Actions then builds the installer and publishes the release. Installed copies pick it up from there.

Add a suffix to make a pre-release, for example `0.3.0-beta.1`. Only people who turn on pre-releases get those.

Updates are signed with the key in the `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` repository secrets. The maintainer keeps a copy of the key. If it's lost, installed copies can't accept new updates and everyone has to reinstall by hand.
