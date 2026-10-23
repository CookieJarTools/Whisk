import ReactDOM from 'react-dom/client'
import '@fontsource-variable/jetbrains-mono'
import '@xterm/xterm/css/xterm.css'
import './theme/tokens.css'
import './theme/global.css'
import './theme/app.css'
import './theme/panels.css'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { installErrorLogging } from './lib/log'

installErrorLogging()

// No StrictMode: its double-mounted effects would open every editor (and its
// language-server session) twice in development.
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <ErrorBoundary scope="app" title="Whisk hit a problem" actions={<button className="btn" onClick={() => location.reload()}>Reload Whisk</button>}>
    <App />
  </ErrorBoundary>
)
