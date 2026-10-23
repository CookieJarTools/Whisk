import { registerPanelView, TerminalTabs } from './BottomPanel'
import { TestsView } from './TestsView'
import { DebugView } from './DebugView'

// The bottom panel's Run, Tests and Debug views (the terminal view is built in).
registerPanelView({
  id: 'run',
  label: 'Run',
  render: () => <TerminalTabs kind="run" empty={<>Nothing has run yet. Pick a configuration at the top and press ▶.</>} />
})
registerPanelView({ id: 'tests', label: 'Tests', render: () => <TestsView /> })
registerPanelView({ id: 'debug', label: 'Debug', render: () => <DebugView /> })
