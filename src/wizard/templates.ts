import { joinPath } from '../lib/paths'
import { python } from '../lib/platform'

/**
 * Project templates for the New Project wizard. Each turns the form's answers
 * into steps: shell commands (run with the real tools, e.g. `dotnet new`) and
 * files to write. JavaScript templates write their own files rather than
 * running interactive scaffolders, so nothing waits on a prompt.
 */

export interface TemplateOption {
  id: string
  label: string
  type: 'select' | 'toggle' | 'text'
  choices?: { value: string; label: string }[]
  default: string | boolean
  hint?: string
}

export interface Answers {
  name: string
  /** Folder the project folder is created in. */
  location: string
  git: boolean
  options: Record<string, string | boolean>
}

export type Step =
  | { kind: 'run'; label: string; command: string; cwd: string }
  | { kind: 'write'; path: string; content: string }
  | { kind: 'mkdir'; path: string }

export interface Tool {
  program: string
  label: string
  url: string
}

export interface Template {
  id: string
  group: string
  label: string
  description: string
  /** Lane colour and letter for the list badge. */
  badge: { letter: string; lane: number }
  needs: Tool[]
  options: TemplateOption[]
  steps(a: Answers, dir: string): Step[]
  /** File to open once the project is created, relative to its folder. */
  openFile(a: Answers): string
}

const DOTNET: Tool = { program: 'dotnet', label: '.NET SDK', url: 'https://dotnet.microsoft.com/download' }
const NODE: Tool = { program: 'npm', label: 'Node.js', url: 'https://nodejs.org/en/download' }
const CARGO: Tool = { program: 'cargo', label: 'Rust', url: 'https://rustup.rs' }
const PYTHON: Tool = { program: python, label: 'Python', url: 'https://www.python.org/downloads/' }
const GO: Tool = { program: 'go', label: 'Go', url: 'https://go.dev/dl/' }

const q = (path: string) => `"${path}"`

const FRAMEWORK: TemplateOption = {
  id: 'framework',
  label: 'Target framework',
  type: 'select',
  choices: [
    { value: '', label: 'Latest installed' },
    { value: 'net8.0', label: '.NET 8 (LTS)' },
    { value: 'net9.0', label: '.NET 9' },
    { value: 'net10.0', label: '.NET 10 (LTS)' }
  ],
  default: ''
}

const SOLUTION: TemplateOption = {
  id: 'solution',
  label: 'Put the project in a solution',
  type: 'toggle',
  default: true,
  hint: 'Creates Name.sln with the project in its own folder, as Rider does'
}

function dotnetTemplate(id: string, label: string, description: string, short: string, letter: string, mainFile: string): Template {
  return {
    id,
    group: '.NET',
    label,
    description,
    badge: { letter, lane: 4 },
    needs: [DOTNET],
    options: [FRAMEWORK, SOLUTION],
    steps(a, dir) {
      const framework = a.options.framework ? ` --framework ${a.options.framework}` : ''
      const projectDir = a.options.solution ? joinPath(dir, a.name) : dir
      const steps: Step[] = []
      if (a.options.solution) {
        steps.push({ kind: 'run', label: 'Create solution', command: `dotnet new sln -n ${a.name} -o ${q(dir)}`, cwd: a.location })
      }
      steps.push({
        kind: 'run',
        label: `Create ${label.toLowerCase()}`,
        command: `dotnet new ${short} -n ${a.name} -o ${q(projectDir)}${framework}`,
        cwd: a.location
      })
      if (a.options.solution) {
        steps.push({
          kind: 'run',
          label: 'Add project to solution',
          command: `dotnet sln ${q(joinPath(dir, a.name + '.sln'))} add ${q(joinPath(projectDir, a.name + '.csproj'))}`,
          cwd: dir
        })
      }
      if (a.git) steps.push({ kind: 'run', label: 'Add .gitignore', command: 'dotnet new gitignore', cwd: dir })
      return steps
    },
    openFile: (a) => (a.options.solution ? `${a.name}/${mainFile}` : mainFile)
  }
}

const VITE_PACKAGE = (name: string) => `{
  "name": "${name.toLowerCase()}",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  },
  "devDependencies": {
    "@types/react": "^19.1.8",
    "@types/react-dom": "^19.1.6",
    "@vitejs/plugin-react": "^5.0.0",
    "typescript": "^5.8.3",
    "vite": "^7.0.0"
  }
}
`

const TS_CONFIG_REACT = `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true
  },
  "include": ["src"]
}
`

export const TEMPLATES: Template[] = [
  dotnetTemplate('console', 'Console app', 'A C# command-line program.', 'console', 'C', 'Program.cs'),
  dotnetTemplate('classlib', 'Class library', 'A C# library to share code between projects.', 'classlib', 'L', 'Class1.cs'),
  dotnetTemplate('webapi', 'ASP.NET Core Web API', 'An HTTP API with OpenAPI, ready to run.', 'webapi', 'W', 'Program.cs'),
  dotnetTemplate('xunit', 'xUnit tests', 'A C# test project using xUnit.', 'xunit', 'T', 'UnitTest1.cs'),
  {
    id: 'react-vite',
    group: 'JavaScript',
    label: 'React + Vite',
    description: 'A React app in TypeScript, built and served by Vite.',
    badge: { letter: 'R', lane: 1 },
    needs: [NODE],
    options: [{ id: 'install', label: 'Install packages now', type: 'toggle', default: true }],
    steps(a, dir) {
      const steps: Step[] = [
        { kind: 'write', path: joinPath(dir, 'package.json'), content: VITE_PACKAGE(a.name) },
        { kind: 'write', path: joinPath(dir, 'tsconfig.json'), content: TS_CONFIG_REACT },
        {
          kind: 'write',
          path: joinPath(dir, 'vite.config.ts'),
          content: "import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\n\nexport default defineConfig({\n  plugins: [react()]\n})\n"
        },
        {
          kind: 'write',
          path: joinPath(dir, 'index.html'),
          content: `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>${a.name}</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.tsx"></script>\n  </body>\n</html>\n`
        },
        {
          kind: 'write',
          path: joinPath(dir, 'src/main.tsx'),
          content: "import { StrictMode } from 'react'\nimport { createRoot } from 'react-dom/client'\nimport App from './App'\n\ncreateRoot(document.getElementById('root')!).render(\n  <StrictMode>\n    <App />\n  </StrictMode>\n)\n"
        },
        {
          kind: 'write',
          path: joinPath(dir, 'src/App.tsx'),
          content: `import { useState } from 'react'\n\nexport default function App() {\n  const [count, setCount] = useState(0)\n  return (\n    <main>\n      <h1>${a.name}</h1>\n      <button onClick={() => setCount((c) => c + 1)}>Clicked {count} times</button>\n    </main>\n  )\n}\n`
        }
      ]
      if (a.git) steps.push({ kind: 'write', path: joinPath(dir, '.gitignore'), content: 'node_modules\ndist\n' })
      if (a.options.install) steps.push({ kind: 'run', label: 'Install packages', command: 'npm install', cwd: dir })
      return steps
    },
    openFile: () => 'src/App.tsx'
  },
  {
    id: 'node-ts',
    group: 'JavaScript',
    label: 'Node.js + TypeScript',
    description: 'A TypeScript program for Node, run with tsx.',
    badge: { letter: 'N', lane: 2 },
    needs: [NODE],
    options: [{ id: 'install', label: 'Install packages now', type: 'toggle', default: true }],
    steps(a, dir) {
      const steps: Step[] = [
        {
          kind: 'write',
          path: joinPath(dir, 'package.json'),
          content: `{\n  "name": "${a.name.toLowerCase()}",\n  "version": "0.1.0",\n  "type": "module",\n  "scripts": {\n    "start": "tsx src/index.ts",\n    "build": "tsc"\n  },\n  "devDependencies": {\n    "@types/node": "^22.0.0",\n    "tsx": "^4.19.0",\n    "typescript": "^5.8.3"\n  }\n}\n`
        },
        {
          kind: 'write',
          path: joinPath(dir, 'tsconfig.json'),
          content: '{\n  "compilerOptions": {\n    "target": "ES2022",\n    "module": "NodeNext",\n    "moduleResolution": "NodeNext",\n    "outDir": "dist",\n    "strict": true,\n    "skipLibCheck": true\n  },\n  "include": ["src"]\n}\n'
        },
        { kind: 'write', path: joinPath(dir, 'src/index.ts'), content: `console.log('Hello from ${a.name}')\n` }
      ]
      if (a.git) steps.push({ kind: 'write', path: joinPath(dir, '.gitignore'), content: 'node_modules\ndist\n' })
      if (a.options.install) steps.push({ kind: 'run', label: 'Install packages', command: 'npm install', cwd: dir })
      return steps
    },
    openFile: () => 'src/index.ts'
  },
  {
    id: 'rust',
    group: 'Rust',
    label: 'Rust project',
    description: 'A Cargo package: a program or a library.',
    badge: { letter: 'R', lane: 10 },
    needs: [CARGO],
    options: [
      {
        id: 'kind',
        label: 'Kind',
        type: 'select',
        choices: [
          { value: 'bin', label: 'Program (binary)' },
          { value: 'lib', label: 'Library' }
        ],
        default: 'bin'
      }
    ],
    steps(a, dir) {
      const kind = a.options.kind === 'lib' ? ' --lib' : ''
      const vcs = a.git ? '' : ' --vcs none'
      return [{ kind: 'run', label: 'Create package', command: `cargo new ${q(dir)} --name ${a.name.toLowerCase().replace(/[^a-z0-9_]/g, '_')}${kind}${vcs}`, cwd: a.location }]
    },
    openFile: (a) => (a.options.kind === 'lib' ? 'src/lib.rs' : 'src/main.rs')
  },
  {
    id: 'python',
    group: 'Python',
    label: 'Python project',
    description: 'A Python package with a virtual environment in .venv.',
    badge: { letter: 'P', lane: 7 },
    needs: [PYTHON],
    options: [{ id: 'venv', label: 'Create a virtual environment', type: 'toggle', default: true }],
    steps(a, dir) {
      const module = a.name.toLowerCase().replace(/[^a-z0-9_]/g, '_')
      const steps: Step[] = [
        {
          kind: 'write',
          path: joinPath(dir, 'pyproject.toml'),
          content: `[project]\nname = "${module}"\nversion = "0.1.0"\nrequires-python = ">=3.10"\ndependencies = []\n`
        },
        {
          kind: 'write',
          path: joinPath(dir, 'main.py'),
          content: `def main() -> None:\n    print("Hello from ${a.name}")\n\n\nif __name__ == "__main__":\n    main()\n`
        }
      ]
      if (a.git) steps.push({ kind: 'write', path: joinPath(dir, '.gitignore'), content: '.venv/\n__pycache__/\n*.pyc\n' })
      if (a.options.venv) steps.push({ kind: 'run', label: 'Create virtual environment', command: `${python} -m venv .venv`, cwd: dir })
      return steps
    },
    openFile: () => 'main.py'
  },
  {
    id: 'go',
    group: 'Go',
    label: 'Go module',
    description: 'A Go program with its own module.',
    badge: { letter: 'G', lane: 6 },
    needs: [GO],
    options: [{ id: 'module', label: 'Module path', type: 'text', default: '', hint: 'e.g. github.com/you/name. Defaults to the project name.' }],
    steps(a, dir) {
      const module = (a.options.module as string) || a.name.toLowerCase()
      const steps: Step[] = [
        { kind: 'mkdir', path: dir },
        { kind: 'run', label: 'Create module', command: `go mod init ${module}`, cwd: dir },
        {
          kind: 'write',
          path: joinPath(dir, 'main.go'),
          content: `package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Hello from ${a.name}")\n}\n`
        }
      ]
      if (a.git) steps.push({ kind: 'write', path: joinPath(dir, '.gitignore'), content: '/bin/\n' })
      return steps
    },
    openFile: () => 'main.go'
  },
  {
    id: 'empty',
    group: 'Other',
    label: 'Empty folder',
    description: 'A new folder with a README, for anything else.',
    badge: { letter: 'E', lane: 11 },
    needs: [],
    options: [],
    steps: (a, dir) => [{ kind: 'write', path: joinPath(dir, 'README.md'), content: `# ${a.name}\n` }],
    openFile: () => 'README.md'
  }
]

/** `git init` runs last for every template that didn't set up git itself. */
export function withGit(template: Template, a: Answers, dir: string, steps: Step[]): Step[] {
  if (!a.git || template.id === 'rust') return steps
  return [...steps, { kind: 'run', label: 'Create git repository', command: 'git init', cwd: dir }]
}

export const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/
