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
;(window as any).__preview = { files, ROOT, useStore }
