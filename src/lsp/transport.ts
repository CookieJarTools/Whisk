import { listen } from '@tauri-apps/api/event'
import type { Transport } from '@codemirror/lsp-client'
import { ipc } from '../lib/ipc'

export interface TauriTransport extends Transport {
  dispose(): void
}

/**
 * Server → client requests the CodeMirror client doesn't implement. Answering
 * them here keeps servers like csharp-ls from erroring during start-up.
 */
function answerServerRequest(method: string, params: any, rootUri: string): { result: unknown } | null {
  switch (method) {
    case 'workspace/configuration':
      return { result: (params?.items ?? []).map(() => null) }
    case 'workspace/workspaceFolders':
      return { result: [{ uri: rootUri, name: rootUri.split('/').pop() }] }
    case 'client/registerCapability':
    case 'client/unregisterCapability':
    case 'window/workDoneProgress/create':
      return { result: null }
    default:
      return null
  }
}

export async function tauriTransport(id: number, rootUri: string, onExit: () => void): Promise<TauriTransport> {
  const handlers = new Set<(message: string) => void>()
  const send = (message: string) => {
    ipc.lspSend(id, message).catch((e) => console.warn('[lsp] send failed:', e))
  }

  const stopMessages = await listen<{ id: number; message: string }>('lsp-message', (event) => {
    if (event.payload.id !== id) return
    const raw = event.payload.message
    const msg = JSON.parse(raw)
    if ('id' in msg && 'method' in msg) {
      const answer = answerServerRequest(msg.method, msg.params, rootUri)
      if (answer) {
        send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...answer }))
        return
      }
    }
    handlers.forEach((h) => h(raw))
  })
  const stopExit = await listen<{ id: number }>('lsp-exit', (event) => {
    if (event.payload.id === id) onExit()
  })

  return {
    send,
    subscribe: (h) => handlers.add(h),
    unsubscribe: (h) => handlers.delete(h),
    dispose() {
      stopMessages()
      stopExit()
    }
  }
}
