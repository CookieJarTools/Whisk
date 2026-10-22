# Whisk

A small, fast code editor built with Tauri + CodeMirror 6, styled with the CookieJar design tokens (shared with CrumbTree). All text is monospace.

## Install

Download `Whisk_<version>_x64-setup.exe` from the [latest release](https://github.com/CookieJarTools/Whisk/releases/latest) and run it. It installs for your user only, so no admin prompt.

Whisk keeps itself up to date: Settings › Updates checks for new versions, downloads them in the background if automatic updates are on, and lets you switch to any released version, older ones included. Updates are signed, and Whisk refuses any that don't match its key.

## Features

- **Scope rails.** Every multi-line `{ … }` block gets a lane down its left edge, drawn like CrumbTree's commit graph. The block holding the cursor is lit, the blocks around it are half-lit, and the rest fade back.
- **Suggestions and navigation** come from language servers (LSP): completion, hover docs, signature help, errors, F12 / Ctrl+Click to go to definition, Shift+F12 to find usages, F2 to rename.
  Without a language server, F12 still works for declarations in the open file and for types anywhere in the project.
- **Breadcrumbs** show the file path plus the namespace › class › method the cursor is in, each in its scope-rail colour.
- **Search, Rider-style.** Double Shift opens Search Everywhere with tabs for All, Types, Files, Symbols, Actions and Text (project-wide text search with a live preview). Also: Find / Replace in file (Ctrl+F / Ctrl+R), File structure (Ctrl+F12), Go to line (Ctrl+G), Recent files (Ctrl+E), and Back / Forward after jumps.
- **Rebindable shortcuts** in Settings › Keymap, with Whisk, Rider, VS Code and Visual Studio presets. Search by action or by pressing a shortcut; clashes are flagged.
- **New Project wizard** (folder menu, or Find action › New project) for .NET, React + Vite, Node + TypeScript, Rust, Python, Go or an empty folder. It runs the real tools and opens the result.
- **Zen-style layout**: auto-hide the title bar and explorer (Ctrl+Alt+C / Ctrl+Alt+T / Ctrl+Alt+S in the Whisk keymap).
- **Markdown** editing with live preview (Edit / Split / Preview).
- **Plugins**, including a built-in Claude plugin (below).

## Language servers

Whisk starts a server the first time you open a file it serves, using the open folder as the project root. Settings › Language servers lists about 20 servers (C#, TypeScript, Rust, Python, Go, C/C++, Lua, Bash, YAML, JSON, CSS, HTML, TOML, PHP, Ruby, Svelte, Dockerfile, Dart, Java, Kotlin, Zig, Markdown). Most install with one click; Whisk tells you if the installer needs something first (Node.js, .NET, Go…). You can add any other LSP server there too, with links to the official server list.

For C#, open the folder that holds the `.sln` file. The status bar shows the server's state; click it when a server is missing to go straight to its install button.

## Claude plugin

Above each method and class there's a quiet row of actions:

- **✦ Ask Claude** sends that method/class to Claude, ready for your question.
- **+ context** sends it along with an outline of the containing type (its fields and member signatures) and the project types it uses.

The same actions are on the right-click menu. Where they go is set in Settings › Claude, or from Find action (Ctrl+Shift+A):

- `Claude: Send to the Claude desktop app` (default): copies the prompt and opens the Claude app with it prefilled. If the app doesn't prefill it, paste it.
- `Claude: Send to Claude Code in a terminal`: opens Claude Code in the project folder. This needs the `claude` command on PATH.

## Writing a plugin

User plugins live in `%USERPROFILE%\.whisk\plugins\<name>\plugin.js`. Click the plugin count in the status bar to open that folder. A plugin is an ES module whose default export has `id`, `name` and `activate(ctx)`:

```js
export default {
  id: 'todo-copier',
  name: 'Copy as TODO',
  activate(ctx) {
    // Shows up in the row above methods and in the right-click menu.
    ctx.registerSymbolAction({
      id: 'copy-todo',
      label: 'Copy as TODO',
      kinds: ['method', 'function'],
      run: async (symbol, ide) => {
        await ide.ui.copy(`TODO: ${symbol.name} (${symbol.relativePath}:${symbol.startLine})`)
        ide.ui.toast('Copied', 'success')
      }
    })
    // Shows up in Find action (Ctrl+Shift+A); `keys` is its default shortcut, rebindable in Settings › Keymap.
    ctx.registerCommand({
      id: 'hello',
      title: 'Todo: Say hello',
      keys: ['Ctrl+Alt+H'],
      run: (ide) => ide.ui.toast(`Open folder: ${ide.workspace.root()}`)
    })
  }
}
```

The full API is typed in [src/plugins/api.ts](src/plugins/api.ts). Plugins load at startup; restart Whisk after adding one.

## Development

```bash
npm install
npm run tauri dev
```

`npm run tauri dev -- -- -- <folder> [file…]` opens a folder and files on launch, as does `whisk.exe <folder> [file…]` once installed.

- `npm test`: unit tests
- `npm run typecheck`
- `npm run tauri build`: local release build and installer (set `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` to sign the update files)

## Releasing

```bash
npm run release -- 0.2.0
```

This bumps the version in `package.json`, `tauri.conf.json` and `Cargo.toml`, commits, tags `v0.2.0` and pushes. The Release workflow then builds the signed installer and publishes the GitHub release that installed copies update from. A tag with a suffix (`0.3.0-beta.1`) becomes a pre-release, offered only to people who turn on pre-releases.

The update signing key lives in `~/.tauri/whisk.key` (password in `~/.tauri/whisk.key.password`) and in the repo's `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secrets. Back the key up: without it, installed copies can't accept new updates.

## Layout

- `src-tauri/src`: Rust backend. File access (`fs.rs`), language-server processes (`lsp.rs`), terminal/URL launching (`system.rs`)
- `src/editor`: CodeMirror setup, the brace scanner and symbol finder (`scopes.ts`), the rails (`scopeRails.ts`), code lens (`codeLens.ts`)
- `src/lsp`: LSP transport over Tauri events, workspace, server table
- `src/plugins`: plugin API, host, context gathering, and the Claude plugin
- `src/keymap`: actions, keymap presets and the shortcut dispatcher
- `src/updates`: update checks, downloads and installs (with `src-tauri/src/updates.rs`)
- `src/wizard`: New Project templates
- `src/components`: React UI
