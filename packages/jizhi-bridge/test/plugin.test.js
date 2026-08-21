import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import {
  MARKDOWN_FILES,
  normalizeWorkspaceCwd,
  protectPromptBraces,
  refreshWorkspaceSnapshot
} from '../lib/workspace-markdown.js'
import {
  convertResultParts,
  createToolJsonlBridge,
  isValidCallId,
  writeToolJsonl
} from '../lib/tool-jsonl.js'
import {
  createJizhiSkillProvider,
  resolveJizhiSkillRoots
} from '../lib/skill-provider.js'
import { apply, inject, name } from '../index.js'

const temporaryRoots = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  )
})

async function temporaryRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-jizhi-bridge-'))
  temporaryRoots.push(root)
  return root
}

function toolCallEvent(callId = 'call_1', name = 'read_file', args = '{"path":"README.md"}') {
  return {
    type: 'tool/call',
    seq: 1,
    time: 1,
    data: { turn: 1, step: 1, callId, name, arguments: args }
  }
}

function toolResultEvent(callId = 'call_1', content = [{ type: 'text', text: 'done' }], isError = false) {
  return {
    type: 'tool/result',
    seq: 2,
    time: 2,
    data: {
      turn: 1,
      step: 1,
      message: {
        id: 'message_1',
        role: 'user',
        source: { kind: 'tool', callId },
        content: [{ type: 'tool-result', toolCallId: callId, content, isError }]
      }
    },
    surfaceOp: 'append',
    sourceEventSeqs: [1]
  }
}

async function writeSkill(root, name, content) {
  const directory = path.join(root, name)
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'SKILL.md'), content)
  return directory
}

function hostFixture() {
  const handlers = new Map()
  const sections = new Map()
  const variables = new Map()
  const skillRegistrations = []
  const effects = []
  const credentialValues = {
    OPENAI_API_KEY: 'key-v1',
    OPENAI_BASE_URL: 'https://proxy.example/v1'
  }
  const credentials = {
    values: credentialValues,
    resolve: vi.fn(async (ref) => {
      const value = credentialValues[ref]
      return value === undefined ? undefined : { value, source: 'memory' }
    })
  }
  const spawnCalls = []
  const terminalCalls = []
  const subprocess = {
    spawn(spec) {
      spawnCalls.push(spec)
      return { kind: 'process', spec }
    },
    async spawnTerminal(spec) {
      terminalCalls.push(spec)
      return { kind: 'terminal', spec }
    }
  }
  const skills = {
    registerProvider: vi.fn((factory) => {
      const lifecycle = new AbortController()
      const provider = factory({
        signal: lifecycle.signal,
        invalidate: vi.fn()
      })
      const dispose = () => lifecycle.abort(new Error('disposed'))
      skillRegistrations.push({ lifecycle, provider, dispose })
      return dispose
    })
  }
  const ctx = {
    attachments: { readImage: vi.fn() },
    logger: { warn: vi.fn() },
    credentials,
    subprocess,
    skills,
    systemPrompt: {
      section: vi.fn((section) => {
        sections.set(section.name, section)
        return () => sections.delete(section.name)
      }),
      variable: vi.fn((variableName, provider) => {
        variables.set(variableName, provider)
        return () => variables.delete(variableName)
      })
    },
    on(eventName, handler) {
      handlers.set(eventName, handler)
      return () => handlers.delete(eventName)
    },
    effect(factory) {
      const cleanup = factory()
      effects.push(cleanup)
      return cleanup
    }
  }
  return {
    ctx,
    handlers,
    sections,
    variables,
    skillRegistrations,
    credentials,
    subprocess,
    spawnCalls,
    terminalCalls,
    effects,
    cleanup() {
      for (const effect of effects.splice(0).reverse()) effect?.()
    }
  }
}

describe('Jizhi workspace Markdown snapshot', () => {
  it('rejects missing, relative, and ordinary workspaces without creating metadata', async () => {
    const root = await temporaryRoot()

    expect(normalizeWorkspaceCwd(undefined)).toBeUndefined()
    expect(normalizeWorkspaceCwd('relative/workspace')).toBeUndefined()
    expect(refreshWorkspaceSnapshot(root)).toBeUndefined()
    await expect(readFile(path.join(root, '.jizhiagent'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('renders non-empty Markdown in one fixed order and preserves double braces', async () => {
    const root = await temporaryRoot()
    const systemDir = path.join(root, '.jizhiagent')
    await mkdir(systemDir)
    await Promise.all([
      writeFile(path.join(systemDir, 'SUMMARY.md'), 'summary {{value}}'),
      writeFile(path.join(systemDir, 'AGENTS.md'), 'agents'),
      writeFile(path.join(systemDir, 'USER.md'), '   '),
      writeFile(path.join(systemDir, 'MEMORY.md'), 'memory')
    ])

    const snapshot = refreshWorkspaceSnapshot(root)
    expect(MARKDOWN_FILES).toEqual([
      'AGENTS.md',
      'IDENTITY.md',
      'USER.md',
      'MEMORY.md',
      'SUMMARY.md'
    ])
    expect(snapshot.text.indexOf('AGENTS.md')).toBeLessThan(snapshot.text.indexOf('MEMORY.md'))
    expect(snapshot.text.indexOf('MEMORY.md')).toBeLessThan(snapshot.text.indexOf('SUMMARY.md'))
    expect(snapshot.text).not.toContain('USER.md')
    expect(snapshot.text).not.toContain(root)

    const rendered = renderPrompt({
      sections: [{ name: 'jizhi:workspace', text: snapshot.text }],
      contexts: [],
      tools: [],
      variables: { jizhi_open: '{{' }
    })
    expect(rendered).toContain('summary {{value}}')
    expect(protectPromptBraces('{{a}} + {{b}}')).toBe(
      '{{jizhi_open}}a}} + {{jizhi_open}}b}}'
    )
  })

  it('retains a previous file after a non-ENOENT read failure and removes ENOENT files', async () => {
    const root = await temporaryRoot()
    const systemDir = path.join(root, '.jizhiagent')
    await mkdir(systemDir)
    await writeFile(path.join(systemDir, 'MEMORY.md'), 'old memory')
    await writeFile(path.join(systemDir, 'SUMMARY.md'), 'old summary')
    const previous = refreshWorkspaceSnapshot(root)
    await rm(path.join(systemDir, 'SUMMARY.md'))
    const warn = vi.fn()

    const next = refreshWorkspaceSnapshot(root, previous, {
      stat: statSync,
      readFile(file, encoding) {
        if (file.endsWith('MEMORY.md')) {
          const error = new Error('permission denied')
          error.code = 'EACCES'
          throw error
        }
        return readFileSync(file, encoding)
      },
      warn
    })

    expect(next.files['MEMORY.md']).toBe('old memory')
    expect(next.files).not.toHaveProperty('SUMMARY.md')
    expect(warn).toHaveBeenCalledOnce()
  })
})

describe('Jizhi tool JSONL', () => {
  it('accepts only lookup-safe call ids within the 241-byte filename budget', () => {
    expect(isValidCallId('a'.repeat(241))).toBe(true)
    expect(isValidCallId('a'.repeat(242))).toBe(false)
    expect(isValidCallId('调用'.repeat(81))).toBe(false)
    for (const value of ['', ' call_1', 'call_1 ', '.', '..', 'a/b', 'a\\b', 'a\0b']) {
      expect(isValidCallId(value)).toBe(false)
    }
  })

  it('maps text, reasoning, image, unknown blocks, and failures in source order', async () => {
    const attachments = {
      readImage: vi.fn(async () => ({
        ref: { mediaType: 'image/png' },
        data: Uint8Array.from([1, 2, 3])
      }))
    }
    const event = toolResultEvent('call_1', [
      { type: 'text', text: 'visible' },
      { type: 'reasoning', text: 'thought' },
      { type: 'image', attachment: { attachmentId: 'image_1' } },
      { type: 'custom', value: 7 }
    ], true)

    expect(await convertResultParts(event, attachments, vi.fn())).toEqual({
      parts: [
        { type: 'text', text: 'visible' },
        { type: 'text', text: 'thought', extra: { dsh_type: 'reasoning' } },
        {
          type: 'image',
          image: { base64data: 'AQID', mime_type: 'image/png' }
        },
        {
          type: 'text',
          text: '{"type":"custom","value":7}',
          extra: { dsh_type: 'custom' }
        }
      ],
      isError: true
    })
  })

  it('uses a diagnostic text part when one image cannot be read', async () => {
    const warn = vi.fn()
    const result = await convertResultParts(
      toolResultEvent('call_1', [{ type: 'image', attachment: { attachmentId: 'missing' } }]),
      { readImage: vi.fn(async () => { throw new Error('missing image') }) },
      warn
    )

    expect(result.parts).toEqual([{
      type: 'text',
      text: '[DSH image unavailable: missing image]',
      extra: { dsh_type: 'image' }
    }])
    expect(warn).toHaveBeenCalledOnce()
  })

  it('writes one complete two-line file and preserves the raw argument string', async () => {
    const root = await temporaryRoot()
    const systemDir = path.join(root, '.jizhiagent')
    await mkdir(systemDir)
    const session = { header: { cwd: root }, events: [] }
    const call = toolCallEvent('call_raw', 'read_file', '{ "path" : "README.md" }').data

    expect(await writeToolJsonl(
      session,
      call,
      toolResultEvent('call_raw'),
      { readImage: vi.fn() },
      { randomId: () => 'fixed' }
    )).toBe(true)

    const toolsDir = path.join(systemDir, 'tools')
    const content = await readFile(path.join(toolsDir, 'call_id_call_raw.jsonl'), 'utf8')
    const lines = content.split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[2]).toBe('')
    expect(JSON.parse(lines[0])).toEqual({
      type: 'tool_call',
      call_id: 'call_raw',
      tool_name: 'read_file',
      arguments: '{ "path" : "README.md" }'
    })
    expect(JSON.parse(lines[1])).toEqual({
      type: 'tool_result',
      call_id: 'call_raw',
      result_parts: [{ type: 'text', text: 'done' }],
      is_error: false
    })
    expect((await readdir(toolsDir)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('does not recreate a missing .jizhiagent or encode an invalid call id', async () => {
    const root = await temporaryRoot()
    const warn = vi.fn()
    const session = { header: { cwd: root }, events: [] }

    expect(await writeToolJsonl(
      session,
      toolCallEvent('../escape').data,
      toolResultEvent('../escape'),
      { readImage: vi.fn() },
      { warn }
    )).toBe(false)
    await expect(stat(path.join(root, '.jizhiagent'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps parallel calls in independent complete files', async () => {
    const root = await temporaryRoot()
    const systemDir = path.join(root, '.jizhiagent')
    await mkdir(systemDir)
    const session = { header: { cwd: root }, events: [] }

    await Promise.all(['first', 'second'].map((callId) => writeToolJsonl(
      session,
      toolCallEvent(callId, 'echo', `{"value":"${callId}"}`).data,
      toolResultEvent(callId, [{ type: 'text', text: callId }]),
      { readImage: vi.fn() }
    )))

    const toolsDir = path.join(systemDir, 'tools')
    expect((await readdir(toolsDir)).sort()).toEqual([
      'call_id_first.jsonl',
      'call_id_second.jsonl'
    ])
    for (const callId of ['first', 'second']) {
      const content = await readFile(path.join(toolsDir, `call_id_${callId}.jsonl`), 'utf8')
      expect(content.split('\n')).toHaveLength(3)
      expect(JSON.parse(content.split('\n')[1]).call_id).toBe(callId)
    }
  })

  it('removes its temporary file when the final rename fails', async () => {
    const root = await temporaryRoot()
    const systemDir = path.join(root, '.jizhiagent')
    await mkdir(systemDir)
    const warn = vi.fn()
    const session = { header: { cwd: root }, events: [] }

    expect(await writeToolJsonl(
      session,
      toolCallEvent('rename_failure').data,
      toolResultEvent('rename_failure'),
      { readImage: vi.fn() },
      {
        fsApi: {
          mkdir,
          stat,
          writeFile,
          rm,
          async rename() { throw new Error('rename failed') }
        },
        randomId: () => 'rename-failure',
        warn
      }
    )).toBe(false)

    expect(await readdir(path.join(systemDir, 'tools'))).toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('rename failed'))
  })

  it('correlates live calls, falls back to immutable history, and flushes all scheduled writes', async () => {
    const writes = []
    const releases = []
    const write = vi.fn((session, call, result) => new Promise((resolve) => {
      writes.push({ session, call, result })
      releases.push(resolve)
    }))
    const warn = vi.fn()
    const bridge = createToolJsonlBridge({ attachments: {}, warn, write })
    const liveCall = toolCallEvent('live')
    const historyCall = toolCallEvent('history')
    const session = { header: { cwd: '/tmp/workspace' }, events: [historyCall] }

    bridge.observe(session, liveCall)
    bridge.observe(session, toolResultEvent('live'))
    bridge.observe(session, toolResultEvent('history'))
    bridge.observe(session, toolResultEvent('missing'))

    await Promise.resolve()
    expect(write).toHaveBeenCalledTimes(2)
    expect(writes.map(({ call }) => call.callId)).toEqual(['live', 'history'])
    let flushed = false
    const flush = bridge.flush(session).then(() => { flushed = true })
    await Promise.resolve()
    expect(flushed).toBe(false)
    releases.forEach((release) => release(true))
    await flush
    expect(flushed).toBe(true)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('missing'))
  })

  it('contains a rejected write so bridge flush still resolves', async () => {
    const warn = vi.fn()
    const bridge = createToolJsonlBridge({
      attachments: {},
      warn,
      write: vi.fn(async () => { throw new Error('disk full') })
    })
    const session = { header: { cwd: '/tmp/workspace' }, events: [] }
    bridge.observe(session, toolCallEvent('call_1'))
    bridge.observe(session, toolResultEvent('call_1'))

    await expect(bridge.flush(session)).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('disk full'))
  })
})

describe('Jizhi mounted skill provider', () => {
  it('derives the fixed user skill root from a DSH workspace cwd', () => {
    expect(resolveJizhiSkillRoots('/agent/user/wan/gz0175/workspace/wp_42')).toEqual({
      systemRoot: '/agent/skills',
      userRoot: '/agent/user/wan/gz0175/user_skills'
    })
    expect(resolveJizhiSkillRoots('/tmp/workspace')).toEqual({
      systemRoot: '/agent/skills',
      userRoot: undefined
    })
    expect(resolveJizhiSkillRoots('/agent/user/wan/gz0175/not-workspace/wp_42')).toEqual({
      systemRoot: '/agent/skills',
      userRoot: undefined
    })
  })

  it('lists stable metadata across system and user roots with system precedence', async () => {
    const root = await temporaryRoot()
    const systemRoot = path.join(root, 'system')
    const userRoot = path.join(root, 'user')
    await writeSkill(systemRoot, 'zeta', '---\nname: zeta\ndescription: Zeta skill\n---\n# Zeta')
    await writeSkill(systemRoot, 'shared', '---\nname: shared\ndescription: System shared\n---\n# System')
    await writeSkill(userRoot, 'alpha', '---\nname: alpha\ndescription: Alpha skill\n---\n# Alpha')
    await writeSkill(userRoot, 'shared', '---\nname: shared\ndescription: User shared\n---\n# User')
    await writeSkill(userRoot, 'plain', '# Plain skill without frontmatter')

    const provider = createJizhiSkillProvider({
      systemRoot,
      resolveUserRoot: () => userRoot,
      watch: () => ({ close() {} })
    })
    const candidates = await provider.list({ cwd: '/agent/user/wan/gz0175/workspace/wp_42' })

    expect(candidates.map((candidate) => candidate.name)).toEqual([
      'alpha',
      'plain',
      'shared',
      'zeta'
    ])
    expect(candidates.find((candidate) => candidate.name === 'shared')).toMatchObject({
      description: 'System shared',
      source: 'bundled',
      rank: 500,
      resourceBase: { kind: 'directory', path: path.join(systemRoot, 'shared') }
    })
    expect(candidates.find((candidate) => candidate.name === 'plain').description).not.toBe('')
  })

  it('loads a skill body lazily and removes only the YAML frontmatter', async () => {
    const root = await temporaryRoot()
    const systemRoot = path.join(root, 'system')
    const skillDirectory = await writeSkill(
      systemRoot,
      'writer',
      '---\nname: writer\ndescription: Write files\npermissions:\n  - file_write\n---\n\n# Writer\n\nFollow this.'
    )
    const provider = createJizhiSkillProvider({
      systemRoot,
      resolveUserRoot: () => undefined,
      watch: () => ({ close() {} })
    })
    const [candidate] = await provider.list({ cwd: '/tmp/workspace' })
    const definition = await provider.get(candidate, { cwd: '/tmp/workspace' })

    expect(definition).toMatchObject({
      name: 'writer',
      description: 'Write files',
      content: '# Writer\n\nFollow this.',
      path: path.join(skillDirectory, 'SKILL.md'),
      resourceBase: { kind: 'directory', path: skillDirectory },
      metadata: { permissions: ['file_write'] }
    })
  })

  it('invalidates the DSH catalog on filesystem changes and closes watchers on abort', async () => {
    const root = await temporaryRoot()
    const systemRoot = path.join(root, 'system')
    await writeSkill(systemRoot, 'watchable', '---\nname: watchable\ndescription: Watch me\n---\nbody')
    const callbacks = []
    const invalidated = vi.fn()
    const lifecycle = new AbortController()
    const provider = createJizhiSkillProvider({
      systemRoot,
      signal: lifecycle.signal,
      invalidate: invalidated,
      watch(target, _options, callback) {
        callbacks.push({ target, callback })
        return { close: vi.fn() }
      }
    })

    await provider.list({ cwd: '/tmp/workspace' })
    expect(callbacks.map(({ target }) => target)).toContain(systemRoot)
    callbacks[0].callback('change', 'SKILL.md')
    expect(invalidated).toHaveBeenCalledOnce()
    lifecycle.abort()
    callbacks[0].callback('change', 'SKILL.md')
    expect(invalidated).toHaveBeenCalledOnce()
  })
})

describe('Jizhi bridge Host plugin', () => {
  it('registers one Host-only prompt section and literal brace variable', async () => {
    const fixture = hostFixture()
    await apply(fixture.ctx)

    expect(name).toBe('dsh-jizhi-bridge')
    expect(inject).toEqual(['systemPrompt', 'attachments', 'skills', 'credentials', 'subprocess'])
    expect(fixture.ctx.skills.registerProvider).toHaveBeenCalledOnce()
    expect(fixture.skillRegistrations[0].provider.name).toBe('jizhi-mounted-skills')
    expect(fixture.sections.get('jizhi:workspace').order).toBe(50)
    expect(fixture.variables.get('jizhi_open')({})).toBe('{{')
    expect(fixture.handlers.has('agent/pre-step')).toBe(false)
    expect(fixture.handlers.has('agent/inbox/claimed')).toBe(true)
  })

  it('forwards refreshed credentials to both subprocess seams and restores them on dispose', async () => {
    const fixture = hostFixture()
    const originalSpawn = fixture.subprocess.spawn
    const originalSpawnTerminal = fixture.subprocess.spawnTerminal

    await apply(fixture.ctx)
    fixture.subprocess.spawn({ argv: ['bash'], env: { KEEP: 'yes' } })
    await fixture.subprocess.spawnTerminal({ argv: ['bash'], env: { KEEP: 'yes' } })
    expect(fixture.spawnCalls[0].env).toEqual({
      KEEP: 'yes',
      OPENAI_API_KEY: 'key-v1',
      OPENAI_BASE_URL: 'https://proxy.example/v1'
    })
    expect(fixture.terminalCalls[0].env).toEqual({
      KEEP: 'yes',
      OPENAI_API_KEY: 'key-v1',
      OPENAI_BASE_URL: 'https://proxy.example/v1'
    })

    fixture.credentials.values.OPENAI_API_KEY = 'key-v2'
    fixture.credentials.values.OPENAI_BASE_URL = 'https://proxy.example/v2'
    fixture.handlers.get('credentials/updated')()
    await vi.waitFor(() => expect(fixture.credentials.resolve).toHaveBeenCalledTimes(4))
    fixture.subprocess.spawn({ argv: ['bash'] })
    expect(fixture.spawnCalls[1].env).toEqual({
      OPENAI_API_KEY: 'key-v2',
      OPENAI_BASE_URL: 'https://proxy.example/v2'
    })

    fixture.cleanup()
    expect(fixture.subprocess.spawn).toBe(originalSpawn)
    expect(fixture.subprocess.spawnTerminal).toBe(originalSpawnTerminal)
    fixture.subprocess.spawn({ argv: ['bash'] })
    expect(fixture.spawnCalls[2].env).toBeUndefined()
  })

  it('refreshes before the first request once per claimed real user message', async () => {
    const root = await temporaryRoot()
    const systemDir = path.join(root, '.jizhiagent')
    await mkdir(systemDir)
    await writeFile(path.join(systemDir, 'SUMMARY.md'), 'version one')
    const fixture = hostFixture()
    await apply(fixture.ctx)
    const agent = { session: { header: { cwd: root } } }
    const claimed = fixture.handlers.get('agent/inbox/claimed')
    const section = fixture.sections.get('jizhi:workspace')

    claimed({ agent, message: { source: { kind: 'user' } } })
    expect(section.text({ agent })).toContain('version one')
    await writeFile(path.join(systemDir, 'SUMMARY.md'), 'version two')
    claimed({ agent, message: { source: { kind: 'tool' } } })
    expect(section.text({ agent })).toContain('version one')
    expect(section.text({ agent })).not.toContain('version two')
    claimed({ agent, message: { source: { kind: 'user' } } })
    expect(section.text({ agent })).toContain('version two')
  })

  it('keeps an ordinary workspace prompt empty', async () => {
    const root = await temporaryRoot()
    const fixture = hostFixture()
    await apply(fixture.ctx)
    const agent = { session: { header: { cwd: root } } }

    fixture.handlers.get('agent/inbox/claimed')({
      agent,
      message: { source: { kind: 'user' } }
    })
    expect(fixture.sections.get('jizhi:workspace').text({ agent })).toBe('')
  })

  it('routes committed tool events to JSONL and awaits them on session flush', async () => {
    const root = await temporaryRoot()
    await mkdir(path.join(root, '.jizhiagent'))
    const fixture = hostFixture()
    await apply(fixture.ctx)
    const session = { header: { cwd: root }, events: [] }
    const call = toolCallEvent('integrated', 'shell', '{"cmd":"pwd"}')
    const result = toolResultEvent('integrated', [{ type: 'text', text: root }])

    session.events.push(call)
    fixture.handlers.get('session/event')(session, call)
    session.events.push(result)
    fixture.handlers.get('session/event')(session, result)
    await fixture.handlers.get('session/flush')(session)

    const content = await readFile(
      path.join(root, '.jizhiagent', 'tools', 'call_id_integrated.jsonl'),
      'utf8'
    )
    expect(content.split('\n')).toHaveLength(3)
    expect(JSON.parse(content.split('\n')[1])).toMatchObject({
      call_id: 'integrated',
      is_error: false
    })
  })
})
