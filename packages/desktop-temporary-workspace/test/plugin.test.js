import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  Config,
  ENSURE_PATH,
  defaultRootDirectory,
  ensureDefaultDirectory,
  handleEnsureRequest,
  isTrustedRequest,
  normalizeRootDirectory,
  validateConfig
} from '../index.js'

const temporaryRoots = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  )
})

async function temporaryRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-temporary-workspace-'))
  temporaryRoots.push(root)
  return root
}

async function loadClientRegistration(fetchImpl = async () => {
  throw new Error('unexpected fetch')
}) {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  let registration
  const document = {
    querySelector: () => null,
    createElement: () => ({ dataset: {}, textContent: '' }),
    head: { appendChild() {} }
  }
  const window = {
    fetch: fetchImpl,
    __ModuleLoader__: {
      load(value) {
        registration = value
      }
    }
  }
  vm.runInNewContext(source, { window, document, console }, { filename: 'client.js' })
  if (!registration) throw new Error('client bundle did not register')
  return registration
}

async function loadClientBundle(fetchImpl = async () => {
  throw new Error('unexpected fetch')
}) {
  const registration = await loadClientRegistration(fetchImpl)
  return registration.factory((id) => {
    if (id === 'react') return React
    throw new Error(`unexpected client dependency: ${id}`)
  })
}

function request(headers = {}, remoteAddress = '127.0.0.1', method = 'POST') {
  return {
    method,
    headers: {
      host: '127.0.0.1:51923',
      origin: 'http://127.0.0.1:51923',
      ...headers
    },
    socket: { remoteAddress }
  }
}

function response() {
  return {
    status: undefined,
    headers: undefined,
    body: '',
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
    },
    end(body = '') {
      this.body = body
    }
  }
}

function createClientContextFixture(entries) {
  const scope = {
    getSnapshot: () => ({
      status: 'ready',
      value: { rootDirectory: '/tmp/workspaces' },
      base: { rootDirectory: '/tmp/workspaces' },
      user: undefined,
      revision: 0,
      writable: true,
      mode: 'host'
    }),
    subscribe: () => () => {},
    set: vi.fn(async () => {}),
    unset: vi.fn(async () => {})
  }
  return {
    slots: {
      inject(_name, register) {
        const result = register()
        if (result && typeof result[Symbol.iterator] === 'function') {
          for (const _disposer of result) void _disposer
        }
        return () => {}
      },
      register(options, component) {
        entries.push({ options, component })
        return () => {}
      }
    },
    locale: {
      register: vi.fn(() => () => {}),
      bind: () => (key) => key
    },
    settingsScope: {
      bind: ({ namespace }) => {
        expect(namespace).toBe('desktop-temporary-workspace')
        return scope
      }
    },
    sessions: {
      create: vi.fn(async () => 'session-1'),
      open: vi.fn()
    },
    workspaces: {
      pickDirectory: vi.fn(async () => null),
      create: vi.fn(async ({ path: directory }) => ({ workspaceId: directory }))
    },
    effect: (install) => install()
  }
}

describe('default workspace directory', () => {
  it('places the shared default directory below DSH_HOME', () => {
    expect(defaultRootDirectory('/dsh-home')).toBe(
      path.join('/dsh-home', 'default-workspace')
    )
  })

  it('rejects empty and relative root paths', () => {
    expect(() => normalizeRootDirectory('  ')).toThrow('must not be empty')
    expect(() => normalizeRootDirectory('relative/path')).toThrow('must be absolute')
  })

  it('normalizes Windows absolute paths with Windows path rules', () => {
    expect(normalizeRootDirectory('C:\\DSH Temp\\..\\Workspaces', path.win32)).toBe(
      'C:\\Workspaces'
    )
  })

  it('ensures and reuses one normalized directory', async () => {
    const directory = path.join(await temporaryRoot(), 'shared', '..', 'default')

    const first = await ensureDefaultDirectory(directory)
    const second = await ensureDefaultDirectory(directory)

    expect(first).toBe(path.normalize(directory))
    expect(second).toBe(first)
    expect((await stat(first)).isDirectory()).toBe(true)
  })

  it('returns one directory for concurrent ensure calls', async () => {
    const directory = path.join(await temporaryRoot(), 'default')

    const ensured = await Promise.all([
      ensureDefaultDirectory(directory),
      ensureDefaultDirectory(directory)
    ])

    expect(new Set(ensured)).toEqual(new Set([path.normalize(directory)]))
  })
})

describe('default workspace ensure route', () => {
  it('uses the fixed same-origin endpoint', () => {
    expect(ENSURE_PATH).toBe('/dsh-desktop/default-workspace/ensure')
  })

  it('accepts same-origin loopback requests only', () => {
    expect(isTrustedRequest(request(), true)).toBe(true)
    expect(
      isTrustedRequest(request({ forwarded: 'for=127.0.0.1' }), true)
    ).toBe(false)
    expect(
      isTrustedRequest(request({ origin: 'https://attacker.example' }), true)
    ).toBe(false)
    expect(isTrustedRequest(request({}, '192.168.1.5'), true)).toBe(false)
  })

  it('rejects non-POST methods before touching the directory', async () => {
    const directory = path.join(await temporaryRoot(), 'default')
    const res = response()

    await handleEnsureRequest(request({}, '127.0.0.1', 'GET'), res, () => directory)

    expect(res.status).toBe(405)
    expect(JSON.parse(res.body)).toEqual({ error: 'Method not allowed.' })
    await expect(stat(directory)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('ensures the configured directory and ignores caller path data', async () => {
    const parent = await temporaryRoot()
    const configured = path.join(parent, 'configured')
    const res = response()
    const req = request()
    req.body = { rootDirectory: path.join(parent, 'caller-controlled') }

    await handleEnsureRequest(req, res, () => configured)

    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ path: configured })
    expect((await stat(configured)).isDirectory()).toBe(true)
    await expect(stat(req.body.rootDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('returns a structured error when the configured directory is a file', async () => {
    const parent = await temporaryRoot()
    const directory = path.join(parent, 'occupied')
    await writeFile(directory, 'not a directory')
    const res = response()

    await handleEnsureRequest(request(), res, () => directory)

    expect(res.status).toBe(500)
    expect(JSON.parse(res.body)).toMatchObject({ error: expect.any(String) })
  })
})

describe('temporary workspace host configuration', () => {
  it('defaults the settings root below DSH_HOME', () => {
    expect(Config({})).toEqual({ rootDirectory: defaultRootDirectory() })
  })

  it('rejects a relative configured root before it is stored', () => {
    expect(() => validateConfig({ rootDirectory: 'relative/root' })).toThrow(
      'must be absolute'
    )
  })

})

describe('temporary workspace client plugin', () => {
  it('registers the Client bundle under the npm package id', async () => {
    const registration = await loadClientRegistration()

    expect(registration.id).toBe('@ywandy/dsh-desktop-temporary-workspace')
  })

  it('ensures the shared directory through the fixed Host endpoint', async () => {
    const calls = []
    const client = await loadClientBundle()
    const ensuredPath = await client.ensureDefaultWorkspace(async (...args) => {
      calls.push(args)
      return {
        ok: true,
        status: 200,
        json: async () => ({ path: '/tmp/default-workspace' })
      }
    })

    expect(ensuredPath).toBe('/tmp/default-workspace')
    expect(calls).toEqual([[
      '/dsh-desktop/default-workspace/ensure',
      { method: 'POST', headers: { accept: 'application/json' } }
    ]])
  })

  it('rejects Host errors and malformed Ensure success payloads', async () => {
    const client = await loadClientBundle()

    await expect(
      client.ensureDefaultWorkspace(async () => ({
        ok: false,
        status: 500,
        json: async () => ({ error: 'disk is read-only' })
      }))
    ).rejects.toThrow('disk is read-only')
    await expect(
      client.ensureDefaultWorkspace(async () => ({
        ok: true,
        status: 200,
        json: async () => ({})
      }))
    ).rejects.toThrow('did not contain a path')
  })

  it('registers locale dictionaries and the settings card', async () => {
    const client = await loadClientBundle()
    const entries = []
    const ctx = createClientContextFixture(entries)

    client.apply(ctx)

    const dictionaryCall = ctx.locale.register.mock.calls.find(
      ([namespace]) => namespace === 'desktop.temporaryWorkspace'
    )
    expect(dictionaryCall).toBeDefined()
    const dictionaries = dictionaryCall[1]
    expect(dictionaries.zh).toMatchObject({
      defaultWorkspace: '默认执行目录',
      settingsTitle: '默认执行目录',
      rootDirectory: '默认执行目录'
    })
    expect(dictionaries.en).toMatchObject({
      defaultWorkspace: 'Default workspace',
      settingsTitle: 'Default workspace',
      rootDirectory: 'Default workspace directory'
    })

    expect(entries.some((entry) =>
      entry.options.name === 'settings.plugin.item' &&
      entry.options.key === 'desktop-temporary-workspace'
    )).toBe(true)
  })

  it('registers the default directory as one deferred source on both workspace surfaces', async () => {
    const fetchCalls = []
    const client = await loadClientBundle(async (...args) => {
      fetchCalls.push(args)
      return {
        ok: true,
        status: 200,
        json: async () => ({ path: '/tmp/default-workspace' })
      }
    })
    const entries = []
    const ctx = createClientContextFixture(entries)

    client.apply(ctx)

    const sources = entries.filter((entry) =>
      entry.options.name.endsWith('.createSource')
    )
    expect(sources.map(({ options }) => ({
      name: options.name,
      id: options.id,
      activation: options.activation,
      label: options.label()
    }))).toEqual([
      {
        name: 'conversation.hero.workspace.createSource',
        id: 'default',
        activation: 'submit',
        label: 'defaultWorkspace'
      },
      {
        name: 'sidebar.workspaces.createSource',
        id: 'default',
        activation: 'submit',
        label: 'defaultWorkspace'
      }
    ])

    await expect(sources[0].options.create()).resolves.toBe(
      '/tmp/default-workspace'
    )
    expect(fetchCalls).toEqual([[
      '/dsh-desktop/default-workspace/ensure',
      { method: 'POST', headers: { accept: 'application/json' } }
    ]])
    expect(ctx.sessions.create).not.toHaveBeenCalled()
    expect(ctx.sessions.open).not.toHaveBeenCalled()
  })
})
