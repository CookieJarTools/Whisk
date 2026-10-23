import { listen } from '@tauri-apps/api/event'
import { ipc } from '../lib/ipc'

/**
 * A Debug Adapter Protocol client. Adapters speak DAP over stdio with the
 * same Content-Length framing as language servers, so the language-server
 * process plumbing in Rust (lsp_start / lsp_send) carries it unchanged.
 */

export interface DapMessage {
  seq: number
  type: 'request' | 'response' | 'event'
  command?: string
  event?: string
  request_seq?: number
  success?: boolean
  message?: string
  body?: any
  arguments?: any
}

type EventHandler = (event: string, body: any) => void
type ReverseHandler = (command: string, args: any) => Promise<unknown>

export class DapError extends Error {}

export class DapClient {
  private seq = 1
  private pending = new Map<number, { resolve: (body: any) => void; reject: (e: Error) => void; command: string }>()
  private stops: (() => void)[] = []
  private closed = false
  onEvent: EventHandler = () => {}
  onReverseRequest: ReverseHandler = async () => ({})
  onExit: () => void = () => {}

  private constructor(private readonly id: number) {}

  /** Starts an adapter process and connects to it. */
  static async start(command: string, args: string[], cwd: string): Promise<DapClient> {
    const id = await ipc.lspStart(command, args, cwd)
    const client = new DapClient(id)
    client.stops.push(
      await listen<{ id: number; message: string }>('lsp-message', (e) => {
        if (e.payload.id === id) client.receive(JSON.parse(e.payload.message) as DapMessage)
      }),
      await listen<{ id: number }>('lsp-exit', (e) => {
        if (e.payload.id === id) client.dispose()
      })
    )
    return client
  }

  private receive(msg: DapMessage) {
    if (msg.type === 'response') {
      const waiting = this.pending.get(msg.request_seq!)
      if (!waiting) return
      this.pending.delete(msg.request_seq!)
      if (msg.success) waiting.resolve(msg.body ?? {})
      else waiting.reject(new DapError(msg.message || msg.body?.error?.format || `${waiting.command} failed`))
    } else if (msg.type === 'event') {
      this.onEvent(msg.event!, msg.body ?? {})
    } else if (msg.type === 'request') {
      // Adapters ask the client for things too (runInTerminal, startDebugging).
      this.onReverseRequest(msg.command!, msg.arguments ?? {}).then(
        (body) => this.write({ seq: this.seq++, type: 'response', request_seq: msg.seq, command: msg.command, success: true, body }),
        (e) => this.write({ seq: this.seq++, type: 'response', request_seq: msg.seq, command: msg.command, success: false, message: String(e) })
      )
    }
  }

  private write(msg: DapMessage) {
    if (!this.closed) void ipc.lspSend(this.id, JSON.stringify(msg)).catch(() => {})
  }

  request<T = any>(command: string, args?: unknown): Promise<T> {
    if (this.closed) return Promise.reject(new DapError('The debugger has stopped'))
    const seq = this.seq++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(seq, { resolve, reject, command })
      this.write({ seq, type: 'request', command, arguments: args })
    })
  }

  get isClosed() {
    return this.closed
  }

  /** Stops listening and kills the adapter. */
  dispose() {
    if (this.closed) return
    this.closed = true
    this.stops.forEach((stop) => stop())
    for (const waiting of this.pending.values()) waiting.reject(new DapError('The debugger has stopped'))
    this.pending.clear()
    void ipc.lspStop(this.id).catch(() => {})
    this.onExit()
  }
}
