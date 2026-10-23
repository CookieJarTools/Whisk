/**
 * Development only: runs Whisk in a plain browser (http://localhost:1420/preview.html)
 * with a stand-in backend and a small sample project, so the interface can be
 * checked without the desktop app. Not part of the built app.
 */
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks'

const SEP = '\\'
const ROOT = `C:${SEP}Sample`
const at = (name: string) => ROOT + SEP + name

const files: Record<string, string> = {
  [at('Player.cs')]: [
    'using System;',
    'using UnityEngine;',
    '',
    'namespace Sample',
    '{',
    '    public class Player : MonoBehaviour',
    '    {',
    '        [SerializeField] private float speed = 4f;',
    '        private int health = 100;',
    '',
    '        private void Update()',
    '        {',
    '            var input = new Vector3(Input.GetAxis("Horizontal"), 0, Input.GetAxis("Vertical"));',
    '            transform.position += input * speed * Time.deltaTime;',
    '            if (health <= 0)',
    '            {',
    '                Die();',
    '            }',
    '        }',
    '',
    ...Array.from({ length: 30 }, (_, i) => `        // filler line ${i + 1}`),
    '',
    '        public void TakeDamage(int amount)',
    '        {',
    '            health -= amount;',
    '            Debug.Log($"Took {amount}");',
    '        }',
    '',
    '        private void Die()',
    '        {',
    '            Destroy(gameObject);',
    '        }',
    '    }',
    '}',
    ''
  ].join('\n'),
  [at('README.md')]: '# Sample\n\nA sample project for the preview.\n',
  [at('tools.py')]: 'def main():\n    for i in range(3):\n        print(i)\n\n\nif __name__ == "__main__":\n    main()\n'
}

function listDir(path: string) {
  const prefix = path.endsWith(SEP) ? path : path + SEP
  return Object.keys(files)
    .filter((f) => f.startsWith(prefix) && !f.slice(prefix.length).includes(SEP))
    .map((f) => ({ name: f.slice(prefix.length), path: f, is_dir: false }))
}

const handlers: Record<string, (args: any) => unknown> = {
  list_dir: (a) => listDir(a.path),
  read_text: (a) => files[a.path] ?? '',
  write_text: (a) => void (files[a.path] = a.content),
  path_state: (a) => (files[a.path] !== undefined || a.path === ROOT ? 'used' : 'missing'),
  list_files: () => Object.keys(files),
  find_type_definitions: () => [],
  search_project: () => ({ matches: [], truncated: false }),
  index_symbols: () => [],
  which_program: () => null,
  plugins_dir: () => 'C:/Users/preview/.whisk/plugins',
  startup_args: () => ({ folder: null, files: [] }),
  paste_text: () =>
    files[at('Player.cs')].replace('speed = 4f', 'speed = 6f').replace('health -= amount;', 'health = Math.Max(0, health - amount);'),
  list_releases: () => [],
  check_update: () => null
}

// A pretend repository: Player.cs has changes since the last commit, tools.py is new.
const committedPlayer = files[at('Player.cs')]
  .replace('speed = 4f', 'speed = 3f')
  .replace('            Debug.Log($"Took {amount}");\n', '')
  .replace('        private int health = 100;\n', '        private int health = 100;\n        private int armour;\n')
const H = 'f7a5e68b1da339f36ec3ad2449aa288ca0336dd1'
handlers.git = ({ args }: { args: string[] }) => {
  const ok = (stdout: string) => ({ code: 0, stdout, stderr: '' })
  switch (args[0]) {
    case 'rev-parse':
      return ok('C:/Sample\n')
    case 'status':
      return ok(
        [
          `# branch.oid ${H}`,
          '# branch.head main',
          '# branch.upstream origin/main',
          '# branch.ab +1 -0',
          `1 .M N... 100644 100644 100644 ${H} ${H} Player.cs`,
          '? tools.py',
          ''
        ].join('\0')
      )
    case 'show':
      return args[1] === 'HEAD:Player.cs' ? ok(committedPlayer) : { code: 128, stdout: '', stderr: 'fatal: path not in HEAD' }
    case 'branch':
      return ok('*main\n feature/inventory\n')
    case 'blame': {
      const lines = files[at('Player.cs')].split('\n')
      return ok(
        lines
          .map((text, i) => {
            const old = i % 7 < 4
            const hash = old ? H : 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
            return [
              `${hash} ${i + 1} ${i + 1} 1`,
              `author ${old ? 'Joseph Cook' : 'Sam Lee'}`,
              `author-time ${old ? 1760000000 : 1790000000}`,
              `summary ${old ? 'First pass at the player' : 'Tune movement'}`,
              `\t${text}`
            ].join('\n')
          })
          .join('\n')
      )
    }
    default:
      return ok('')
  }
}

// A pretend shell: echoes what's typed and answers each line with a prompt.
let nextPty = 1
const prompt = `\x1b[32mPS\x1b[0m ${ROOT}> `
const ptyEmit = (id: number, data: string) => void import('@tauri-apps/api/event').then(({ emit }) => emit('pty-output', { id, data }))
handlers.pty_spawn = (a: { program: string | null; args: string[] }) => {
  const id = nextPty++
  const banner = a.program ? `\x1b[90m> ${a.program} ${a.args.join(' ')}\x1b[0m\r\n` : `PowerShell 7.5.0 (preview stand-in)\r\n\r\n${prompt}`
  setTimeout(() => ptyEmit(id, banner), 50)
  return id
}
handlers.pty_write = (a: { id: number; data: string }) => ptyEmit(a.id, a.data === '\r' ? `\r\n${prompt}` : a.data)

/** Lets later features add their own stand-in commands. */
export function mockCommand(name: string, handler: (args: any) => unknown) {
  handlers[name] = handler
}

mockIPC((cmd, args) => (handlers[cmd] ? handlers[cmd](args) : null), { shouldMockEvents: true })
mockWindows('main')

localStorage.setItem('whisk.root', JSON.stringify(ROOT))
localStorage.setItem(
  `whisk.session.${ROOT.split(SEP).join('/').toLowerCase()}`,
  JSON.stringify({
    tabs: [
      { path: at('Player.cs'), line: 40, col: 0 },
      { path: at('tools.py'), line: 1, col: 0, pane: 1 }
    ],
    active: at('Player.cs')
  })
)

await import('../main')
const { useStore } = await import('../store/store')
const { allActions } = await import('../keymap/keymap')
const { getView } = await import('../editor/views')
// For poking at the interface from the browser console: __preview.run('git.blame').
;(window as any).__preview = { files, ROOT, at, useStore, getView, run: (id: string) => allActions().find((a) => a.id === id)?.run() }
