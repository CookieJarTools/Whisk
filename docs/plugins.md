# Plugins

Plugins can add links above methods and classes, entries in the right-click menu, and commands with their own shortcuts.

To add one, put a `plugin.js` file in its own folder in Whisk's plugins folder:

- Linux: `~/.whisk/plugins/my-plugin/plugin.js`
- Windows: `%USERPROFILE%\.whisk\plugins\my-plugin\plugin.js`

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

Plugins can read files, find where types are declared, get the code around the cursor, show messages, copy to the clipboard, open links, run commands in a terminal and save their own settings. The full list is in [src/plugins/api.ts](../src/plugins/api.ts).
