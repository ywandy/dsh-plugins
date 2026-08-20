import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const packageDirectoryUrl = new URL('../', import.meta.url)
const manifestUrl = new URL('package.json', packageDirectoryUrl)
const patchUrl = new URL('cordis.patch.yml', packageDirectoryUrl)

describe('published package manifest', () => {
  it('declares the scoped public package and runtime exports', async () => {
    const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'))
    expect(manifest).toMatchObject({
      name: '@ywandy/dsh-desktop-temporary-workspace',
      version: '0.3.0',
      description: 'Adds a deferred default workspace backed by a shared configurable working directory.',
      private: false,
      type: 'module',
      main: './index.js',
      publishConfig: { access: 'public' },
      exports: {
        '.': './index.js',
        './client': './client.js',
        './package.json': './package.json'
      }
    })
  })

  it('ships only the documented public files', async () => {
    const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'))
    expect(manifest.files).toEqual([
      'index.js',
      'client.js',
      'cordis.patch.yml',
      'README.md',
      'README.zh.md',
      'LICENSE'
    ])
  })

  it('declares an installable bundle with the exact Cordis patch', async () => {
    const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'))
    const patch = await readFile(patchUrl, 'utf8')

    expect(manifest.dsh.bundle).toEqual({ patch: './cordis.patch.yml' })
    expect(patch).toBe(
      "- insert:\n" +
        "    - id: dsh-desktop-temporary-workspace\n" +
        "      name: '@ywandy/dsh-desktop-temporary-workspace'\n"
    )
  })

  it('retains the web client injection contract', async () => {
    const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'))
    expect(manifest.dsh.client.platform).toBe('web')
    expect(manifest.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-workspace')
    expect(manifest.dsh.client.inject).not.toContain('@deepseek-ai/dsh-client-ui-primitives')
    expect(manifest.peerDependencies).not.toHaveProperty(
      '@deepseek-ai/dsh-client-ui-primitives'
    )
  })
})
