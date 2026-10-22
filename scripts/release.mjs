// Bumps the version everywhere, commits, tags and pushes, which starts the
// Release workflow. Usage: npm run release -- 0.2.0   (or 0.3.0-beta.1)
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const version = process.argv[2]
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version ?? '')) {
  console.error('Usage: npm run release -- <version>   e.g. 0.2.0 or 0.3.0-beta.1')
  process.exit(1)
}

const run = (cmd) => execSync(cmd, { stdio: 'inherit' })
if (execSync('git status --porcelain').toString().trim()) {
  console.error('Commit or stash your changes first.')
  process.exit(1)
}

const json = (path, edit) => {
  const data = JSON.parse(readFileSync(path, 'utf8'))
  edit(data)
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n')
}
json('package.json', (p) => (p.version = version))
json('src-tauri/tauri.conf.json', (c) => (c.version = version))
const cargo = readFileSync('src-tauri/Cargo.toml', 'utf8').replace(/^version = ".*"$/m, `version = "${version}"`)
writeFileSync('src-tauri/Cargo.toml', cargo)

// Keep Cargo.lock in step with the new version.
run('cargo update --manifest-path src-tauri/Cargo.toml --package whisk --offline')
run('git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock')
run(`git commit -m "Release v${version}"`)
run(`git tag v${version}`)
run('git push')
run(`git push origin v${version}`)
console.log(`\nTagged v${version}. The Release workflow is building the installer:`)
console.log('https://github.com/CookieJarTools/Whisk/actions')
