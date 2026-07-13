import { access } from 'node:fs/promises'
import { join } from 'node:path'

const resources = join(process.cwd(), 'dist', 'linux-unpacked', 'resources', 'opencode-plugins')
for (const entry of ['google-workspace.mjs', 'openkhodam-poc.mjs']) {
  const path = join(resources, entry)
  await access(path)
  await import(path)
}
console.log('Packaged OpenKhodam plugin imports passed.')
