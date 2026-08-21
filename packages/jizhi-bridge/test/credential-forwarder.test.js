import { describe, expect, it, vi } from 'vitest'
import { createCredentialForwarder } from '../lib/credential-forwarder.js'

function fakeCredentials(values) {
  const calls = []
  return {
    calls,
    resolve: vi.fn(async (ref) => {
      calls.push(ref)
      const value = values[ref]
      return value === undefined ? undefined : { value, source: 'memory' }
    })
  }
}

function fakeSubprocess() {
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
  return { subprocess, spawnCalls, terminalCalls }
}

describe('credential forwarder', () => {
  it('forwards both credentials to ordinary and terminal spawns after explicit env', async () => {
    const credentials = fakeCredentials({
      OPENAI_API_KEY: 'key-current',
      OPENAI_BASE_URL: 'https://proxy.example/v1'
    })
    const { subprocess, spawnCalls, terminalCalls } = fakeSubprocess()
    const forwarder = createCredentialForwarder({ credentials, subprocess })

    await forwarder.refresh()
    forwarder.install()

    subprocess.spawn({ argv: ['bash'], cwd: '/tmp', env: {
      OPENAI_API_KEY: 'key-stale',
      KEEP: 'yes'
    } })
    await subprocess.spawnTerminal({ argv: ['bash'], cwd: '/tmp', env: { KEEP: 'yes' } })

    expect(spawnCalls[0].env).toEqual({
      OPENAI_API_KEY: 'key-current',
      KEEP: 'yes',
      OPENAI_BASE_URL: 'https://proxy.example/v1'
    })
    expect(terminalCalls[0].env).toEqual({
      KEEP: 'yes',
      OPENAI_API_KEY: 'key-current',
      OPENAI_BASE_URL: 'https://proxy.example/v1'
    })
    expect(credentials.calls).toEqual(['OPENAI_API_KEY', 'OPENAI_BASE_URL'])
  })

  it('omits missing credentials and publishes refreshed values', async () => {
    const values = { OPENAI_API_KEY: 'key-v1' }
    const credentials = fakeCredentials(values)
    const { subprocess, spawnCalls } = fakeSubprocess()
    const forwarder = createCredentialForwarder({ credentials, subprocess })

    await forwarder.refresh()
    forwarder.install()
    subprocess.spawn({ argv: ['bash'], cwd: '/tmp' })
    expect(spawnCalls[0].env).toEqual({ OPENAI_API_KEY: 'key-v1' })
    expect(spawnCalls[0].env).not.toHaveProperty('OPENAI_BASE_URL')

    values.OPENAI_API_KEY = 'key-v2'
    values.OPENAI_BASE_URL = 'https://proxy.example/v2'
    await forwarder.refresh()
    subprocess.spawn({ argv: ['bash'], cwd: '/tmp' })
    expect(spawnCalls[1].env).toEqual({
      OPENAI_API_KEY: 'key-v2',
      OPENAI_BASE_URL: 'https://proxy.example/v2'
    })
  })

  it('restores both subprocess methods and clears the snapshot on dispose', async () => {
    const credentials = fakeCredentials({ OPENAI_API_KEY: 'key' })
    const { subprocess } = fakeSubprocess()
    const originalSpawn = subprocess.spawn
    const originalSpawnTerminal = subprocess.spawnTerminal
    const forwarder = createCredentialForwarder({ credentials, subprocess })

    await forwarder.refresh()
    forwarder.install()
    expect(subprocess.spawn).not.toBe(originalSpawn)
    expect(subprocess.spawnTerminal).not.toBe(originalSpawnTerminal)
    expect(forwarder.getEnvironment()).toEqual({ OPENAI_API_KEY: 'key' })

    forwarder.dispose()
    expect(subprocess.spawn).toBe(originalSpawn)
    expect(subprocess.spawnTerminal).toBe(originalSpawnTerminal)
    expect(forwarder.getEnvironment()).toEqual({})
    forwarder.dispose()
  })
})
