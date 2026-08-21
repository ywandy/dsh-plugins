import { watch as watchFilesystem } from 'node:fs'
import { lstat, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'

export const SYSTEM_SKILLS_ROOT = '/agent/skills'
export const JIZHI_SKILL_PROVIDER_NAME = 'jizhi-mounted-skills'

const USER_ROOT_PREFIX = '/agent/user'
const USER_CWD_PATTERN = /^\/agent\/user\/([^/]+)\/([^/]+)\/workspace(?:\/|$)/
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SYSTEM_RANK = 500
const USER_RANK = 700

const defaultFs = { lstat, readdir, readFile }

function isAbortError(signal) {
  return signal?.aborted === true
}

function throwIfAborted(signal) {
  if (!isAbortError(signal)) return
  throw signal.reason instanceof Error ? signal.reason : new Error('skill discovery aborted')
}

function isNotFound(error) {
  return error?.code === 'ENOENT' || error?.code === 'ENOTDIR'
}

function normalizeKey(name) {
  return name.trim().toLowerCase()
}

function isSkillName(name) {
  return SKILL_NAME_PATTERN.test(name)
}

function diagnostic(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Resolve the two container-visible skill roots for a DSH Session cwd.
 * The user root is only enabled for the workspace layout created by the Jizhi
 * DSH adaptor: /agent/user/<net>/<user>/workspace/....
 */
export function resolveJizhiSkillRoots(cwd) {
  if (typeof cwd !== 'string' || !path.posix.isAbsolute(cwd)) {
    return { systemRoot: SYSTEM_SKILLS_ROOT, userRoot: undefined }
  }

  const normalized = path.posix.normalize(cwd)
  const match = normalized.match(USER_CWD_PATTERN)
  if (!match) return { systemRoot: SYSTEM_SKILLS_ROOT, userRoot: undefined }

  const [, net, user] = match
  return {
    systemRoot: SYSTEM_SKILLS_ROOT,
    userRoot: path.posix.join(USER_ROOT_PREFIX, net, user, 'user_skills')
  }
}

function parseSkillDocument(raw, fallbackName, warn, filePath) {
  const normalized = String(raw).replace(/^\uFEFF/, '').replaceAll('\r\n', '\n')
  const trimmed = normalized.trim()
  const match = trimmed.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)([\s\S]*)$/)

  let metadata = {}
  let content = normalized
  if (match) {
    try {
      const parsed = yaml.load(match[1])
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        metadata = parsed
      } else if (parsed !== undefined && parsed !== null) {
        warn(`jizhi skill: frontmatter must be a mapping, ignored file=${filePath}`)
      }
    } catch (error) {
      warn(`jizhi skill: cannot parse frontmatter file=${filePath}: ${diagnostic(error)}`)
    }
    content = match[2]
  }

  const candidateName = typeof metadata.name === 'string' && metadata.name.trim() !== ''
    ? metadata.name.trim()
    : fallbackName
  const description = typeof metadata.description === 'string' && metadata.description.trim() !== ''
    ? metadata.description.trim()
    : `Jizhi skill: ${candidateName}`
  const whenToUse = typeof metadata.whenToUse === 'string' && metadata.whenToUse.trim() !== ''
    ? metadata.whenToUse.trim()
    : undefined

  return {
    name: candidateName,
    description,
    whenToUse,
    metadata,
    content: content.trim()
  }
}

async function ensureRegularDirectory(fsApi, directory) {
  const info = await fsApi.lstat(directory)
  if (info.isSymbolicLink?.() || !info.isDirectory?.()) {
    const error = new Error(`skill root must be a real directory: ${directory}`)
    error.code = 'ENOTDIR'
    throw error
  }
  return info
}

async function ensureRegularFile(fsApi, filePath) {
  const info = await fsApi.lstat(filePath)
  if (info.isSymbolicLink?.() || !info.isFile?.()) {
    const error = new Error(`SKILL.md must be a regular file: ${filePath}`)
    error.code = 'EINVAL'
    throw error
  }
  return info
}

/**
 * Create the DSH provider. The optional filesystem seams keep the provider
 * deterministic in tests while production uses the container filesystem.
 */
export function createJizhiSkillProvider(options = {}) {
  const {
    systemRoot = SYSTEM_SKILLS_ROOT,
    resolveUserRoot = (cwd) => resolveJizhiSkillRoots(cwd).userRoot,
    fsApi = defaultFs,
    watch = watchFilesystem,
    invalidate = () => {},
    signal,
    warn = () => {}
  } = options

  const watchedRoots = new Map()
  let disposed = false

  const closeWatchers = () => {
    if (disposed) return
    disposed = true
    for (const state of watchedRoots.values()) {
      for (const watcher of state.watchers) {
        try {
          watcher.close()
        } catch (error) {
          warn(`jizhi skill: cannot close watcher: ${diagnostic(error)}`)
        }
      }
      state.watchers.clear()
    }
    watchedRoots.clear()
  }

  signal?.addEventListener('abort', closeWatchers, { once: true })

  const notifyChange = () => {
    if (!disposed) invalidate()
  }

  const watchPath = (state, target) => {
    if (disposed || state.watchedPaths.has(target)) return
    state.watchedPaths.add(target)
    try {
      const watcher = watch(target, { persistent: false }, notifyChange)
      state.watchers.add(watcher)
    } catch (error) {
      state.watchedPaths.delete(target)
      if (!isNotFound(error)) {
        warn(`jizhi skill: cannot watch ${target}: ${diagnostic(error)}`)
      }
    }
  }

  const ensureRootWatcher = async (root) => {
    const normalizedRoot = path.posix.normalize(root)
    const existing = watchedRoots.get(normalizedRoot)
    if (existing) {
      try {
        await ensureRegularDirectory(fsApi, normalizedRoot)
        watchPath(existing, normalizedRoot)
      } catch (error) {
        if (!isNotFound(error)) {
          warn(`jizhi skill: cannot inspect root ${normalizedRoot}: ${diagnostic(error)}`)
        }
      }
      return existing
    }

    const state = { watchers: new Set(), watchedPaths: new Set() }
    watchedRoots.set(normalizedRoot, state)
    try {
      await ensureRegularDirectory(fsApi, normalizedRoot)
      watchPath(state, normalizedRoot)
    } catch (error) {
      if (!isNotFound(error)) {
        warn(`jizhi skill: cannot inspect root ${normalizedRoot}: ${diagnostic(error)}`)
      }
      const parent = path.posix.dirname(normalizedRoot)
      if (parent !== normalizedRoot) watchPath(state, parent)
    }
    return state
  }

  const scanRoot = async ({ root, source, rank }, lookupOptions) => {
    throwIfAborted(lookupOptions.signal)
    const normalizedRoot = path.posix.normalize(root)
    const state = await ensureRootWatcher(normalizedRoot)
    let entries
    try {
      await ensureRegularDirectory(fsApi, normalizedRoot)
      entries = await fsApi.readdir(normalizedRoot, { withFileTypes: true })
    } catch (error) {
      if (!isNotFound(error)) {
        warn(`jizhi skill: cannot read root ${normalizedRoot}: ${diagnostic(error)}`)
      }
      return []
    }

    entries.sort((left, right) => left.name.localeCompare(right.name))
    const candidates = []
    for (const entry of entries) {
      throwIfAborted(lookupOptions.signal)
      if (!entry.isDirectory() || entry.isSymbolicLink?.()) continue

      const skillDirectory = path.posix.join(normalizedRoot, entry.name)
      const filePath = path.posix.join(skillDirectory, 'SKILL.md')
      watchPath(state, skillDirectory)
      try {
        await ensureRegularFile(fsApi, filePath)
        const raw = await fsApi.readFile(filePath, 'utf8')
        const parsed = parseSkillDocument(raw, entry.name, warn, filePath)
        if (!isSkillName(parsed.name)) {
          warn(`jizhi skill: invalid skill name ${parsed.name} file=${filePath}`)
          continue
        }
        const locator = {
          filePath,
          skillDirectory,
          source,
          rank
        }
        candidates.push({
          name: parsed.name,
          description: parsed.description,
          ...(parsed.whenToUse === undefined ? {} : { whenToUse: parsed.whenToUse }),
          invocation: { modelInvocable: true, userInvocable: true },
          source,
          provider: JIZHI_SKILL_PROVIDER_NAME,
          resourceBase: { kind: 'directory', path: skillDirectory },
          rank,
          locator,
          path: filePath,
          metadata: parsed.metadata
        })
      } catch (error) {
        if (!isNotFound(error)) {
          warn(`jizhi skill: cannot read ${filePath}: ${diagnostic(error)}`)
        }
      }
    }
    return candidates
  }

  const provider = {
    name: JIZHI_SKILL_PROVIDER_NAME,

    async list(lookupOptions = {}) {
      throwIfAborted(lookupOptions.signal)
      const roots = [{ root: systemRoot, source: 'bundled', rank: SYSTEM_RANK }]
      const userRoot = resolveUserRoot(lookupOptions.cwd)
      if (typeof userRoot === 'string' && userRoot.trim() !== '') {
        roots.push({ root: userRoot, source: 'user-dsh', rank: USER_RANK })
      }

      const seen = new Set()
      const candidates = []
      for (const root of roots) {
        for (const candidate of await scanRoot(root, lookupOptions)) {
          const key = normalizeKey(candidate.name)
          if (seen.has(key)) continue
          seen.add(key)
          candidates.push(candidate)
        }
      }
      candidates.sort((left, right) => left.name.localeCompare(right.name))
      return candidates
    },

    async get(candidate, lookupOptions = {}) {
      throwIfAborted(lookupOptions.signal)
      const locator = candidate?.locator
      if (!locator || typeof locator.filePath !== 'string') return undefined

      try {
        await ensureRegularFile(fsApi, locator.filePath)
        const raw = await fsApi.readFile(locator.filePath, 'utf8')
        const parsed = parseSkillDocument(raw, path.posix.basename(locator.skillDirectory), warn, locator.filePath)
        throwIfAborted(lookupOptions.signal)
        return {
          name: parsed.name,
          description: parsed.description,
          ...(parsed.whenToUse === undefined ? {} : { whenToUse: parsed.whenToUse }),
          invocation: { modelInvocable: true, userInvocable: true },
          source: locator.source,
          provider: JIZHI_SKILL_PROVIDER_NAME,
          resourceBase: { kind: 'directory', path: locator.skillDirectory },
          content: parsed.content,
          path: locator.filePath,
          metadata: parsed.metadata
        }
      } catch (error) {
        if (isAbortError(lookupOptions.signal)) throw error
        if (!isNotFound(error)) {
          warn(`jizhi skill: cannot load ${locator.filePath}: ${diagnostic(error)}`)
        }
        return undefined
      }
    }
  }

  return provider
}
