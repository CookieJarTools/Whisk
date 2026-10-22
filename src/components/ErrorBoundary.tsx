import { Component, type ReactNode } from 'react'
import { logError } from '../lib/log'

interface Props {
  /** Where this boundary sits, for the log: `app`, or `editor` for one tab. */
  scope: string
  /** Shown above the error, e.g. the file that failed to open. */
  title: string
  children: ReactNode
  /** Extra buttons beside Try again, e.g. Close this file. */
  actions?: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Keeps one failure from blanking the window: whatever is inside shows the
 * error and a way out instead, and the error goes to the log.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    logError(`${this.props.scope}: ${this.props.title}`, error, info.componentStack ?? undefined)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="crash">
        <div className="crash-inner">
          <div className="crash-title">{this.props.title}</div>
          <p className="crash-message">{error.message || String(error)}</p>
          <div className="crash-actions">
            <button className="btn btn-primary" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
            {this.props.actions}
          </div>
          {error.stack && (
            <details className="crash-details">
              <summary>Details</summary>
              <pre>{error.stack}</pre>
            </details>
          )}
          <p className="crash-note">This was saved to ~/.whisk/logs/whisk.log. Please include it if you report the problem.</p>
        </div>
      </div>
    )
  }
}
