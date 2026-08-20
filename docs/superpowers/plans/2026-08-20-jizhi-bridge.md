# DSH 极智兼容桥插件 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增可由 DSH Host 安装的 `@ywandy/dsh-jizhi-bridge`，按真实用户消息加载极智 Markdown 快照，并把模型可见的顶层工具调用原子写成极智兼容双行 JSONL。

**Architecture:** `workspace-markdown.js` 负责工作区识别、固定顺序读取、旧值回退和提示词转义；同步刷新挂在 `agent/inbox/claimed`，因为 DSH `0.1.0-rc.7` 在该事件之后、`agent/pre-step` 之前 assemble system prompt。`tool-jsonl.js` 从 `session/event` 关联原始 call 与最终 result，异步转换附件并原子落盘，`index.js` 只负责 Cordis 注册、WeakMap 生命周期和 flush 屏障。

**Tech Stack:** Node.js `>=22.19`、ES Modules、pnpm `11.7.0`、Vitest `3.2.4`、Cordis `^4.0.1`、DeepSeek Harness `^0.1.0-rc.7`。

## Global Constraints

- npm 包名固定为 `@ywandy/dsh-jizhi-bridge`，Cordis ID 固定为 `dsh-jizhi-bridge`，目录固定为 `packages/jizhi-bridge`，初始版本固定为 `0.1.0`。
- 只提供 Host 入口；不得创建 `client.js`，不得声明 `dsh.client`。
- 只读取 `Session.header.cwd`；它必须是绝对路径，且既有 `<cwd>/.jizhiagent` 必须是目录。
- Markdown 固定顺序为 `AGENTS.md`、`IDENTITY.md`、`USER.md`、`MEMORY.md`、`SUMMARY.md`。
- Markdown 只在 `agent/inbox/claimed` 领取到 `source.kind === "user"` 的消息时同步刷新一次；同一 Agent Loop 的后续请求不得再次访问文件系统。
- System Prompt section 固定为 `jizhi:workspace`、order `50`；变量固定为 `jizhi_open`，值固定为字面量 `{{`。
- 工具日志固定写到 `.jizhiagent/tools/call_id_<callId>.jsonl`，恰好两行且保留末尾换行；`callId` 最多 `241` UTF-8 bytes。
- 只记录模型历史中可见的顶层 `tool/call` 与 `tool/result`；Code Mode 内部 dispatch 不额外记录。
- `.jizhiagent` 不存在时不得创建；工具写盘和附件失败不得改变 DSH Session event、工具结果、主对话或主 flush 的成功状态。
- 不修改 `/Users/yewei/yyw/4399/project/jizhi_ai` 中的任何文件。
- 所有行为修改先写测试并确认 RED，再写最小实现确认 GREEN；核心路径使用自动测试，真实 DSH 安装使用人工 Smoke Test。
- 全部任务和最终评审结束后，把本分支相对 `5ce86cb` 的提交 squash 为一个计划 Commit。

---

## 文件结构与职责

```text
packages/jizhi-bridge/
├── index.js                       # Cordis Host 装配、快照 WeakMap、事件订阅与 flush 转发
├── lib/workspace-markdown.js      # cwd 校验、Markdown 读取/回退、固定渲染与 {{ 保护
├── lib/tool-jsonl.js              # call/result 关联、Eino part 转换、原子写与 pending 集合
├── test/plugin.test.js            # Markdown、JSONL 和 Host 生命周期核心行为
├── test/package.test.js           # manifest、Host-only bundle、Cordis patch 与发布文件契约
├── package.json                   # npm 与 DSH Host 发布契约
├── cordis.patch.yml               # 自动插入 dsh-jizhi-bridge Host 插件
├── README.md                      # 英文安装、行为、兼容性与限制
├── README.zh.md                   # 中文安装、行为、兼容性与限制
└── LICENSE                        # MIT
```

根仓库文件：

- `README.md` / `README.zh.md`：把新包加入插件表和安装示例。
- `scripts/verify-pack.mjs`：同时验证两个 npm tarball 的精确文件集合。
- `pnpm-lock.yaml`：新增 `packages/jizhi-bridge` workspace importer 与 peer 解析结果。
- `docs/superpowers/specs/2026-08-20-jizhi-bridge-design.md`：记录 `agent/inbox/claimed` 的真实 DSH 时序。

### Task 1: 建立 Host-only npm 包契约

**Files:**

- Create: `packages/jizhi-bridge/test/package.test.js`
- Create: `packages/jizhi-bridge/package.json`
- Create: `packages/jizhi-bridge/cordis.patch.yml`
- Create: `packages/jizhi-bridge/LICENSE`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: 根仓库 Node `>=22.19`、pnpm workspace 与 DSH `0.1.0-rc.7` 基线。
- Produces: Host 入口 `./index.js`、包内 `./package.json` export、`dsh.bundle.patch === "./cordis.patch.yml"`，以及五个运行时 peer dependencies。

- [ ] **Step 1: 写发布契约失败测试**

创建 `packages/jizhi-bridge/test/package.test.js`：

```js
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const packageDirectoryUrl = new URL('../', import.meta.url)
const manifestUrl = new URL('package.json', packageDirectoryUrl)
const patchUrl = new URL('cordis.patch.yml', packageDirectoryUrl)

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
      '@deepseek-ai/dsh-session': '^0.1.0-rc.7',
      '@deepseek-ai/dsh-system-prompt': '^0.1.0-rc.7'
    })
  })

  it('mounts the exact Cordis Host id', async () => {
    expect(await readFile(patchUrl, 'utf8')).toBe(
      "- insert:\n" +
        "    - id: dsh-jizhi-bridge\n" +
        "      name: '@ywandy/dsh-jizhi-bridge'\n"
    )
  })
})
```

- [ ] **Step 2: 运行测试并确认缺少 manifest**

Run:

```sh
corepack pnpm exec vitest run packages/jizhi-bridge/test/package.test.js
```

Expected: FAIL，错误包含 `ENOENT` 和 `packages/jizhi-bridge/package.json`。

- [ ] **Step 3: 写最小 package manifest 和 Cordis patch**

创建 `packages/jizhi-bridge/package.json`：

```json
{
  "name": "@ywandy/dsh-jizhi-bridge",
  "version": "0.1.0",
  "description": "Loads Jizhi workspace context and writes Jizhi-compatible tool JSONL from DSH sessions.",
  "private": false,
  "type": "module",
  "main": "./index.js",
  "exports": {
    ".": "./index.js",
    "./package.json": "./package.json"
  },
  "files": [
    "index.js",
    "lib",
    "cordis.patch.yml",
    "README.md",
    "README.zh.md",
    "LICENSE"
  ],
  "keywords": [
    "deepseek-harness",
    "dsh",
    "dsh-plugin",
    "jizhi"
  ],
  "repository": {
    "type": "git",
    "url": "git+https://github.com/ywandy/dsh-plugins.git",
    "directory": "packages/jizhi-bridge"
  },
  "homepage": "https://github.com/ywandy/dsh-plugins/tree/main/packages/jizhi-bridge#readme",
  "bugs": {
    "url": "https://github.com/ywandy/dsh-plugins/issues"
  },
  "publishConfig": {
    "access": "public"
  },
  "engines": {
    "node": ">=22.19"
  },
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-agent": "^0.1.0-rc.7",
    "@deepseek-ai/dsh-attachment": "^0.1.0-rc.7",
    "@deepseek-ai/dsh-session": "^0.1.0-rc.7",
    "@deepseek-ai/dsh-system-prompt": "^0.1.0-rc.7"
  },
  "license": "MIT"
}
```

创建 `packages/jizhi-bridge/cordis.patch.yml`：

```yaml
- insert:
    - id: dsh-jizhi-bridge
      name: '@ywandy/dsh-jizhi-bridge'
```

使用 `apply_patch` 创建 `packages/jizhi-bridge/LICENSE`，内容固定为：

```text
MIT License

Copyright (c) 2026 ywandy

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

然后更新 workspace 依赖：

```sh
corepack pnpm install
```

Expected: `pnpm-lock.yaml` 出现 `packages/jizhi-bridge` importer，五个 peer 的 specifier 与上面的 manifest 完全一致。

- [ ] **Step 4: 运行 package 测试确认通过**

Run:

```sh
corepack pnpm exec vitest run packages/jizhi-bridge/test/package.test.js
```

Expected: 3 tests PASS。

- [ ] **Step 5: 提交包契约**

```sh
git add packages/jizhi-bridge/package.json packages/jizhi-bridge/cordis.patch.yml packages/jizhi-bridge/LICENSE packages/jizhi-bridge/test/package.test.js pnpm-lock.yaml
git commit -m "build: scaffold jizhi bridge package"
```

### Task 2: 实现按真实用户消息刷新的 Markdown 快照

**Files:**

- Create: `packages/jizhi-bridge/lib/workspace-markdown.js`
- Create: `packages/jizhi-bridge/test/plugin.test.js`

**Interfaces:**

- Consumes: `cwd: unknown`、可选上一版 `WorkspaceSnapshot`、同步 `stat/readFile` seam。
- Produces: `MARKDOWN_FILES`、`normalizeWorkspaceCwd(cwd, pathApi)`、`protectPromptBraces(text)`、`refreshWorkspaceSnapshot(cwd, previous, options)`；成功快照形状为 `{ cwd, systemDir, files, text }`，非极智工作区返回 `undefined`。

- [ ] **Step 1: 写工作区识别、顺序、回退和转义失败测试**

创建 `packages/jizhi-bridge/test/plugin.test.js`，先加入以下测试：

```js
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
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
```

- [ ] **Step 2: 运行工作区测试并确认模块缺失**

Run:

```sh
corepack pnpm exec vitest run packages/jizhi-bridge/test/plugin.test.js
```

Expected: FAIL，错误包含 `Cannot find module '../lib/workspace-markdown.js'`。

- [ ] **Step 3: 实现同步快照模块**

创建 `packages/jizhi-bridge/lib/workspace-markdown.js`：

```js
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'

export const MARKDOWN_FILES = Object.freeze([
  'AGENTS.md',
  'IDENTITY.md',
  'USER.md',
  'MEMORY.md',
  'SUMMARY.md'
])

export function normalizeWorkspaceCwd(cwd, pathApi = path) {
  if (typeof cwd !== 'string' || !pathApi.isAbsolute(cwd)) return undefined
  return pathApi.normalize(pathApi.resolve(cwd))
}

export function protectPromptBraces(text) {
  return text.replaceAll('{{', '{{jizhi_open}}')
}

function renderWorkspaceSection(files) {
  return MARKDOWN_FILES.flatMap((filename) => {
    const content = files[filename]
    if (typeof content !== 'string' || content.trim().length === 0) return []
    return [`## Jizhi workspace: ${filename}\n\n${protectPromptBraces(content)}`]
  }).join('\n\n')
}

function isEnoent(error) {
  return error && typeof error === 'object' && error.code === 'ENOENT'
}

export function refreshWorkspaceSnapshot(cwd, previous, options = {}) {
  const {
    pathApi = path,
    stat = statSync,
    readFile = readFileSync,
    warn = () => {}
  } = options
  const normalized = normalizeWorkspaceCwd(cwd, pathApi)
  if (normalized === undefined) {
    warn('jizhi bridge: Session cwd is missing or not absolute')
    return undefined
  }

  const systemDir = pathApi.join(normalized, '.jizhiagent')
  try {
    if (!stat(systemDir).isDirectory()) return undefined
  } catch (error) {
    if (!isEnoent(error)) warn(`jizhi bridge: cannot inspect system directory: ${String(error)}`)
    return undefined
  }

  const canReuse = previous?.cwd === normalized
  const files = {}
  for (const filename of MARKDOWN_FILES) {
    try {
      const content = readFile(pathApi.join(systemDir, filename), 'utf8')
      if (content.trim().length > 0) files[filename] = content
    } catch (error) {
      if (isEnoent(error)) continue
      warn(`jizhi bridge: cannot read ${filename}: ${String(error)}`)
      if (canReuse && Object.hasOwn(previous.files, filename)) {
        files[filename] = previous.files[filename]
      }
    }
  }

  return Object.freeze({
    cwd: normalized,
    systemDir,
    files: Object.freeze(files),
    text: renderWorkspaceSection(files)
  })
}
```

- [ ] **Step 4: 运行工作区测试确认通过**

Run:

```sh
corepack pnpm exec vitest run packages/jizhi-bridge/test/plugin.test.js
```

Expected: 3 tests PASS；渲染后的 `{{value}}` 与原 Markdown 完全一致。

- [ ] **Step 5: 提交 Markdown 快照模块**

```sh
git add packages/jizhi-bridge/lib/workspace-markdown.js packages/jizhi-bridge/test/plugin.test.js
git commit -m "feat: load jizhi workspace markdown snapshots"
```

### Task 3: 实现 Tool JSONL 转换、关联与原子写

**Files:**

- Create: `packages/jizhi-bridge/lib/tool-jsonl.js`
- Modify: `packages/jizhi-bridge/test/plugin.test.js`

**Interfaces:**

- Consumes: Task 2 的 `normalizeWorkspaceCwd()`、DSH `SessionEvent<'tool/call' | 'tool/result'>`、`attachments.readImage(ref)`。
- Produces: `isValidCallId(callId)`、`convertResultParts(resultEvent, attachments, warn)`、`writeToolJsonl(session, call, resultEvent, attachments, options)`、`createToolJsonlBridge({ attachments, warn, write })`；bridge 暴露 `{ observe(session, event), flush(session) }`。

- [ ] **Step 1: 写 callId、内容映射和关联失败测试**

向 `packages/jizhi-bridge/test/plugin.test.js` 增加 imports 与 fixture：

```js
import {
  convertResultParts,
  createToolJsonlBridge,
  isValidCallId,
  writeToolJsonl
} from '../lib/tool-jsonl.js'

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
```

再增加测试：

```js
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
})
```

- [ ] **Step 2: 运行定向测试确认 tool-jsonl 模块缺失**

Run:

```sh
corepack pnpm exec vitest run packages/jizhi-bridge/test/plugin.test.js -t "Jizhi tool JSONL"
```

Expected: FAIL，错误包含 `Cannot find module '../lib/tool-jsonl.js'`。

- [ ] **Step 3: 实现校验与 Eino result_parts 转换**

创建 `packages/jizhi-bridge/lib/tool-jsonl.js` 的第一部分：

```js
import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { normalizeWorkspaceCwd } from './workspace-markdown.js'

const MAX_CALL_ID_BYTES = 241

export function isValidCallId(callId) {
  return (
    typeof callId === 'string' &&
    callId.length > 0 &&
    callId.trim() === callId &&
    callId !== '.' &&
    callId !== '..' &&
    !/[\\/\0]/.test(callId) &&
    !(process.platform === 'win32' && /[<>:"|?*]/.test(callId)) &&
    Buffer.byteLength(callId, 'utf8') <= MAX_CALL_ID_BYTES
  )
}

function toolResultBlock(resultEvent) {
  return resultEvent.data.message.content.find((block) => block.type === 'tool-result')
}

function diagnostic(error) {
  return error instanceof Error ? error.message : String(error)
}

export async function convertResultParts(resultEvent, attachments, warn = () => {}) {
  const result = toolResultBlock(resultEvent)
  if (result === undefined) throw new Error('tool/result event has no tool-result block')
  const parts = []

  for (const block of result.content) {
    if (block.type === 'text') {
      parts.push({ type: 'text', text: block.text })
    } else if (block.type === 'reasoning') {
      parts.push({ type: 'text', text: block.text, extra: { dsh_type: 'reasoning' } })
    } else if (block.type === 'image') {
      try {
        const stored = await attachments.readImage(block.attachment)
        parts.push({
          type: 'image',
          image: {
            base64data: Buffer.from(stored.data).toString('base64'),
            mime_type: stored.ref.mediaType
          }
        })
      } catch (error) {
        warn(`jizhi bridge: cannot read image attachment: ${diagnostic(error)}`)
        parts.push({
          type: 'text',
          text: `[DSH image unavailable: ${diagnostic(error)}]`,
          extra: { dsh_type: 'image' }
        })
      }
    } else {
      parts.push({
        type: 'text',
        text: JSON.stringify(block),
        extra: { dsh_type: String(block.type) }
      })
    }
  }

  return {
    parts,
    isError: Boolean(result.isError || resultEvent.data.error)
  }
}
```

- [ ] **Step 4: 运行转换测试确认通过**

Run:

```sh
corepack pnpm exec vitest run packages/jizhi-bridge/test/plugin.test.js -t "Jizhi tool JSONL"
```

Expected: 3 tests PASS。

- [ ] **Step 5: 写原子双行文件与 no-create 失败测试**

继续向同一 describe 增加：

```js
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
```

同时把测试文件顶部的 fs/promises import 补充 `readdir` 与 `stat`。

- [ ] **Step 6: 实现安全目录检查和原子 rename**

继续在 `tool-jsonl.js` 中实现：

```js
async function ensureToolsDirectory(systemDir, fsApi) {
  const info = await fsApi.stat(systemDir)
  if (!info.isDirectory()) return undefined
  const toolsDir = path.join(systemDir, 'tools')
  try {
    await fsApi.mkdir(toolsDir)
  } catch (error) {
    if (!error || error.code !== 'EEXIST') throw error
    if (!(await fsApi.stat(toolsDir)).isDirectory()) throw error
  }
  return toolsDir
}

const defaultFs = { mkdir, rename, rm, stat, writeFile }

export async function writeToolJsonl(
  session,
  call,
  resultEvent,
  attachments,
  options = {}
) {
  const {
    fsApi = defaultFs,
    randomId = randomUUID,
    warn = () => {}
  } = options
  const cwd = normalizeWorkspaceCwd(session.header?.cwd)
  if (cwd === undefined || !isValidCallId(call?.callId)) {
    warn('jizhi bridge: invalid cwd or callId; skipping tool JSONL')
    return false
  }
  const result = toolResultBlock(resultEvent)
  if (result?.toolCallId !== call.callId) {
    warn('jizhi bridge: tool call/result id mismatch')
    return false
  }

  const systemDir = path.join(cwd, '.jizhiagent')
  let temporaryPath
  try {
    const toolsDir = await ensureToolsDirectory(systemDir, fsApi)
    if (toolsDir === undefined) return false
    const converted = await convertResultParts(resultEvent, attachments, warn)
    const payload = `${JSON.stringify({
      type: 'tool_call',
      call_id: call.callId,
      tool_name: call.name,
      arguments: call.arguments
    })}\n${JSON.stringify({
      type: 'tool_result',
      call_id: call.callId,
      result_parts: converted.parts,
      is_error: converted.isError
    })}\n`
    temporaryPath = path.join(toolsDir, `.dsh-jizhi-${process.pid}-${randomId()}.tmp`)
    await fsApi.writeFile(temporaryPath, payload, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await fsApi.rename(temporaryPath, path.join(toolsDir, `call_id_${call.callId}.jsonl`))
    return true
  } catch (error) {
    if (!error || error.code !== 'ENOENT') {
      warn(`jizhi bridge: cannot write tool JSONL: ${diagnostic(error)}`)
    }
    return false
  } finally {
    if (temporaryPath !== undefined) await fsApi.rm(temporaryPath, { force: true }).catch(() => {})
  }
}
```

这里必须使用非递归 `mkdir(toolsDir)`：若 `.jizhiagent` 在 `stat` 后被删除，创建 `tools` 会失败，而不会重建系统目录。

- [ ] **Step 7: 运行原子写测试确认通过**

Run:

```sh
corepack pnpm exec vitest run packages/jizhi-bridge/test/plugin.test.js -t "Jizhi tool JSONL"
```

Expected: 6 tests PASS；并行目标文件各自是完整两行，目录中无 `.tmp` 文件。

- [ ] **Step 8: 写关联回退、并行写和 flush 屏障失败测试**

继续增加：

```js
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
```

- [ ] **Step 9: 实现 Session 级 call map 与 pending set**

继续在 `tool-jsonl.js` 中实现：

```js
function findHistoricalCall(session, callId) {
  return session.events.findLast(
    (event) => event.type === 'tool/call' && event.data.callId === callId
  )?.data
}

export function createToolJsonlBridge({ attachments, warn = () => {}, write = writeToolJsonl }) {
  const calls = new WeakMap()
  const pending = new WeakMap()

  function callMap(session) {
    let map = calls.get(session)
    if (map === undefined) calls.set(session, (map = new Map()))
    return map
  }

  function pendingSet(session) {
    let set = pending.get(session)
    if (set === undefined) pending.set(session, (set = new Set()))
    return set
  }

  function observe(session, event) {
    if (event.type === 'tool/call') {
      callMap(session).set(event.data.callId, event.data)
      return
    }
    if (event.type !== 'tool/result') return
    const callId = toolResultBlock(event)?.toolCallId
    const map = callMap(session)
    const call = map.get(callId) ?? findHistoricalCall(session, callId)
    map.delete(callId)
    if (call === undefined) {
      warn(`jizhi bridge: missing tool/call for ${String(callId)}`)
      return
    }

    const set = pendingSet(session)
    let task
    task = Promise.resolve()
      .then(() => write(session, call, event, attachments, { warn }))
      .catch((error) => warn(`jizhi bridge: tool JSONL task failed: ${diagnostic(error)}`))
      .finally(() => set.delete(task))
    set.add(task)
  }

  async function flush(session) {
    const set = pending.get(session)
    if (set === undefined) return
    await Promise.allSettled([...set])
  }

  return { observe, flush }
}
```

- [ ] **Step 10: 运行全部模块测试确认通过**

Run:

```sh
corepack pnpm exec vitest run packages/jizhi-bridge/test/plugin.test.js
```

Expected: 11 tests PASS；缺失关联与写盘失败只产生 warning，`flush()` resolve。

- [ ] **Step 11: 提交 Tool JSONL 模块**

```sh
git add packages/jizhi-bridge/lib/tool-jsonl.js packages/jizhi-bridge/test/plugin.test.js
git commit -m "feat: write jizhi-compatible tool jsonl"
```

### Task 4: 装配 Cordis Host 生命周期并验证缓存边界

**Files:**

- Create: `packages/jizhi-bridge/index.js`
- Modify: `packages/jizhi-bridge/test/plugin.test.js`

**Interfaces:**

- Consumes: Task 2 的 `refreshWorkspaceSnapshot()`、Task 3 的 `createToolJsonlBridge()`、Cordis `ctx.systemPrompt` / `ctx.attachments` / events。
- Produces: Cordis exports `name === "dsh-jizhi-bridge"`、`inject === ["systemPrompt", "attachments"]`、`apply(ctx)`；注册 `jizhi_open`、`jizhi:workspace`、`agent/inbox/claimed`、`session/event`、`session/flush`。

- [ ] **Step 1: 写 Host 注册与每条用户消息缓存失败测试**

向测试文件增加：

```js
import { apply, inject, name } from '../index.js'

function hostFixture() {
  const handlers = new Map()
  const sections = new Map()
  const variables = new Map()
  const ctx = {
    attachments: { readImage: vi.fn() },
    logger: { warn: vi.fn() },
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
    }
  }
  return { ctx, handlers, sections, variables }
}

describe('Jizhi bridge Host plugin', () => {
  it('registers one Host-only prompt section and literal brace variable', () => {
    const fixture = hostFixture()
    apply(fixture.ctx)

    expect(name).toBe('dsh-jizhi-bridge')
    expect(inject).toEqual(['systemPrompt', 'attachments'])
    expect(fixture.sections.get('jizhi:workspace').order).toBe(50)
    expect(fixture.variables.get('jizhi_open')({})).toBe('{{')
    expect(fixture.handlers.has('agent/pre-step')).toBe(false)
    expect(fixture.handlers.has('agent/inbox/claimed')).toBe(true)
  })

  it('refreshes before the first request once per claimed real user message', async () => {
    const root = await temporaryRoot()
    const systemDir = path.join(root, '.jizhiagent')
    await mkdir(systemDir)
    await writeFile(path.join(systemDir, 'SUMMARY.md'), 'version one')
    const fixture = hostFixture()
    apply(fixture.ctx)
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
    apply(fixture.ctx)
    const agent = { session: { header: { cwd: root } } }

    fixture.handlers.get('agent/inbox/claimed')({
      agent,
      message: { source: { kind: 'user' } }
    })
    expect(fixture.sections.get('jizhi:workspace').text({ agent })).toBe('')
  })
})
```

- [ ] **Step 2: 运行 Host 测试并确认入口缺失**

Run:

```sh
corepack pnpm exec vitest run packages/jizhi-bridge/test/plugin.test.js -t "Jizhi bridge Host plugin"
```

Expected: FAIL，错误包含 `Cannot find module '../index.js'`。

- [ ] **Step 3: 实现最小 Cordis 装配**

创建 `packages/jizhi-bridge/index.js`：

```js
import { refreshWorkspaceSnapshot } from './lib/workspace-markdown.js'
import { createToolJsonlBridge } from './lib/tool-jsonl.js'

export const name = 'dsh-jizhi-bridge'
export const inject = ['systemPrompt', 'attachments']

export function apply(ctx) {
  const snapshots = new WeakMap()
  const warn = (message) => ctx.logger.warn(message)
  const toolJsonl = createToolJsonlBridge({ attachments: ctx.attachments, warn })

  ctx.systemPrompt.variable('jizhi_open', () => '{{')
  ctx.systemPrompt.section({
    name: 'jizhi:workspace',
    order: 50,
    text: ({ agent }) => agent === undefined ? '' : snapshots.get(agent)?.text ?? ''
  })

  ctx.on('agent/inbox/claimed', ({ agent, message }) => {
    if (message.source.kind !== 'user') return
    const next = refreshWorkspaceSnapshot(
      agent.session.header.cwd,
      snapshots.get(agent),
      { warn }
    )
    if (next === undefined) snapshots.delete(agent)
    else snapshots.set(agent, next)
  })

  ctx.on('session/event', (session, event) => {
    toolJsonl.observe(session, event)
  })
  ctx.on('session/flush', (session) => toolJsonl.flush(session))
}
```

- [ ] **Step 4: 增加 event 到 flush 的集成测试**

继续增加：

```js
  it('routes committed tool events to JSONL and awaits them on session flush', async () => {
    const root = await temporaryRoot()
    await mkdir(path.join(root, '.jizhiagent'))
    const fixture = hostFixture()
    apply(fixture.ctx)
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
```

- [ ] **Step 5: 运行插件全套测试确认通过**

Run:

```sh
corepack pnpm exec vitest run packages/jizhi-bridge/test
```

Expected: package 与 plugin tests 全部 PASS；第二次非用户 claim 后 section 文本逐字不变，证明同一 loop 不刷新。

- [ ] **Step 6: 提交 Host 装配**

```sh
git add packages/jizhi-bridge/index.js packages/jizhi-bridge/test/plugin.test.js
git commit -m "feat: connect jizhi bridge to DSH host events"
```

### Task 5: 完成中英文文档和双包 pack 校验

**Files:**

- Create: `packages/jizhi-bridge/README.md`
- Create: `packages/jizhi-bridge/README.zh.md`
- Modify: `README.md`
- Modify: `README.zh.md`
- Modify: `scripts/verify-pack.mjs`
- Modify: `packages/jizhi-bridge/test/package.test.js`

**Interfaces:**

- Consumes: Task 1 的精确 files 清单和 Tasks 2–4 的最终行为。
- Produces: 可复制的安装命令、缓存边界和 JSONL 契约说明；`pack:check` 同时验证 `desktop-temporary-workspace` 与 `jizhi-bridge`。

- [ ] **Step 1: 写实际执行 pack verifier 的失败断言**

人类 README 不做源码字符串测试；在 `package.test.js` 加入进程执行 imports、根目录解析和真实行为测试：

```js
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))
const execFileAsync = promisify(execFile)

it('verifies the packed contents of every published workspace package', async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    [path.join(repositoryRoot, 'scripts', 'verify-pack.mjs')],
    { cwd: repositoryRoot }
  )

  expect(stdout).toContain('desktop-temporary-workspace: pack contents verified')
  expect(stdout).toContain('jizhi-bridge: pack contents verified')
})
```

- [ ] **Step 2: 运行 package 测试确认根文档尚未登记**

Run:

```sh
corepack pnpm exec vitest run packages/jizhi-bridge/test/package.test.js
```

Expected: FAIL at `verifies the packed contents of every published workspace package`；旧 verifier 只输出 `pack contents verified`，没有两个带目录名的成功行。

- [ ] **Step 3: 写包级中英文 README**

`packages/jizhi-bridge/README.md` 必须包含以下实际内容：

````markdown
# @ywandy/dsh-jizhi-bridge

[中文](README.zh.md)

Host-only bridge between DeepSeek Harness and an existing Jizhi Agent workspace.

## Install

```sh
dsh plugin --profile web add @ywandy/dsh-jizhi-bridge
```

The bundle patch mounts the Host plugin automatically. No Client bundle or settings UI is included.

## Behavior

- Activates only when the Session's absolute `cwd` already contains a `.jizhiagent/` directory.
- Reads `AGENTS.md`, `IDENTITY.md`, `USER.md`, `MEMORY.md`, and `SUMMARY.md` in that fixed order.
- Refreshes once for each claimed message whose source is `user`; later model requests in the same Agent loop reuse the same prompt text for stable prefix caching.
- Writes each model-visible top-level tool call to `.jizhiagent/tools/call_id_<callId>.jsonl` after its committed result arrives.
- Records successful and failed text, reasoning, image, and extension blocks without changing the DSH tool result when bridging fails.

The plugin never creates `.jizhiagent/`. Internal Code Mode dispatches that are absent from DSH model history do not get separate files.

## Compatibility

Verified with Node.js 22.19+, Cordis 4.0.1, and DeepSeek Harness 0.1.0-rc.7.

## License

[MIT](LICENSE)
````

`packages/jizhi-bridge/README.zh.md` 使用同样结构，并明确写出：

````markdown
# @ywandy/dsh-jizhi-bridge

[English](README.md)

这是连接 DeepSeek Harness 与既有极智 Agent 工作区的纯 Host 插件。

## 安装

```sh
dsh plugin --profile web add @ywandy/dsh-jizhi-bridge
```

Bundle patch 会自动挂载 Host 插件；本包不包含 Client bundle 或设置页面。

## 行为

- 仅当 Session 的绝对 `cwd` 已存在 `.jizhiagent/` 目录时启用。
- 固定按 `AGENTS.md`、`IDENTITY.md`、`USER.md`、`MEMORY.md`、`SUMMARY.md` 顺序加载。
- 每条被 Agent 领取且来源为 `user` 的消息刷新一次；同一 Agent Loop 的后续模型请求复用完全相同的提示词，保持前缀缓存稳定。
- 在最终结果提交后，把模型可见的顶层工具调用写入 `.jizhiagent/tools/call_id_<callId>.jsonl`。
- 成功、失败、文本、reasoning、图片和扩展 block 都会记录；桥接失败不会改变 DSH 工具结果。

插件永远不会创建 `.jizhiagent/`。未进入 DSH 模型历史的 Code Mode 内部 dispatch 不会生成独立文件。

## 兼容范围

已验证 Node.js 22.19+、Cordis 4.0.1 和 DeepSeek Harness 0.1.0-rc.7。

## 许可证

[MIT](LICENSE)
````

- [ ] **Step 4: 更新根 README 插件表和安装示例**

在两个根 README 的插件表各增加一行：

```markdown
| [`@ywandy/dsh-jizhi-bridge`](packages/jizhi-bridge/README.md) | Loads Jizhi workspace Markdown and writes Jizhi-compatible tool JSONL for model-visible DSH calls. | Unmodified DSH Desktop with `@deepseek-ai/dsh@0.1.0-rc.7` |
```

```markdown
| [`@ywandy/dsh-jizhi-bridge`](packages/jizhi-bridge/README.zh.md) | 加载极智工作区 Markdown，并为 DSH 模型可见工具调用写入极智兼容 JSONL。 | 使用 `@deepseek-ai/dsh@0.1.0-rc.7` 的未修改 DSH Desktop |
```

把两个安装命令同时列在各自 `Install` / `安装` 代码块中：

```sh
dsh plugin --profile web add @ywandy/dsh-desktop-temporary-workspace
dsh plugin --profile web add @ywandy/dsh-jizhi-bridge
```

- [ ] **Step 5: 把 pack verifier 改为数据驱动的双包校验**

在 `scripts/verify-pack.mjs` 中用以下结构替换单一 `packageDirectory` / `expected`，现有 `packEnvironment` 过滤保持在循环之前：

```js
const packageChecks = [
  {
    directory: 'desktop-temporary-workspace',
    expected: new Set([
      'LICENSE',
      'README.md',
      'README.zh.md',
      'client.js',
      'cordis.patch.yml',
      'index.js',
      'package.json'
    ])
  },
  {
    directory: 'jizhi-bridge',
    expected: new Set([
      'LICENSE',
      'README.md',
      'README.zh.md',
      'cordis.patch.yml',
      'index.js',
      'lib/tool-jsonl.js',
      'lib/workspace-markdown.js',
      'package.json'
    ])
  }
]
```

把单次 `npm pack` 与差集校验替换为：

```js
let failed = false
for (const { directory, expected } of packageChecks) {
  const packageDirectory = path.join(repositoryRoot, 'packages', directory)
  const output = execFileSync(
    'npm',
    ['pack', packageDirectory, '--dry-run', '--json'],
    { cwd: repositoryRoot, encoding: 'utf8', env: packEnvironment }
  )
  const [result] = JSON.parse(output)
  if (!result || !Array.isArray(result.files)) {
    throw new Error(`${directory}: npm pack did not return a file list`)
  }

  const actual = new Set(result.files.map(({ path: filePath }) => filePath))
  const missing = [...expected].filter((filePath) => !actual.has(filePath)).sort()
  const unexpected = [...actual].filter((filePath) => !expected.has(filePath)).sort()
  if (missing.length > 0 || unexpected.length > 0) {
    failed = true
    if (missing.length > 0) console.error(`${directory} missing: ${missing.join(', ')}`)
    if (unexpected.length > 0) console.error(`${directory} unexpected: ${unexpected.join(', ')}`)
  } else {
    console.log(`${directory}: pack contents verified`)
  }
}
if (failed) process.exitCode = 1
```

- [ ] **Step 6: 运行 package 和 pack 测试确认通过**

Run:

```sh
corepack pnpm exec vitest run packages/jizhi-bridge/test/package.test.js
corepack pnpm pack:check
```

Expected: package tests PASS；输出同时包含 `desktop-temporary-workspace: pack contents verified` 与 `jizhi-bridge: pack contents verified`。

- [ ] **Step 7: 提交文档和发布校验**

```sh
git add packages/jizhi-bridge/README.md packages/jizhi-bridge/README.zh.md packages/jizhi-bridge/test/package.test.js README.md README.zh.md scripts/verify-pack.mjs
git commit -m "docs: document jizhi bridge installation"
```

### Task 6: 全量验证、人工 Smoke Test 与最终单提交整理

**Files:**

- Verify: `packages/jizhi-bridge/**`
- Verify: `README.md`
- Verify: `README.zh.md`
- Verify: `scripts/verify-pack.mjs`
- Verify: `pnpm-lock.yaml`
- Verify unchanged: `/Users/yewei/yyw/4399/project/jizhi_ai/**`

**Interfaces:**

- Consumes: Tasks 1–5 的全部产物。
- Produces: 通过插件定向测试、全仓测试、pack 检查和人工验收的单个计划 Commit。

- [ ] **Step 1: 运行定向、全仓与 pack 验证**

```sh
corepack pnpm exec vitest run packages/jizhi-bridge/test
corepack pnpm test
corepack pnpm pack:check
```

Expected: 三条命令 exit `0`；全仓现有 `desktop-temporary-workspace` 测试无回归。

- [ ] **Step 2: 扫描包内动态 prompt、临时文件和越界产物**

```sh
rg -n "Date\(|new Date|timestamp|\.jizhiagent.*recursive: true|agent/pre-step" packages/jizhi-bridge
find packages/jizhi-bridge -name '*.tmp' -o -name 'call_id_*.jsonl'
git status --short
```

Expected: 第一条无匹配，证明 prompt 无时间戳且没有错误 hook/递归系统目录创建；第二条无输出；`git status` 只显示本计划列出的实现和文档文件。

- [ ] **Step 3: 进行本地安装 Smoke Test**

使用本地包路径安装：

```sh
dsh plugin --profile web add /Users/yewei/yyw/project/dsh-plugins/packages/jizhi-bridge
```

依次人工验证并记录结果：

1. 在不含 `.jizhiagent` 的普通工作区发送消息，确认 prompt 无 `jizhi:workspace` 内容且磁盘未创建 `.jizhiagent`。
2. 在既有极智工作区发送一条用户消息，从模型请求日志确认五个 Markdown 按固定顺序出现。
3. 让同一轮至少执行一个工具，确认后续模型请求中的 Jizhi section 与首请求逐字相同。
4. 在工具执行期间修改 `SUMMARY.md`，确认当前轮不变；发送下一条用户消息后确认新内容生效。
5. 执行一个成功工具和一个失败工具，确认各自 JSONL 恰好两行、末尾有换行、原始 arguments 未重排，并分别写出 `is_error: false` / `true`。
6. 关闭或切换 Session 触发 flush，确认已调度的图片或大文本结果完成写入且无残留 `.tmp`。

- [ ] **Step 4: 确认极智仓库没有被本任务触碰**

```sh
git -C /Users/yewei/yyw/4399/project/jizhi_ai status --short
```

Expected: 输出与实施开始前记录的基线完全一致；若该仓库原先已有用户修改，只报告这些既有修改，不清理、不暂存、不提交。

- [ ] **Step 5: 评审最终 diff 与提交边界**

```sh
git diff --check
git diff --stat 5ce86cb
git log --oneline 5ce86cb..HEAD
```

Expected: `git diff --check` 无输出；diff 只涉及本计划列出的规格、计划、插件包、根 README、pack 脚本和 lockfile。

- [ ] **Step 6: squash 为一个计划 Commit**

本步骤按仓库约定在所有 Task 与最终评审完成后执行：

```sh
git reset --soft 5ce86cb
git commit -m "feat: add DSH Jizhi bridge plugin"
git log --oneline 5ce86cb..HEAD
```

Expected: 最后一条命令只显示一个 `feat: add DSH Jizhi bridge plugin`；该提交同时包含设计、实现计划、实现、测试和文档。

---

## 最终验收清单

- [ ] 普通 DSH 工作区没有 prompt 注入、目录创建或 JSONL 写入。
- [ ] 真实用户消息在 `agent/inbox/claimed` 时刷新，首请求读取新快照；后续 loop step 不读盘且 prompt 前缀稳定。
- [ ] 五个 Markdown 固定排序，空/缺失文件省略，非 `ENOENT` 保留旧值，`{{` 最终逐字恢复。
- [ ] `tool/call` 原始 arguments 与最终 `tool/result` 精确关联，成功和失败都生成完整双行文件。
- [ ] text、reasoning、image 和未知 block 保序转换；附件失败退化为可诊断 text part。
- [ ] 非法 `callId`、缺失 call、目录消失和写盘失败只 warning，不改变 DSH 主流程。
- [ ] `session/flush` 等待当前 Session 已调度任务 settle，但桥接失败不使主 flush 失败。
- [ ] manifest、Host-only bundle、Cordis patch、根 README、lockfile 与 tarball 文件集合一致。
- [ ] 定向测试、全仓测试、pack 检查和人工 Smoke Test 通过。
- [ ] `jizhi_ai` 仓库状态与实施前基线一致。
- [ ] 分支相对 `5ce86cb` 最终只有一个计划 Commit。
