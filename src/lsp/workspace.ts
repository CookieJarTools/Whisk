import { Workspace, LSPPlugin, type WorkspaceFile } from '@codemirror/lsp-client'
import type { Text } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { normalizeUri, uriToPath } from '../lib/paths'
import { useStore } from '../store/store'
import { whenView } from '../editor/views'

/** Not exported by the package, so derived from the abstract method. */
type WorkspaceFileUpdate = ReturnType<Workspace['syncFiles']>[number]

class IdeFile implements WorkspaceFile {
  constructor(
    readonly uri: string,
    readonly languageId: string,
    public version: number,
    public doc: Text,
    public view: EditorView
  ) {}

  getView() {
    return this.view
  }
}

/**
 * One file per tab, like the default workspace, but URIs are compared loosely
 * (servers disagree on drive-letter case) and jumps to other files open a tab.
 */
export class IdeWorkspace extends Workspace {
  files: IdeFile[] = []
  private versions: Record<string, number> = {}

  private nextVersion(uri: string) {
    const k = normalizeUri(uri)
    return (this.versions[k] = (this.versions[k] ?? -1) + 1)
  }

  getFile(uri: string): WorkspaceFile | null {
    const k = normalizeUri(uri)
    return this.files.find((f) => normalizeUri(f.uri) === k) ?? null
  }

  syncFiles(): readonly WorkspaceFileUpdate[] {
    const result: WorkspaceFileUpdate[] = []
    for (const file of this.files) {
      const plugin = LSPPlugin.get(file.view)
      if (!plugin || plugin.unsyncedChanges.empty) continue
      result.push({ changes: plugin.unsyncedChanges, file, prevDoc: file.doc })
      file.doc = file.view.state.doc
      file.version = this.nextVersion(file.uri)
      plugin.clear()
    }
    return result
  }

  openFile(uri: string, languageId: string, view: EditorView) {
    const existing = this.getFile(uri) as IdeFile | null
    if (existing) {
      existing.view = view
      return
    }
    const file = new IdeFile(uri, languageId, this.nextVersion(uri), view.state.doc, view)
    this.files.push(file)
    this.client.didOpen(file)
  }

  closeFile(uri: string, view: EditorView) {
    const file = this.getFile(uri) as IdeFile | null
    if (!file || file.view !== view) return
    this.files = this.files.filter((f) => f !== file)
    this.client.didClose(file.uri)
  }

  async displayFile(uri: string): Promise<EditorView | null> {
    const path = uriToPath(uri)
    const opened = await useStore.getState().openFile(path)
    return opened ? whenView(path) : null
  }
}
