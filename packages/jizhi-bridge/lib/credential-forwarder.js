import { credentialRef } from '@deepseek-ai/dsh-credentials'

export const FORWARDED_CREDENTIAL_NAMES = Object.freeze([
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL'
])

function withForwardedEnv(spec, environment) {
  if (Object.keys(environment).length === 0) return spec
  return {
    ...spec,
    env: { ...(spec.env ?? {}), ...environment }
  }
}

export function createCredentialForwarder({
  credentials,
  subprocess,
  refs = FORWARDED_CREDENTIAL_NAMES
}) {
  let environment = Object.freeze({})
  let refreshVersion = 0
  let installed = false
  let disposed = false
  let originalSpawn
  let originalSpawnTerminal

  async function refresh() {
    const version = ++refreshVersion
    const next = {}
    for (const name of refs) {
      const resolved = await credentials.resolve(credentialRef(name))
      if (typeof resolved?.value === 'string' && resolved.value.length > 0) {
        next[name] = resolved.value
      }
    }
    if (!disposed && version === refreshVersion) {
      environment = Object.freeze(next)
    }
  }

  function install() {
    if (disposed) throw new Error('credential forwarder is disposed')
    if (installed) throw new Error('credential forwarder is already installed')

    originalSpawn = subprocess.spawn
    originalSpawnTerminal = subprocess.spawnTerminal
    subprocess.spawn = (spec) => originalSpawn.call(
      subprocess,
      withForwardedEnv(spec, environment)
    )
    subprocess.spawnTerminal = (spec) => originalSpawnTerminal.call(
      subprocess,
      withForwardedEnv(spec, environment)
    )
    installed = true
  }

  function dispose() {
    if (disposed) return
    disposed = true
    ++refreshVersion
    if (installed) {
      subprocess.spawn = originalSpawn
      subprocess.spawnTerminal = originalSpawnTerminal
      installed = false
    }
    environment = Object.freeze({})
  }

  return {
    refresh,
    install,
    getEnvironment: () => environment,
    dispose
  }
}
