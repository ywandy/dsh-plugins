# 默认执行目录虚拟 Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `@ywandy/dsh-desktop-temporary-workspace` 升级为兼容原始 DSH Desktop `origin/main` 的默认执行目录插件，让用户从输入框顶部 Workspace 按钮创建共用固定目录的未分组 Session。

**Architecture:** Host 提供幂等 Ensure 接口，只确保配置的固定绝对目录存在。Client 以 priority `-10` 影子注册 `conversation.hero.workspace` Picker，在保留真实 Workspace 和本地目录添加流程的同时加入虚拟“默认执行目录”项；选择虚拟项时直接调用 `sessions.create({ cwd })`，绝不注册 Workspace。stock Picker 保留在 priority `0` 作为失败回退。

**Tech Stack:** Node.js 22.19+/24、ES Modules、Cordis、DeepSeek Harness `0.1.0-rc.7`、React 18 Client bundle、`@deepseek-ai/dsh-client-ui-primitives`、Schemastery、Vitest 3、pnpm 11.7.0。

## Global Constraints

- 只修改 `/Users/yewei/yyw/project/dsh-plugins`；不得修改 `dsh-desktop` 的源码、补丁、依赖或 lockfile。
- npm 包名、目录、Cordis ID、settings namespace 和 Bundle 安装方式保持为 `@ywandy/dsh-desktop-temporary-workspace`、`packages/desktop-temporary-workspace`、`dsh-desktop-temporary-workspace`、`desktop-temporary-workspace` 与 `dsh plugin --profile web add @ywandy/dsh-desktop-temporary-workspace`。
- npm 版本从当前分支的 `0.1.1` 提升到 `0.2.0`，README 必须说明这是从 `0.1.x` 升级的破坏性目录生命周期变化。
- 默认目录精确为 `<DSH_HOME>/default-workspace`；已保存的 `rootDirectory` 覆盖值直接成为共享目录，不再创建日期子目录。
- 默认 Session 创建必须只调用 `sessions.create({ cwd })` 和 `sessions.open(id)`；不得调用 `workspaces.create` 或传入 `workspaceId`。
- Picker 必须使用 single-slot priority `-10`，并保留 stock priority `0` 回退候选。
- 所有新行为按 Red-Green-Refactor 实施；每个生产改动前必须先运行对应失败测试。
- 发布 npm、创建 GitHub Release 和 Awesome 列表 PR 不在本计划范围内。
- 全部任务与最终评审完成后、合并目标分支前，将本功能的实现提交 squash 为一个计划 Commit。

---

## 文件职责与改动地图

- `packages/desktop-temporary-workspace/index.js`：Host 配置、目录规范化、幂等 Ensure、同源接口和 Cordis 注册。
- `packages/desktop-temporary-workspace/client.js`：Client Ensure 请求、默认 Session 创建、虚拟 Picker、真实 Workspace/目录添加、设置卡和 Slot 注册。
- `packages/desktop-temporary-workspace/test/plugin.test.js`：Host、Client 纯行为、Slot 注册与错误路径测试。
- `packages/desktop-temporary-workspace/test/package.test.js`：版本、Bundle、Client 注入、peer dependencies 与发布白名单测试。
- `packages/desktop-temporary-workspace/package.json`：`0.2.0` manifest、包描述和 primitives peer 依赖声明；`dsh.client.inject` 只声明 Cordis Client 插件，不加入零 Cordis 的 primitives 模块。
- `packages/desktop-temporary-workspace/README.md`、`README.zh.md`：安装、默认目录、Picker、共享文件语义和升级说明。
- `README.md`、`README.zh.md`：仓库级插件摘要与兼容性说明。
- `pnpm-lock.yaml`：manifest peer 变化产生的唯一必要 lockfile 更新。
- `scripts/verify-pack.mjs`：发布文件集合保持不变；只在测试证明现有集合不足时修改。

### Task 1: 将 Host 改为幂等默认目录 Ensure

**Files:**
- Modify: `packages/desktop-temporary-workspace/index.js`
- Test: `packages/desktop-temporary-workspace/test/plugin.test.js`

**Interfaces:**
- Consumes: `rootDirectory: string` settings 字段、现有 `isTrustedRequest(req, mutation)` 与 `sendJson`。
- Produces: `ENSURE_PATH = '/dsh-desktop/default-workspace/ensure'`、`defaultRootDirectory(home): string`、`ensureDefaultDirectory(directory): Promise<string>`、`handleEnsureRequest(req, res, rootDirectory: () => string): Promise<void>`。

- [ ] **Step 1: 把 Host 路径和目录生命周期测试改为预期的新行为**

在 `plugin.test.js` 的 import 中移除 `formatDirectoryName`、`createTemporaryDirectory`、`CREATE_PATH`、`handleCreateRequest`，加入：

```js
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
```

删除日期命名和冲突后缀测试；把旧 create route describe 改名并用以下 Ensure 测试替换其中的 create 专属断言。原 `accepts same-origin loopback requests only` 测试原样保留；原“configured root cannot be created”测试改为调用 `handleEnsureRequest(request(), res, () => root)`，继续断言普通文件占位返回结构化 `500`。

```js
describe('default workspace directory', () => {
  it('places the shared default directory below DSH_HOME', () => {
    expect(defaultRootDirectory('/dsh-home')).toBe(
      path.join('/dsh-home', 'default-workspace')
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

  it('ensures the configured directory and ignores caller path data', async () => {
    const parent = await temporaryRoot()
    const configured = path.join(parent, 'configured')
    const req = request()
    req.body = { rootDirectory: path.join(parent, 'caller-controlled') }
    const res = response()

    await handleEnsureRequest(req, res, () => configured)

    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ path: configured })
    expect((await stat(configured)).isDirectory()).toBe(true)
    await expect(stat(req.body.rootDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects non-POST methods before touching the directory', async () => {
    const directory = path.join(await temporaryRoot(), 'default')
    const res = response()

    await handleEnsureRequest(request({}, '127.0.0.1', 'GET'), res, () => directory)

    expect(res.status).toBe(405)
    await expect(stat(directory)).rejects.toMatchObject({ code: 'ENOENT' })
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
```

- [ ] **Step 2: 运行 Host 定向测试并确认因旧 API 失败**

Run:

```bash
pnpm exec vitest run packages/desktop-temporary-workspace/test/plugin.test.js -t "default workspace"
```

Expected: FAIL，报告 `ENSURE_PATH`、`ensureDefaultDirectory` 或 `handleEnsureRequest` 未导出，且旧默认路径仍为 `temporary-workspaces`。

- [ ] **Step 3: 实现固定目录和 Ensure 接口**

在 `index.js` 中删除 `pad`、`formatDirectoryName`、`createTemporaryDirectory`、`CREATE_PATH` 与 `handleCreateRequest`，用以下实现替换：

```js
export const ENSURE_PATH = '/dsh-desktop/default-workspace/ensure'

export function defaultRootDirectory(home = dshHome()) {
  return path.join(home, 'default-workspace')
}

export async function ensureDefaultDirectory(directory) {
  const normalized = normalizeRootDirectory(directory)
  await mkdir(normalized, { recursive: true })
  return normalized
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
```

把 `apply()` 的 route 注册改为：

```js
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
```

同时把校验错误文本从 `temporary workspace root` 改为 `default workspace directory`。

- [ ] **Step 4: 运行完整 Host 相关测试并确认通过**

Run:

```bash
pnpm exec vitest run packages/desktop-temporary-workspace/test/plugin.test.js -t "default workspace|host configuration|accepts same-origin"
```

Expected: PASS；同源限制、相对路径拒绝、普通文件占位导致 `500` 的既有测试继续通过。

- [ ] **Step 5: 提交 Host 变更**

```bash
git add packages/desktop-temporary-workspace/index.js packages/desktop-temporary-workspace/test/plugin.test.js
git commit -m "feat: reuse a shared default workspace directory"
```

### Task 2: 增加 Client Ensure 与未分组 Session 编排

**Files:**
- Modify: `packages/desktop-temporary-workspace/client.js`
- Test: `packages/desktop-temporary-workspace/test/plugin.test.js`

**Interfaces:**
- Consumes: Task 1 的 `POST /dsh-desktop/default-workspace/ensure`，以及 `sessions.create({ cwd }): Promise<string>`、`sessions.open(id): void`。
- Produces: `ensureDefaultWorkspace(fetchImpl): Promise<string>`、`openDefaultSession({ ensure, createSession, openSession }): Promise<string>`。

- [ ] **Step 1: 为 Ensure 请求和 Session 调用顺序编写失败测试**

在 Client 测试组加入：

```js
it('ensures the shared directory through the fixed Host endpoint', async () => {
  const calls = []
  const client = await loadClientBundle()
  const path = await client.ensureDefaultWorkspace(async (...args) => {
    calls.push(args)
    return {
      ok: true,
      status: 200,
      json: async () => ({ path: '/tmp/default-workspace' })
    }
  })

  expect(path).toBe('/tmp/default-workspace')
  expect(calls).toEqual([[
    '/dsh-desktop/default-workspace/ensure',
    { method: 'POST', headers: { accept: 'application/json' } }
  ]])
})

it('creates and opens an ungrouped Session with only cwd', async () => {
  const client = await loadClientBundle()
  const calls = []

  const id = await client.openDefaultSession({
    ensure: async () => {
      calls.push(['ensure'])
      return '/tmp/default-workspace'
    },
    createSession: async (input) => {
      calls.push(['create', input])
      return 'session-1'
    },
    openSession: (sessionId) => {
      calls.push(['open', sessionId])
    }
  })

  expect(id).toBe('session-1')
  expect(calls).toEqual([
    ['ensure'],
    ['create', { cwd: '/tmp/default-workspace' }],
    ['open', 'session-1']
  ])
})

it('does not open a Session when ensure or create fails', async () => {
  const client = await loadClientBundle()
  const opened = []

  await expect(client.openDefaultSession({
    ensure: async () => { throw new Error('disk unavailable') },
    createSession: async () => 'not-created',
    openSession: (id) => opened.push(id)
  })).rejects.toThrow('disk unavailable')

  await expect(client.openDefaultSession({
    ensure: async () => '/tmp/default-workspace',
    createSession: async () => { throw new Error('session failed') },
    openSession: (id) => opened.push(id)
  })).rejects.toThrow('session failed')

  expect(opened).toEqual([])
})

it('rejects Host errors and malformed Ensure success payloads', async () => {
  const client = await loadClientBundle()

  await expect(client.ensureDefaultWorkspace(async () => ({
    ok: false,
    status: 500,
    json: async () => ({ error: 'disk is read-only' })
  }))).rejects.toThrow('disk is read-only')

  await expect(client.ensureDefaultWorkspace(async () => ({
    ok: true,
    status: 200,
    json: async () => ({})
  }))).rejects.toThrow('did not contain a path')
})
```

以上测试同时替换原先调用 `createTemporaryWorkspace` 的成功、Host 错误和 malformed payload 测试，确保测试文件不再引用旧 Client API。

- [ ] **Step 2: 运行定向测试并确认新 Client API 缺失**

Run:

```bash
pnpm exec vitest run packages/desktop-temporary-workspace/test/plugin.test.js -t "ensures the shared|ungrouped Session|does not open|malformed Ensure"
```

Expected: FAIL，报告 `ensureDefaultWorkspace` 或 `openDefaultSession` 不存在。

- [ ] **Step 3: 实现 Client 请求和纯编排函数**

在 `client.js` 中把 `CREATE_PATH` 与 `createTemporaryWorkspace` 替换为：

```js
const ENSURE_PATH = '/dsh-desktop/default-workspace/ensure'

async function ensureDefaultWorkspace(fetchImpl = (...args) => window.fetch(...args)) {
  const response = await fetchImpl(ENSURE_PATH, {
    method: 'POST',
    headers: { accept: 'application/json' }
  })
  let payload
  try {
    payload = await response.json()
  } catch {
    payload = undefined
  }
  if (!response.ok) {
    throw new Error(
      typeof payload?.error === 'string' && payload.error !== ''
        ? payload.error
        : `Default workspace request failed with ${response.status}.`
    )
  }
  if (typeof payload?.path !== 'string' || payload.path === '') {
    throw new Error('Default workspace response did not contain a path.')
  }
  return payload.path
}

async function openDefaultSession({ ensure, createSession, openSession }) {
  const cwd = await ensure()
  const sessionId = await createSession({ cwd })
  openSession(sessionId)
  return sessionId
}
```

在 bundle 导出区加入：

```js
exports.ensureDefaultWorkspace = ensureDefaultWorkspace
exports.openDefaultSession = openDefaultSession
```

- [ ] **Step 4: 运行 Client 编排测试并确认通过**

Run:

```bash
pnpm exec vitest run packages/desktop-temporary-workspace/test/plugin.test.js -t "ensures the shared|ungrouped Session|does not open|malformed Ensure"
```

Expected: PASS；Host 错误文本和缺少 path 的响应仍被拒绝。

- [ ] **Step 5: 提交 Client 编排**

```bash
git add packages/desktop-temporary-workspace/client.js packages/desktop-temporary-workspace/test/plugin.test.js
git commit -m "feat: create ungrouped sessions in the default directory"
```

### Task 3: 用 priority shadow 实现虚拟 Workspace Picker

**Files:**
- Modify: `packages/desktop-temporary-workspace/client.js`
- Modify: `packages/desktop-temporary-workspace/package.json`
- Modify: `pnpm-lock.yaml`
- Test: `packages/desktop-temporary-workspace/test/plugin.test.js`
- Test: `packages/desktop-temporary-workspace/test/package.test.js`

**Interfaces:**
- Consumes: Task 2 的 `ensureDefaultWorkspace`、`openDefaultSession`；stock owner props `open`、`anchorRef`、`selectedId`、`onPick`、`onClose`、`useWorkspaces`；`ctx.workspaces.pickDirectory/create` 与 `window.dshDesktopDirectoryPicker.pick()`。
- Produces: `DEFAULT_OPTION_ID = 'default-workspace'`、`ADD_OPTION_ID = 'add-workspace'`、`buildPickerItems(workspaces, busy, t)`、`pickLocalWorkspace({ pickDirectory, createWorkspace, onPick })`、`runSingleFlight(lock, action): Promise<boolean>`、priority `-10` 的 `DefaultWorkspacePicker` 注册。

- [ ] **Step 1: 扩展 VM 依赖桩并为纯 Picker 行为编写失败测试**

在 `loadClientBundle` 的 require 回调中增加 primitives 桩：

```js
if (id === '@deepseek-ai/dsh-client-ui-primitives') {
  const passthrough = (props) => React.createElement('primitive-probe', props)
  return {
    Button: passthrough,
    IconFolderClose16: passthrough,
    IconPlusOutline16: passthrough,
    Menu: passthrough,
    Modal: passthrough
  }
}
```

同时把 Vitest import 改为：

```js
import { afterEach, describe, expect, it, vi } from 'vitest'
```

加入纯行为测试：

```js
it('builds the virtual default option before real Workspaces', async () => {
  const client = await loadClientBundle()
  const items = client.buildPickerItems([
    { workspaceId: 'workspace-1', title: 'Project A' }
  ], false, (key) => key)

  expect(items).toEqual([
    { id: 'default-workspace', label: 'defaultWorkspace', disabled: false },
    { id: 'workspace-1', label: 'Project A', disabled: false }
  ])
})

it('creates a real Workspace only for the local directory flow', async () => {
  const client = await loadClientBundle()
  const calls = []

  const createdId = await client.pickLocalWorkspace({
    pickDirectory: async () => '/tmp/project',
    createWorkspace: async (input) => {
      calls.push(['createWorkspace', input])
      return { workspaceId: 'workspace-2' }
    },
    onPick: (id) => calls.push(['onPick', id])
  })

  expect(createdId).toBe('workspace-2')
  expect(calls).toEqual([
    ['createWorkspace', { path: '/tmp/project' }],
    ['onPick', 'workspace-2']
  ])
})

it('treats local directory cancellation as a no-op', async () => {
  const client = await loadClientBundle()
  const calls = []
  const result = await client.pickLocalWorkspace({
    pickDirectory: async () => null,
    createWorkspace: async (input) => calls.push(input),
    onPick: (id) => calls.push(id)
  })

  expect(result).toBeNull()
  expect(calls).toEqual([])
})

it('admits only one action while a picker action is in flight', async () => {
  const client = await loadClientBundle()
  const lock = { current: false }
  const calls = []
  let release
  const pending = new Promise((resolve) => { release = resolve })

  const first = client.runSingleFlight(lock, async () => {
    calls.push('first')
    await pending
  })
  const second = client.runSingleFlight(lock, async () => {
    calls.push('second')
  })

  await expect(second).resolves.toBe(false)
  expect(calls).toEqual(['first'])
  release()
  await expect(first).resolves.toBe(true)
  expect(lock.current).toBe(false)
})
```

- [ ] **Step 2: 为 Slot shadow 和注入面编写失败测试**

把旧 `registers ordered sources` 测试替换为一个构造 fake ctx 的测试，保留现有 settings scope 桩，并加入 `sessions`、`workspaces`：

```js
it('shadows only the hero Workspace Picker at priority -10', async () => {
  const client = await loadClientBundle()
  const entries = []
  const ctx = createClientContextFixture(entries)

  client.apply(ctx)

  const picker = entries.find((entry) =>
    entry.options.name === 'conversation.hero.workspace'
  )
  expect(picker.options.priority).toBe(-10)
  expect(picker.options.locale).toBe('desktop.temporaryWorkspace')
  expect(picker.options.inject).toBeTypeOf('function')
  expect(picker.component).toBe(client.DefaultWorkspacePicker)
  expect(entries.some((entry) =>
    entry.options.name === 'sidebar.workspaces'
  )).toBe(false)

  const injected = picker.options.inject()
  expect(injected.ensure).toBeTypeOf('function')
  expect(injected.createSession).toBeTypeOf('function')
  expect(injected.openSession).toBeTypeOf('function')
  expect(injected.pickDirectory).toBeTypeOf('function')
  expect(injected.createWorkspace).toBeTypeOf('function')
})
```

在测试文件中加入以下 fixture；它让 `slots.inject()` 立即执行回调，让测试直接观察注册结果，同时提供 Client `inject` 声明所需的真实 service shape：

```js
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
      create: vi.fn(async ({ path }) => ({ workspaceId: path }))
    },
    effect: (install) => install()
  }
}
```

- [ ] **Step 3: 运行 Picker 测试并确认新函数和 shadow 注册缺失**

Run:

```bash
pnpm exec vitest run packages/desktop-temporary-workspace/test/plugin.test.js -t "virtual default|local directory|one action|shadows only"
```

Expected: FAIL，报告 `buildPickerItems`、`pickLocalWorkspace`、`runSingleFlight` 或 `DefaultWorkspacePicker` 不存在，或仍注册旧 `*.createSource`。

- [ ] **Step 4: 引入 primitives 并实现 Picker 的纯函数**

在 `client.js` factory 顶部加入：

```js
const {
  Button,
  IconFolderClose16,
  IconPlusOutline16,
  Menu,
  Modal
} = require('@deepseek-ai/dsh-client-ui-primitives')

const DEFAULT_OPTION_ID = 'default-workspace'
const ADD_OPTION_ID = 'add-workspace'

function buildPickerItems(workspaces, busy, t) {
  return [
    { id: DEFAULT_OPTION_ID, label: t('defaultWorkspace'), disabled: busy },
    ...workspaces.map((workspace) => ({
      id: workspace.workspaceId,
      label: workspace.title,
      disabled: busy
    }))
  ]
}

async function pickLocalWorkspace({ pickDirectory, createWorkspace, onPick }) {
  const path = await pickDirectory()
  if (path === null) return null
  const workspace = await createWorkspace({ path })
  onPick(workspace.workspaceId)
  return workspace.workspaceId
}

async function runSingleFlight(lock, action) {
  if (lock.current) return false
  lock.current = true
  try {
    await action()
    return true
  } finally {
    lock.current = false
  }
}
```

导出 `buildPickerItems`、`pickLocalWorkspace`、`runSingleFlight`、`DEFAULT_OPTION_ID` 和 `ADD_OPTION_ID` 供测试使用。

- [ ] **Step 5: 实现可回退、可重试的 Picker 组件**

在设置卡之前加入以下组件；使用 Menu 的 portal/getAnchorRect 契约与 Modal 错误面，不创建自定义全局 DOM：

```js
function DefaultWorkspacePicker({
  open,
  anchorRef,
  selectedId,
  onPick,
  onClose,
  useWorkspaces,
  ensure,
  createSession,
  openSession,
  pickDirectory,
  createWorkspace,
  t
}) {
  const snapshot = useWorkspaces((state) => state)
  const [busy, setBusy] = React.useState(false)
  const busyRef = React.useRef(false)
  const [error, setError] = React.useState(null)
  const [retry, setRetry] = React.useState(null)
  const getAnchorRect = React.useCallback(
    () => anchorRef?.current?.getBoundingClientRect() ?? null,
    [anchorRef]
  )
  const items = buildPickerItems(snapshot.items, busy, t).map((item) => ({
    ...item,
    icon: item.id === DEFAULT_OPTION_ID
      ? React.createElement('span', { 'aria-hidden': true }, '✦')
      : React.createElement(IconFolderClose16, { size: 16 })
  }))
  const footer = [{
    id: ADD_OPTION_ID,
    label: t('addWorkspace'),
    icon: React.createElement(IconPlusOutline16, { size: 16 }),
    disabled: busy
  }]

  const run = async (action) => {
    await runSingleFlight(busyRef, async () => {
      setBusy(true)
      setError(null)
      try {
        await action()
        setRetry(null)
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason))
        setRetry(() => action)
      } finally {
        setBusy(false)
      }
    })
  }

  const handleSelect = (id) => {
    if (id === DEFAULT_OPTION_ID) {
      onClose()
      void run(() => openDefaultSession({ ensure, createSession, openSession }))
      return
    }
    if (id === ADD_OPTION_ID) {
      onClose()
      void run(() => pickLocalWorkspace({ pickDirectory, createWorkspace, onPick }))
      return
    }
    onPick(id)
  }

  return React.createElement(
    React.Fragment,
    null,
    React.createElement(Menu, {
      open,
      anchor: null,
      items,
      footer,
      selectedId,
      onSelect: handleSelect,
      onClose,
      side: 'bottom',
      portal: true,
      getAnchorRect
    }),
    React.createElement(
      Modal,
      {
        open: error !== null,
        onClose: () => setError(null),
        closeLabel: t('close'),
        title: t('createFailed'),
        footer: React.createElement(
          React.Fragment,
          null,
          React.createElement(
            Button,
            { variant: 'outline', onClick: () => setError(null) },
            t('close')
          ),
          React.createElement(
            Button,
            {
              variant: 'primary',
              disabled: retry === null || busy,
              onClick: () => {
                setError(null)
                if (retry !== null) void run(retry)
              }
            },
            t('retry')
          )
        )
      },
      React.createElement('div', { role: 'alert' }, error)
    )
  )
}
```

导出 `DefaultWorkspacePicker`。

- [ ] **Step 6: 用 priority -10 注册 shadow Picker 并删除旧 create-source 注册**

把 Client `inject` 改为：

```js
const inject = ['slots', 'locale', 'settingsScope', 'sessions', 'workspaces']
```

在 `apply(ctx)` 中删除 `sourceOptions` 和两个 `*.createSource` 注册，加入：

```js
const pickDirectory = () => {
  const bridge = window.dshDesktopDirectoryPicker
  if (bridge && typeof bridge.pick === 'function') return bridge.pick()
  return ctx.workspaces.pickDirectory()
}

ctx.slots.inject('conversation.hero.workspace', () =>
  ctx.slots.register(
    {
      name: 'conversation.hero.workspace',
      priority: -10,
      locale: NS,
      inject: () => ({
        ensure: () => ensureDefaultWorkspace(),
        createSession: (input) => ctx.sessions.create(input),
        openSession: (id) => ctx.sessions.open(id),
        pickDirectory,
        createWorkspace: (input) => ctx.workspaces.create(input)
      })
    },
    DefaultWorkspacePicker
  )
)
```

Picker component 只从 `locale: NS` 提供的 standard props 取得 `t`，inject face 不重复提供 `t`。

- [ ] **Step 7: 更新 manifest 的 peer 声明并刷新 lockfile**

在 `package.json` 的 `peerDependencies` 加入：

```json
"@deepseek-ai/dsh-client-ui-primitives": "^0.1.0-rc.7"
```

不要把 `@deepseek-ai/dsh-client-ui-primitives` 加入 `dsh.client.inject`：它是由 Client Module Loader 解析的零 Cordis 静态模块，不提供可等待的 Client 插件 fiber。既有 `@deepseek-ai/dsh-client-ui-workspace` inject edge 保证 stock Workspace UI 先激活并声明 Slot。

在 `package.test.js` 的 Client contract 测试加入：

```js
expect(manifest.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-workspace')
expect(manifest.dsh.client.inject).not.toContain('@deepseek-ai/dsh-client-ui-primitives')
expect(manifest.peerDependencies).toMatchObject({
  '@deepseek-ai/dsh-client-ui-primitives': '^0.1.0-rc.7'
})
```

Run:

```bash
corepack pnpm install --lockfile-only
```

Expected: `pnpm-lock.yaml` 只出现新增 peer 关系的必要变化，无 `dsh-desktop` 文件变化；`dsh.client.inject` 不出现 primitives。

- [ ] **Step 8: 运行 Picker、manifest 和完整插件测试**

Run:

```bash
pnpm exec vitest run packages/desktop-temporary-workspace/test/plugin.test.js packages/desktop-temporary-workspace/test/package.test.js
```

Expected: PASS；测试输出无未处理 Promise、React Hook 或 Slot 重复注册警告。

- [ ] **Step 9: 提交虚拟 Picker**

```bash
git add packages/desktop-temporary-workspace/client.js packages/desktop-temporary-workspace/package.json packages/desktop-temporary-workspace/test/plugin.test.js packages/desktop-temporary-workspace/test/package.test.js pnpm-lock.yaml
git commit -m "feat: add a virtual default workspace picker"
```

### Task 4: 更新设置语义、版本和包级契约

**Files:**
- Modify: `packages/desktop-temporary-workspace/client.js`
- Modify: `packages/desktop-temporary-workspace/package.json`
- Modify: `packages/desktop-temporary-workspace/test/plugin.test.js`
- Modify: `packages/desktop-temporary-workspace/test/package.test.js`

**Interfaces:**
- Consumes: 既有 `desktop-temporary-workspace` settings namespace 与 `rootDirectory` 字段。
- Produces: `0.2.0` manifest、默认执行目录中英文词典、保持原 namespace 的设置卡。

- [ ] **Step 1: 为版本和新设置文案编写失败断言**

在 `package.test.js` 把版本期望改为：

```js
expect(manifest.version).toBe('0.2.0')
expect(manifest.description).toBe(
  'Creates ungrouped DSH sessions in a shared configurable default working directory.'
)
```

复用 Task 3 的 `ctx`，从 `locale.register(NS, dictionaries)` 调用中取得 dictionaries 并加入：

```js
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
```

- [ ] **Step 2: 运行版本与词典测试并确认仍为旧语义**

Run:

```bash
pnpm exec vitest run packages/desktop-temporary-workspace/test/plugin.test.js packages/desktop-temporary-workspace/test/package.test.js -t "version|dictionaries|manifest"
```

Expected: FAIL，版本仍为 `0.1.1`，词典仍包含“临时工作区”和日期目录描述。

- [ ] **Step 3: 将中英文词典改为共享默认目录语义**

在 `client.js` 使用以下 key；删除 `temporaryWorkspace` 和日期命名说明：

```js
const zh = {
  defaultWorkspace: '默认执行目录',
  addWorkspace: '添加工作区…',
  createFailed: '无法创建默认会话',
  close: '关闭',
  retry: '重试',
  settingsTitle: '默认执行目录',
  settingsDescription: '无需选择项目即可创建独立任务；所有默认会话共享同一目录。',
  rootDirectory: '默认执行目录',
  rootDirectoryHint: '修改只影响后续会话，不会移动或清理已有文件。',
  save: '保存',
  saving: '正在保存…',
  reset: '恢复默认值',
  required: '请输入绝对目录路径。',
  saveFailed: '设置未保存，请检查路径后重试。'
}

const en = {
  defaultWorkspace: 'Default workspace',
  addWorkspace: 'Add workspace…',
  createFailed: 'Could not create default session',
  close: 'Close',
  retry: 'Retry',
  settingsTitle: 'Default workspace',
  settingsDescription: 'Start independent tasks without choosing a project. All default sessions share one directory.',
  rootDirectory: 'Default workspace directory',
  rootDirectoryHint: 'Changes affect future sessions only and never move or remove existing files.',
  save: 'Save',
  saving: 'Saving…',
  reset: 'Restore default',
  required: 'Enter an absolute directory path.',
  saveFailed: 'The setting was not saved. Check the path and try again.'
}
```

设置卡继续使用 `desktop-temporary-workspace` namespace、现有 `scope.set/unset`、writable 状态逻辑以及 `style[data-plugin-css="dsh-desktop-temporary-workspace"]`；本任务不重命名这些持久化或去重标识。

- [ ] **Step 4: 把包版本提升为 0.2.0 并刷新 lockfile importer**

在 `packages/desktop-temporary-workspace/package.json` 设置：

```json
"version": "0.2.0",
"description": "Creates ungrouped DSH sessions in a shared configurable default working directory."
```

Run:

```bash
corepack pnpm install --lockfile-only
```

Expected: `pnpm-lock.yaml` 的 workspace importer 与 package snapshot 一致，不新增无关依赖。

- [ ] **Step 5: 运行设置与 package contract 测试**

Run:

```bash
pnpm exec vitest run packages/desktop-temporary-workspace/test/plugin.test.js packages/desktop-temporary-workspace/test/package.test.js -t "configuration|dictionaries|manifest|published package"
```

Expected: PASS。

- [ ] **Step 6: 提交版本和设置语义**

```bash
git add packages/desktop-temporary-workspace/client.js packages/desktop-temporary-workspace/package.json packages/desktop-temporary-workspace/test/plugin.test.js packages/desktop-temporary-workspace/test/package.test.js pnpm-lock.yaml
git commit -m "feat: redefine temporary workspaces as a shared default"
```

### Task 5: 重写安装、兼容性和升级文档

**Files:**
- Modify: `packages/desktop-temporary-workspace/README.md`
- Modify: `packages/desktop-temporary-workspace/README.zh.md`
- Modify: `README.md`
- Modify: `README.zh.md`
- Modify: `docs/superpowers/specs/2026-08-20-awesome-dsh-plugin-listing-design.md`
- Modify: `docs/superpowers/plans/2026-08-20-awesome-dsh-plugin-listing-readiness.md`
- Test: `packages/desktop-temporary-workspace/test/package.test.js`

**Interfaces:**
- Consumes: Task 1-4 的实际 endpoint、Picker 文案、`0.2.0` 版本与安装命令。
- Produces: 不再宣称需要 Desktop 扩展补丁或日期子目录的中英文用户文档；把尚未执行的 Awesome 发布目标从 `0.1.1` 更新到 `0.2.0`。

- [ ] **Step 1: 添加文档契约失败测试**

在 `package.test.js` 加入：

```js
it('documents the shared default directory and stock Desktop compatibility', async () => {
  const english = await readFile(new URL('../README.md', import.meta.url), 'utf8')
  const chinese = await readFile(new URL('../README.zh.md', import.meta.url), 'utf8')

  expect(english).toContain('<DSH_HOME>/default-workspace')
  expect(english).toContain('Ungrouped')
  expect(english).toContain('0.2.0')
  expect(english).not.toContain('not compatible with stock')
  expect(english).not.toContain('YYYYMMDD-HHmmss')
  expect(chinese).toContain('<DSH_HOME>/default-workspace')
  expect(chinese).toContain('未分组')
  expect(chinese).toContain('0.2.0')
  expect(chinese).not.toContain('不兼容原版')
  expect(chinese).not.toContain('YYYYMMDD-HHmmss')
})
```

- [ ] **Step 2: 运行文档测试并确认旧兼容性说明失败**

Run:

```bash
pnpm exec vitest run packages/desktop-temporary-workspace/test/package.test.js -t "documents the shared"
```

Expected: FAIL，README 仍声明依赖 Desktop 扩展点并描述日期目录。

- [ ] **Step 3: 重写包级 README**

英文和中文 README 必须按相同顺序覆盖：

```text
1. 这是“默认执行目录”虚拟 Picker：不要求选择项目。
2. 安装命令保持 dsh plugin --profile web add @ywandy/dsh-desktop-temporary-workspace。
3. 输入框顶部 Workspace 菜单出现 Default workspace / 默认执行目录。
4. 每次选择创建新未分组 Session；所有 Session 共用 <DSH_HOME>/default-workspace。
5. 设置项保存绝对路径，保存时不创建目录。
6. 多 Session 可同时修改共享文件，插件不提供写入隔离。
7. 兼容原始 dsh-desktop origin/main 使用的 @deepseek-ai/dsh@0.1.0-rc.7。
8. 0.2.0 Upgrade：旧 rootDirectory 覆盖值直接成为共享目录；不再创建日期子目录；旧文件不移动、不删除。
9. 安全边界：Host 只接受同源回环 POST，请求体不能覆盖路径。
```

不要保留“首次发送才创建”“workspace-create-source”“deferred-session”“YYYYMMDD-HHmmss”或“需要对应 DSH Desktop 补丁”等旧说明。

- [ ] **Step 4: 同步仓库 README 与尚未执行的 Awesome 计划**

仓库级 README 表格描述改为：

```text
Creates ungrouped sessions that share a configurable default working directory, selected from the existing Workspace picker.
```

```text
从现有 Workspace 选择器创建共用可配置默认执行目录的未分组 Session。
```

把 `2026-08-20-awesome-dsh-plugin-listing-design.md` 和对应计划中的目标版本、描述、兼容性从 `0.1.1`/Desktop 扩展依赖更新为 `0.2.0`/stock Desktop；保留“未满足仓库成熟度门槛前不提交 PR”的既有约束。

Awesome 设计中的候选条目固定改为：

```yaml
url: https://github.com/ywandy/dsh-plugins/tree/main/packages/desktop-temporary-workspace
name: ywandy/dsh-plugins#desktop-temporary-workspace
description:
  en: Adds a default Workspace-picker option that creates ungrouped sessions sharing one configurable working directory.
  zh: 在现有 Workspace 选择器中增加默认执行目录选项，创建共用一个可配置工作目录的未分组 Session。
tags:
  - workflow
```

两份 Awesome 文档中的发布、`npm view`、`npm pack`、tarball、Git tag 和 GitHub Release 示例统一使用 `0.2.0`/`v0.2.0`；兼容性统一写明“已验证原始 DSH Desktop `origin/main` 所用 `@deepseek-ai/dsh@0.1.0-rc.7`”，并删除 `workspace-create-source`、`deferred-session` 依赖断言。修改后运行：

```bash
rg -n "0\.1\.1|workspace-create-source|deferred-session|不兼容.*stock|not compatible.*stock" \
  docs/superpowers/specs/2026-08-20-awesome-dsh-plugin-listing-design.md \
  docs/superpowers/plans/2026-08-20-awesome-dsh-plugin-listing-readiness.md
```

Expected: 无匹配；“仓库创建满 24 小时且默认分支至少 10 个真实提交”的门槛及禁止用空提交规避的文字仍存在。

- [ ] **Step 5: 运行文档、package 和 pack 检查**

Run:

```bash
pnpm exec vitest run packages/desktop-temporary-workspace/test/package.test.js
pnpm pack:check
```

Expected: PASS；tarball 仍只包含 `LICENSE`、两份 README、`client.js`、`cordis.patch.yml`、`index.js`、`package.json`。

- [ ] **Step 6: 提交文档**

```bash
git add README.md README.zh.md packages/desktop-temporary-workspace/README.md packages/desktop-temporary-workspace/README.zh.md packages/desktop-temporary-workspace/test/package.test.js docs/superpowers/specs/2026-08-20-awesome-dsh-plugin-listing-design.md docs/superpowers/plans/2026-08-20-awesome-dsh-plugin-listing-readiness.md
git commit -m "docs: explain the shared default workspace flow"
```

### Task 6: 完整验证、原版 Desktop 本地链接环境与最终评审

**Files:**
- Verify only: all files changed by Task 1-5

**Interfaces:**
- Consumes: `@ywandy/dsh-desktop-temporary-workspace@0.2.0` 完整包、`dsh.bundle`、本地 `link:` 安装方式，以及 DSH Desktop 原始 `origin/main` 提交 `9431d15`。
- Produces: 通过全部自动检查、在一次性原版 Desktop clone 与隔离 DSH_HOME 中的安装结果、人工 Smoke Test 记录和可供最终 squash 的已评审提交序列。

- [ ] **Step 1: 运行仓库全量检查**

```bash
pnpm check
```

Expected: 所有 Vitest 测试通过，随后输出 `pack contents verified`；无 warning、Unhandled Rejection 或 snapshot 更新提示。

- [ ] **Step 2: 检查 diff 质量和旧语义残留**

```bash
git diff --check origin/main...HEAD
rg -n "createSource|deferred-session|YYYYMMDD-HHmmss|not compatible with stock|不兼容原版" packages/desktop-temporary-workspace README.md README.zh.md --glob '!**/test/**'
```

Expected: `git diff --check` 无输出；`rg` 无匹配。若历史设计文档需要保留旧术语，只允许在 `docs/superpowers/` 的历史背景中出现，不得出现在运行时包或当前 README。

- [ ] **Step 3: 用一次性原版 Desktop clone 和 DSH_HOME 验证 link 安装**

```bash
desktop_status_before=$(git -C /Users/yewei/yyw/project/dsh-desktop status --porcelain=v1)
stock_desktop=$(mktemp -d)
dev_dsh_home=$(mktemp -d)
git clone --no-local /Users/yewei/yyw/project/dsh-desktop "$stock_desktop"
git -C "$stock_desktop" switch --detach 9431d15
npm ci --prefix "$stock_desktop"
DSH_HOME="$dev_dsh_home" "$stock_desktop/node_modules/.bin/dsh" plugin --profile web add link:/Users/yewei/yyw/project/dsh-plugins/packages/desktop-temporary-workspace
DSH_HOME="$dev_dsh_home" "$stock_desktop/node_modules/.bin/dsh" --profile web --dump-config > "$dev_dsh_home/composed.yml"
rg -n "dsh-desktop-temporary-workspace|@ywandy/dsh-desktop-temporary-workspace" "$dev_dsh_home/composed.yml"
test "$(git -C "$stock_desktop" rev-parse HEAD)" = "9431d1508d9af12c8e49ee1880dc0f054eea4d01"
test "$desktop_status_before" = "$(git -C /Users/yewei/yyw/project/dsh-desktop status --porcelain=v1)"
```

Expected: 安装成功，组合结果包含唯一插件 row；临时 clone 精确位于原始 `origin/main` 提交，现有 `/Users/yewei/yyw/project/dsh-desktop` 的既有状态逐字节不变。保留 `stock_desktop` 与 `dev_dsh_home` 供下一步人工验收。

- [ ] **Step 4: 在未修改的 DSH Desktop origin/main 主机做人工 Smoke Test**

仍在同一终端运行原版 Desktop：

```bash
DSH_HOME="$dev_dsh_home" npm run dev --prefix "$stock_desktop"
```

按以下固定样例验收并记录结果；第 8 项完成后关闭 Desktop：

```text
1. 顶部 Workspace Picker 第一项是“默认执行目录”。
2. 连续创建两个默认 Session，两者位于“未分组”。
3. 两个 Session 的 cwd 都是同一个绝对目录。
4. Session A 创建文件后，Session B 能看到该文件。
5. 真实 Workspace 选择仍打开对应 Workspace Session。
6. “添加工作区…”仍能选择本地目录并注册 Workspace。
7. 将默认路径改成另一个绝对目录后，新 Session 使用新路径，旧 Session 不变。
8. 卸载插件并重启 Profile 后，stock Picker 恢复。
```

Expected: 8 项全部通过；UI 观感通过截图或人工验收，不为像素布局编写低价值自动测试。

确认两个变量都指向 `mktemp -d` 创建的具体目录后清理一次性环境，并再次验证现有 Desktop 工作区未变化：

```bash
test -n "$dev_dsh_home" && test -d "$dev_dsh_home" && rm -rf -- "$dev_dsh_home"
test -n "$stock_desktop" && test -d "$stock_desktop/.git" && rm -rf -- "$stock_desktop"
test "$desktop_status_before" = "$(git -C /Users/yewei/yyw/project/dsh-desktop status --porcelain=v1)"
```

Expected: 两个一次性目录被删除；`dsh-desktop` 现有工作树没有新增变化。

- [ ] **Step 5: 最终评审当前功能提交**

```bash
git status --short
git log --oneline --decorate origin/main..HEAD
git diff --stat origin/main...HEAD
git diff origin/main...HEAD -- packages/desktop-temporary-workspace package.json pnpm-lock.yaml README.md README.zh.md
```

Expected: 没有未提交文件；只包含设计、计划、插件、测试、lockfile 和相关文档变化；`dsh-desktop` 不在 diff 中。

- [ ] **Step 6: 在合并目标分支前 squash 为一个计划 Commit**

先记录 `git merge-base origin/main HEAD` 的精确提交，并确认该分支没有需要保留为独立历史的其他用户提交。若当前分支混有 Awesome 收录准备等独立任务，先把本功能迁移到独立 `codex/` 分支，再只 squash 本功能的设计、计划和实现提交。最终 Commit message 使用：

```text
feat: add a shared default workspace picker
```

Expected: 合并候选分支相对目标分支只保留一个本功能计划 Commit；不得重写无关用户提交。
