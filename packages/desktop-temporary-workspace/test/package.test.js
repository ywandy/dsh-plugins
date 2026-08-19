import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const manifestUrl = new URL('../package.json', import.meta.url)

describe('published package manifest', () => {
  it('declares the scoped public package and runtime exports', async () => {
    const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'))
    expect(manifest).toMatchObject({
      name: '@ywandy/dsh-desktop-temporary-workspace',
      version: '0.1.0',
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
      'README.md',
      'README.zh.md',
      'LICENSE'
    ])
  })

  it('retains the web client injection contract', async () => {
    const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'))
    expect(manifest.dsh.client.platform).toBe('web')
    expect(manifest.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-workspace')
  })
})
