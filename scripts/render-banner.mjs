// Renders assets/banner.html to assets/banner.png, the README banner, at 2000×1000.
// Needs Firefox. Usage: node scripts/render-banner.mjs
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const here = join(import.meta.dirname, '..')
const profile = mkdtempSync(join(tmpdir(), 'whisk-banner-'))
try {
  // The page is 1000×500; #2x has it zoom to twice that.
  const page = pathToFileURL(join(here, 'assets', 'banner.html')).href + '#2x'
  const out = join(here, 'assets', 'banner.png')
  execFileSync('firefox', ['--headless', '--no-remote', '--profile', profile, '--window-size=2000,1000', '--screenshot', out, page], { stdio: 'inherit' })
  console.log(`Wrote ${out}`)
} finally {
  rmSync(profile, { recursive: true, force: true })
}
