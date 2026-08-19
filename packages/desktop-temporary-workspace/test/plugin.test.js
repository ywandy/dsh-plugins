import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  Config,
  CREATE_PATH,
  createTemporaryDirectory,
  defaultRootDirectory,
  formatDirectoryName,
  handleCreateRequest,
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

async function loadClientBundle(fetchImpl = async () => {
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

describe('temporary workspace directory naming', () => {
  it('places temporary workspaces below the DSH home', () => {
    expect(defaultRootDirectory('/dsh-home')).toBe(
      path.join('/dsh-home', 'temporary-workspaces')
    )
  })

  it('formats directory names from local calendar fields', () => {
    expect(formatDirectoryName(new Date(2026, 7, 19, 15, 30, 45))).toBe(
      '20260819-153045'
    )
  })
})

describe('temporary workspace directory creation', () => {
  it('rejects empty and relative root paths', () => {
    expect(() => normalizeRootDirectory('  ')).toThrow('must not be empty')
    expect(() => normalizeRootDirectory('relative/path')).toThrow('must be absolute')
  })

  it('normalizes Windows absolute paths with Windows path rules', () => {
    expect(normalizeRootDirectory('C:\\DSH Temp\\..\\Workspaces', path.win32)).toBe(
      'C:\\Workspaces'
    )
  })

  it('uses the -02 suffix for an existing timestamp directory', async () => {
    const root = await temporaryRoot()
    const now = new Date(2026, 7, 19, 15, 30, 45)
    await mkdir(path.join(root, '20260819-153045'))

    expect(await createTemporaryDirectory(root, now)).toBe(
      path.join(root, '20260819-153045-02')
    )
  })

  it('creates different directories for concurrent requests', async () => {
    const root = await temporaryRoot()
    const now = new Date(2026, 7, 19, 15, 30, 45)

    const created = await Promise.all([
      createTemporaryDirectory(root, now),
      createTemporaryDirectory(root, now)
    ])

    expect(new Set(created).size).toBe(2)
    expect((await stat(created[0])).isDirectory()).toBe(true)
    expect((await stat(created[1])).isDirectory()).toBe(true)
  })
})

describe('temporary workspace create route', () => {
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

  it('rejects non-POST methods before creating a directory', async () => {
    const root = path.join(await temporaryRoot(), 'root')
    const res = response()

    await handleCreateRequest(request({}, '127.0.0.1', 'GET'), res, () => root)

    expect(res.status).toBe(405)
    expect(JSON.parse(res.body)).toEqual({ error: 'Method not allowed.' })
    await expect(stat(root)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('creates below the configured root and ignores caller path data', async () => {
    const parent = await temporaryRoot()
    const root = path.join(parent, 'configured')
    const res = response()
    const req = request()
    req.body = { rootDirectory: path.join(parent, 'attacker-controlled') }

    await handleCreateRequest(req, res, () => root, new Date(2026, 7, 19, 15, 30, 45))

    expect(res.status).toBe(201)
    expect(JSON.parse(res.body)).toEqual({
      path: path.join(root, '20260819-153045')
    })
    expect((await stat(path.join(root, '20260819-153045'))).isDirectory()).toBe(true)
    await expect(stat(req.body.rootDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('returns a structured error when the configured root cannot be created', async () => {
    const parent = await temporaryRoot()
    const root = path.join(parent, 'occupied')
    await writeFile(root, 'not a directory')
    const res = response()

    await handleCreateRequest(request(), res, () => root)

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

  it('uses a fixed same-origin create endpoint', () => {
    expect(CREATE_PATH).toBe('/dsh-desktop/temporary-workspace/create')
  })
})

describe('temporary workspace client plugin', () => {
  it('returns the created absolute path from the Host endpoint', async () => {
    const client = await loadClientBundle()
    const fetchImpl = async () => ({
      ok: true,
      status: 201,
      json: async () => ({ path: '/tmp/20260819-153045' })
    })

    await expect(client.createTemporaryWorkspace(fetchImpl)).resolves.toBe(
      '/tmp/20260819-153045'
    )
  })

  it('rejects Host errors and malformed success payloads', async () => {
    const client = await loadClientBundle()

    await expect(
      client.createTemporaryWorkspace(async () => ({
        ok: false,
        status: 500,
        json: async () => ({ error: 'disk is read-only' })
      }))
    ).rejects.toThrow('disk is read-only')
    await expect(
      client.createTemporaryWorkspace(async () => ({
        ok: true,
        status: 201,
        json: async () => ({})
      }))
    ).rejects.toThrow('did not contain a path')
  })

  it('registers ordered sources and the keyed settings card', async () => {
    const fetchCalls = []
    const client = await loadClientBundle(async (...args) => {
      fetchCalls.push(args)
      return {
        ok: true,
        status: 201,
        json: async () => ({ path: '/tmp/temporary-workspace' })
      }
    })
    const entries = []
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
      set: async () => {},
      unset: async () => {}
    }
    const slots = {
      inject(_name, register) {
        const result = register()
        if (result && typeof result[Symbol.iterator] === 'function') {
          for (const _entry of result) void _entry
        }
        return () => {}
      },
      register(options, component) {
        entries.push({ options, component })
        return () => {}
      }
    }
    const ctx = {
      slots,
      locale: {
        register: () => () => {},
        bind: () => (key) => key
      },
      settingsScope: {
        bind: ({ namespace }) => {
          expect(namespace).toBe('desktop-temporary-workspace')
          return scope
        }
      },
      effect: (install) => install()
    }

    client.apply(ctx)

    const sources = entries.filter((entry) => entry.options.id === 'temporary')
    expect(sources.map((entry) => entry.options.name).sort()).toEqual([
      'conversation.hero.workspace.createSource',
      'sidebar.workspaces.createSource'
    ])
    expect(sources.every((entry) => entry.options.order === 10)).toBe(true)
    expect(sources.every((entry) => entry.options.activation === 'submit')).toBe(true)
    expect(sources.every((entry) => typeof entry.options.create === 'function')).toBe(true)
    expect(sources.every((entry) => typeof entry.options.inject === 'function')).toBe(true)
    const productionMetadata = sources[0].options.inject()
    expect(productionMetadata.activation).toBe('submit')
    expect(productionMetadata.create).toBeTypeOf('function')
    expect(fetchCalls).toHaveLength(0)
    expect(sources[0].component({ open: true })).toBeNull()
    expect(fetchCalls).toHaveLength(0)
    await expect(productionMetadata.create()).resolves.toBe('/tmp/temporary-workspace')
    expect(fetchCalls).toHaveLength(1)
    expect(entries.some((entry) =>
      entry.options.name === 'settings.plugin.item' &&
      entry.options.key === 'desktop-temporary-workspace'
    )).toBe(true)
  })
})
