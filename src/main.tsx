import ReactDOM from 'react-dom/client'
import '@fontsource-variable/jetbrains-mono'
import './theme/tokens.css'
import './theme/global.css'
import './theme/app.css'
import './theme/panels.css'
import App from './App'

// No StrictMode: its double-mounted effects would open every editor (and its
// language-server session) twice in development.
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<App />)
