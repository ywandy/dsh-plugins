import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'

export const name = 'dsh-desktop-temporary-workspace'
export const inject = ['webServer']
export const ENSURE_PATH = '/dsh-desktop/default-workspace/ensure'
export const SETTINGS_NAMESPACE = settingsNamespace('desktop-temporary-workspace')

function dshHome() {
  return process.env.DSH_HOME || path.join(homedir(), '.dsh')
}

export function defaultRootDirectory(home = dshHome()) {
  return path.join(home, 'default-workspace')
}

export function normalizeRootDirectory(value, pathApi = path) {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('default workspace directory must not be empty')
  if (!pathApi.isAbsolute(trimmed)) {
    throw new Error('default workspace directory must be absolute')
  }
  return pathApi.normalize(pathApi.resolve(trimmed))
}

export function validateConfig(config) {
  normalizeRootDirectory(config.rootDirectory)
}

export const Config = z.object({
  rootDirectory: z.string().default(defaultRootDirectory())
})

export async function ensureDefaultDirectory(directory) {
  const normalized = normalizeRootDirectory(directory)
  await mkdir(normalized, { recursive: true })
  return normalized
}

function isLoopback(address) {
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1'
  )
}

function hasForwardedAddress(req) {
  return Boolean(
    req.headers.forwarded ||
      req.headers['x-forwarded-for'] ||
      req.headers['x-real-ip'] ||
      req.headers['x-forwarded-host']
  )
}

export function isTrustedRequest(req, mutation = false) {
  if (!isLoopback(req.socket.remoteAddress) || hasForwardedAddress(req)) return false
  if (!mutation) return true

  const origin = req.headers.origin
  const host = req.headers.host
  if (typeof origin !== 'string' || typeof host !== 'string') return false
  try {
    const parsed = new URL(origin)
    return parsed.protocol === 'http:' && parsed.host === host && isLoopback(parsed.hostname)
  } catch {
    return false
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body)
  })
  res.end(body)
}

export async function handleEnsureRequest(req, res, rootDirectory) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed.' })
    return
  }
  if (!isTrustedRequest(req, true)) {
    sendJson(res, 403, { error: 'Request rejected.' })
    return
  }

  try {
    const ensured = await ensureDefaultDirectory(rootDirectory())
    sendJson(res, 200, { path: ensured })
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
  }
}

export function apply(ctx, config) {
  const entry = Config(config)
  let source = () => entry
  installSettingsSection(ctx, SETTINGS_NAMESPACE, Config, entry, {
    validate: validateConfig,
    setSource(current) {
      source = current
    },
    onChange() {}
  })

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ENSURE_PATH,
        handler: (req, res) =>
          handleEnsureRequest(req, res, () => source().rootDirectory)
      }),
    'dsh-desktop-temporary-workspace: ensure route'
  )
}
