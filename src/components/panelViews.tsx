import { registerPanelView, TerminalTabs } from './BottomPanel'
import { TestsView } from './TestsView'

// The bottom panel's Run and Tests views (the terminal view is built in).
registerPanelView({
  id: 'run',
  label: 'Run',
  render: () => <TerminalTabs kind="run" empty={<>Nothing has run yet. Pick a configuration at the top and press ▶.</>} />
})
registerPanelView({ id: 'tests', label: 'Tests', render: () => <TestsView /> })
