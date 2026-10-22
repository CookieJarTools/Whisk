# Whisk

Whisk is a small, fast code editor for Windows. It has the parts of a big IDE you actually use every day (suggestions, go to definition, project search, find usages) without the weight. Everything is monospace, the interface stays out of the way, and Claude is one click away from any method or class.

## Install

1. Go to the [latest release](https://github.com/CookieJarTools/Whisk/releases/latest).
2. Download `Whisk_x.y.z_x64-setup.exe`.
3. Run it. It installs just for you, so it won't ask for admin rights.

Whisk updates itself. You can change how in **Settings › Updates** (see [Updates](#updates)).

## What it does

**Scope rails.** Every block of code gets a coloured line down its left side, so you can see where it starts and ends. The block your cursor is in lights up, and the ones around it fade back.

**Suggestions and navigation.** Code completion, hover docs, errors, go to definition, find usages and rename all come from language servers. Whisk installs them for you (see [Language servers](#language-servers)).

**Search like Rider.** Tap Shift twice to search everything: types, files, methods, actions and text across the whole project. Results update as you type, and text matches show a preview.

**Your shortcuts.** Pick the Whisk, Rider, VS Code or Visual Studio keymap, then change any shortcut you like. Whisk warns you if a key is already taken.

**New projects.** Start a C# app, React + Vite site, Node + TypeScript tool, Rust crate, Python project or Go module from **New project…** in the folder menu. Whisk runs the usual tools (`dotnet new`, `cargo new`…) and opens the result.

**Breadcrumbs.** The bar above the editor shows the file and the namespace › class › method you're in, in the same colours as the scope rails.

**Markdown.** Edit with a live preview beside it, or on its own.

**Compact layout.** Hide the title bar and the file explorer until you move the mouse to the edge of the window, like Zen browser.

**Claude built in.** Send a method or class to Claude with one click (see [Claude](#claude)).

## Shortcuts

These are the defaults in the Whisk keymap. Change any of them in **Settings › Keymap**.

| Shortcut | Does |
|---|---|
| Shift Shift | Search everywhere |
| Ctrl+Shift+F | Find in files |
| Ctrl+P | Go to file |
| Ctrl+N | Go to type |
| Ctrl+F12 | File structure |
| Ctrl+F / Ctrl+R | Find / replace in this file |
| F12 or Ctrl+Click | Go to definition |
| Shift+F12 | Find usages |
| F2 | Rename |
| Ctrl+Alt+Left / Right | Back / forward |
| Ctrl+E | Recent files |
| Ctrl+G | Go to line |
| Ctrl+Shift+A | Find any action |
| Ctrl+, | Settings |
| Ctrl+Alt+C | Compact mode |
| Ctrl+Alt+S | Show / hide the explorer |
| Ctrl+Alt+A | Ask Claude about the code at the cursor |

## Language servers

Language servers give Whisk its suggestions, errors and navigation for each language. A server starts the first time you open a file it handles.

Open **Settings › Language servers** to see the list and install them. Most install with one click. If a server needs something first, like Node.js or the .NET SDK, Whisk tells you and links to it.

Built in: C#, TypeScript and JavaScript, Rust, Python, Go, C and C++, Lua, Bash, YAML, JSON, CSS, HTML, TOML, PHP, Ruby, Svelte, Dockerfile, Dart, Java, Kotlin, Zig and Markdown.

Language not listed? Click **Add your own** and enter the server's command and the file types it handles. Any server that speaks LSP works. The [official list of language servers](https://microsoft.github.io/language-server-protocol/implementors/servers/) is a good place to find one.

For C#, open the folder that contains your `.sln` file.

Without a language server, F12 still jumps to declarations in the open file and to types anywhere in the project.

## Claude

Above each method and class there's a small row of links:

- **✦ Ask Claude** sends that code to Claude, ready for your question.
- **+ context** also sends the rest of the class it lives in and the project types it uses, so Claude has the full picture.

You'll find the same options when you right-click in the editor.

By default this opens the Claude desktop app with your code filled in. To use Claude Code in a terminal instead, change it in **Settings › Claude**.

## Plugins

Plugins can add buttons above methods and classes, entries in the right-click menu, and commands with their own shortcuts.

To add one, put a `plugin.js` file in its own folder here:

```
%USERPROFILE%\.whisk\plugins\my-plugin\plugin.js
```

Click the plugin count in the status bar to open that folder. Restart Whisk after adding a plugin.

A plugin looks like this:

```js
export default {
  id: 'todo-copier',
  name: 'Copy as TODO',
  activate(ctx) {
    // A link above every method, and an entry in the right-click menu
    ctx.registerSymbolAction({
      id: 'copy-todo',
      label: 'Copy as TODO',
      kinds: ['method', 'function'],
      run: async (symbol, ide) => {
        await ide.ui.copy(`TODO: ${symbol.name} (${symbol.relativePath}:${symbol.startLine})`)
        ide.ui.toast('Copied', 'success')
      }
    })

    // A command in Find action (Ctrl+Shift+A), with a default shortcut
    ctx.registerCommand({
      id: 'hello',
      title: 'Todo: Say hello',
      keys: ['Ctrl+Alt+H'],
      run: (ide) => ide.ui.toast(`Open folder: ${ide.workspace.root()}`)
    })
  }
}
```

Plugins can read files, find where types are declared, get the code around the cursor, show messages, copy to the clipboard, open links, run commands in a terminal and save their own settings. The full list is in [src/plugins/api.ts](src/plugins/api.ts).

## Updates

Whisk checks for new versions every few hours and downloads them in the background. When one is ready, a **Restart to update** button appears in the status bar. Nothing restarts without you.

In **Settings › Updates** you can:

- check for an update now
- turn automatic updates off
- opt in to pre-release versions
- install any earlier version if a new one gives you trouble

Updates are signed, and Whisk won't install one that doesn't match.

## Building from source

You'll need [Node.js](https://nodejs.org) and [Rust](https://rustup.rs).

```bash
git clone https://github.com/CookieJarTools/Whisk.git
cd Whisk
npm install
npm run tauri dev
```

`npm test` runs the tests. `npm run tauri build` makes an installer in `src-tauri/target/release/bundle/nsis`.

See [CONTRIBUTING.md](CONTRIBUTING.md) for how the code is laid out and how releases work.

## License

[PolyForm Shield 1.0.0](LICENSE.md). Use Whisk for anything you like; just don't use it to build a competing editor.
