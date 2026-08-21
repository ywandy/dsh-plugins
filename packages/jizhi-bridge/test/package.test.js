import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageDirectoryUrl = new URL('../', import.meta.url)
const manifestUrl = new URL('package.json', packageDirectoryUrl)
const patchUrl = new URL('cordis.patch.yml', packageDirectoryUrl)
const helperUrl = new URL('lib/credential-forwarder.js', packageDirectoryUrl)
const readmeUrl = new URL('README.md', packageDirectoryUrl)
const readmeZhUrl = new URL('README.zh.md', packageDirectoryUrl)
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))
const execFileAsync = promisify(execFile)

describe('jizhi bridge published package', () => {
  it('declares one public Host-only DSH package', async () => {
    const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'))

    expect(manifest).toMatchObject({
      name: '@ywandy/dsh-jizhi-bridge',
      version: '0.1.0',
      private: false,
      type: 'module',
      main: './index.js',
      exports: {
        '.': './index.js',
        './package.json': './package.json'
      },
      engines: { node: '>=22.19' },
      publishConfig: { access: 'public' },
      dsh: { bundle: { patch: './cordis.patch.yml' } }
    })
    expect(manifest.dsh).not.toHaveProperty('client')
  })

  it('ships the exact public files and DSH runtime peers', async () => {
    const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'))

    expect(manifest.files).toEqual([
      'index.js',
      'lib',
      'cordis.patch.yml',
      'README.md',
      'README.zh.md',
      'LICENSE'
    ])
    expect(manifest.peerDependencies).toEqual({
      '@deepseek-ai/cordis': '^4.0.1',
      '@deepseek-ai/dsh-agent': '^0.1.0-rc.7',
      '@deepseek-ai/dsh-attachment': '^0.1.0-rc.7',
      '@deepseek-ai/dsh-credentials': '^0.1.0-rc.7',
      '@deepseek-ai/dsh-tools': '^0.1.0-rc.7',
      '@deepseek-ai/dsh-skill': '^0.1.0-rc.7',
      '@deepseek-ai/dsh-session': '^0.1.0-rc.7',
      '@deepseek-ai/dsh-subprocess': '^0.1.0-rc.7',
      '@deepseek-ai/dsh-system-prompt': '^0.1.0-rc.7'
    })
    expect(manifest.dependencies).toEqual({
      'js-yaml': '^4.3.1'
    })
  })

  it('mounts the exact Cordis Host id', async () => {
    expect(await readFile(patchUrl, 'utf8')).toBe(
      "- insert:\n" +
        "    - id: dsh-jizhi-bridge\n" +
        "      name: '@ywandy/dsh-jizhi-bridge'\n"
    )
  })

  it('ships the credential forwarder helper in the public lib directory', async () => {
    const helper = await readFile(helperUrl, 'utf8')
    expect(helper).toContain('createCredentialForwarder')
    expect(helper).toContain('OPENAI_API_KEY')
  })

  it('documents the fixed mounted skill roots and cache boundary', async () => {
    const [readme, readmeZh] = await Promise.all([
      readFile(readmeUrl, 'utf8'),
      readFile(readmeZhUrl, 'utf8')
    ])
    expect(readme).toContain('/agent/skills')
    expect(readme).toContain('/agent/user/<net>/<user>/user_skills')
    expect(readme).toContain('skill')
    expect(readme).toContain('cache')
    expect(readme).toContain('OPENAI_API_KEY')
    expect(readme).toContain('subprocess')
    expect(readme).toContain('temporary')
    expect(readmeZh).toContain('/agent/skills')
    expect(readmeZh).toContain('/agent/user/<net>/<user>/user_skills')
    expect(readmeZh).toContain('skill')
    expect(readmeZh).toContain('缓存')
    expect(readmeZh).toContain('OPENAI_API_KEY')
    expect(readmeZh).toContain('子进程')
    expect(readmeZh).toContain('临时')
  })

  it('verifies the packed contents of every published workspace package', async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [path.join(repositoryRoot, 'scripts', 'verify-pack.mjs')],
      { cwd: repositoryRoot }
    )

    expect(stdout).toContain('desktop-temporary-workspace: pack contents verified')
    expect(stdout).toContain('jizhi-bridge: pack contents verified')
  })
})
