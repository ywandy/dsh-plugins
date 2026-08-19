import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageDirectory = path.join(
  repositoryRoot,
  'packages',
  'desktop-temporary-workspace'
)
const expected = new Set([
  'LICENSE',
  'README.md',
  'README.zh.md',
  'client.js',
  'index.js',
  'package.json'
])
const packEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => {
    const normalized = key.toLowerCase()
    return !(
      normalized.includes('npm_globalconfig') ||
      normalized.includes('verify_deps_before_run') ||
      (normalized.startsWith('npm_config_') && normalized.includes('jsr'))
    )
  })
)

const output = execFileSync(
  'npm',
  ['pack', packageDirectory, '--dry-run', '--json'],
  { cwd: repositoryRoot, encoding: 'utf8', env: packEnvironment }
)
const [result] = JSON.parse(output)
if (!result || !Array.isArray(result.files)) {
  throw new Error('npm pack did not return a file list')
}

const actual = new Set(result.files.map(({ path: filePath }) => filePath))
const missing = [...expected].filter((filePath) => !actual.has(filePath)).sort()
const unexpected = [...actual].filter((filePath) => !expected.has(filePath)).sort()

if (missing.length > 0 || unexpected.length > 0) {
  if (missing.length > 0) console.error(`missing: ${missing.join(', ')}`)
  if (unexpected.length > 0) console.error(`unexpected: ${unexpected.join(', ')}`)
  process.exitCode = 1
} else {
  console.log('pack contents verified')
}
