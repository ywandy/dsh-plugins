import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'

export const MARKDOWN_FILES = Object.freeze([
  'AGENTS.md',
  'IDENTITY.md',
  'USER.md',
  'MEMORY.md',
  'SUMMARY.md'
])

export function normalizeWorkspaceCwd(cwd, pathApi = path) {
  if (typeof cwd !== 'string' || !pathApi.isAbsolute(cwd)) return undefined
  return pathApi.normalize(pathApi.resolve(cwd))
}

export function protectPromptBraces(text) {
  return text.replaceAll('{{', '{{jizhi_open}}')
}

function renderWorkspaceSection(files) {
  return MARKDOWN_FILES.flatMap((filename) => {
    const content = files[filename]
    if (typeof content !== 'string' || content.trim().length === 0) return []
    return [`## Jizhi workspace: ${filename}\n\n${protectPromptBraces(content)}`]
  }).join('\n\n')
}

function isEnoent(error) {
  return error && typeof error === 'object' && error.code === 'ENOENT'
}

export function refreshWorkspaceSnapshot(cwd, previous, options = {}) {
  const {
    pathApi = path,
    stat = statSync,
    readFile = readFileSync,
    warn = () => {}
  } = options
  const normalized = normalizeWorkspaceCwd(cwd, pathApi)
  if (normalized === undefined) {
    warn('jizhi bridge: Session cwd is missing or not absolute')
    return undefined
  }

  const systemDir = pathApi.join(normalized, '.jizhiagent')
  try {
    if (!stat(systemDir).isDirectory()) return undefined
  } catch (error) {
    if (!isEnoent(error)) warn(`jizhi bridge: cannot inspect system directory: ${String(error)}`)
    return undefined
  }

  const canReuse = previous?.cwd === normalized
  const files = {}
  for (const filename of MARKDOWN_FILES) {
    try {
      const content = readFile(pathApi.join(systemDir, filename), 'utf8')
      if (content.trim().length > 0) files[filename] = content
    } catch (error) {
      if (isEnoent(error)) continue
      warn(`jizhi bridge: cannot read ${filename}: ${String(error)}`)
      if (canReuse && Object.hasOwn(previous.files, filename)) {
        files[filename] = previous.files[filename]
      }
    }
  }

  return Object.freeze({
    cwd: normalized,
    systemDir,
    files: Object.freeze(files),
    text: renderWorkspaceSection(files)
  })
}
