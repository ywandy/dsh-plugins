# 默认工作区 Picker 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `@ywandy/dsh-desktop-temporary-workspace` 在标准 DSH Workspace 下拉中提供可配置、首次使用自动创建的“默认执行目录”。

**Architecture:** 保留现有 Host settings namespace 和 ensure HTTP route。Client 通过 `ctx.slots.inject('conversation.hero.workspace', ...)` 影子替换标准 Picker，使用 DSH UI primitives 构造包含默认项、真实 Workspace 和添加入口的菜单；默认项直接创建 `cwd` 为 ensure 返回路径的未分组 Session，添加入口调用标准 `uiWorkspace.pickDirectory()`。

**Tech Stack:** 原生 ESM JavaScript、Cordis Client Slot、React `createElement`、`@deepseek-ai/dsh-client-ui-primitives`、Vitest 3、npm pack dry-run。

## Global Constraints

- 只修改 `/Users/yewei/yyw/project/dsh-plugins`，不修改 `dsh-desktop`。
- 默认值固定为 `<DSH_HOME>/default-workspace`。
- `rootDirectory` 必须是当前操作系统格式的绝对路径。
- 保存设置只持久化路径；首次选择“默认执行目录”时才创建目录。
- 默认 Session 调用 `sessions.create({ cwd })`，不传 `workspaceId`，然后调用 `sessions.open(sessionId)`。
- 真实 Workspace 选择继续调用标准 Owner 的 `onPick(workspaceId)`。
- 插件不声明标准 Picker 已声明的 `conversation.hero.workspace.directoryFlow` 子槽。
- Client 代码保持 plain JavaScript，不使用 TypeScript、JSX、import 或 require 语法。
- 每个新增行为先写失败测试并确认失败，再写最小实现。
- 完成实现和验证后进行一次消融检查，删除不必要的抽象和重复逻辑。

---

### Task 1: 建立标准 Picker 的失败测试和测试 seam

**Files:**
- Modify: `packages/desktop-temporary-workspace/test/plugin.test.js`

**Interfaces:**
- Consumes: 当前 `loadClientBundle()`、`createClientContextFixture()`、Host ensure 测试工具。
- Produces: 测试中使用的 `buildWorkspaceMenu(workspaces, labels, busy, addAvailable)` 和 `createDefaultSession(ensure, sessions)` 行为契约；标准 Picker 注册项名称为 `conversation.hero.workspace`。

- [ ] **Step 1: 写标准 Picker 注册的失败测试**

在 `temporary workspace client plugin` describe 中新增测试，调用 `client.apply(ctx)` 后筛选 `entry.options.name === 'conversation.hero.workspace'`，断言：

```js
expect(picker).toBeDefined()
expect(picker.options.children).toBeUndefined()
expect(entries.some((entry) => entry.options.name.endsWith('.createSource'))).toBe(false)
```

测试 fixture 增加 `ctx.get(name)`，返回 `sessions`、`workspaces` 和 `uiWorkspace`，并让 `ctx.slots.inject()` 像当前一样立即执行注册回调。当前实现没有标准 Picker 注册，因此测试必须失败。

- [ ] **Step 2: 运行测试确认失败原因正确**

Run:

```sh
corepack pnpm exec vitest run packages/desktop-temporary-workspace/test/plugin.test.js -t "registers the standard conversation workspace picker"
```

Expected: FAIL，因为当前 Client 只注册两个 `*.createSource` 项。

- [ ] **Step 3: 写菜单数据和默认 Session 创建的失败测试**

在测试文件中新增两组测试。第一组调用尚不存在的 `client.buildWorkspaceMenu`：

```js
expect(client.buildWorkspaceMenu(
  [{ workspaceId: 'ws-1', title: 'Project A' }],
  { defaultWorkspace: '默认执行目录', addWorkspace: '添加工作区…' },
  false,
  true
)).toEqual({
  items: [
    { id: 'default', label: '默认执行目录', disabled: false },
    { id: 'ws-1', label: 'Project A', disabled: false }
  ],
  footer: [{ id: 'add-workspace', label: '添加工作区…', disabled: false }]
})
```

第二组调用尚不存在的 `client.createDefaultSession`，要求顺序和参数：

```js
const order = []
const result = await client.createDefaultSession(
  async () => {
    order.push('ensure')
    return '/tmp/default-workspace'
  },
  {
    create: async (input) => {
      order.push(['create', input])
      return 'session-1'
    },
    open: (id) => order.push(['open', id])
  }
)

expect(result).toEqual({ path: '/tmp/default-workspace', sessionId: 'session-1' })
expect(order).toEqual([
  'ensure',
  ['create', { cwd: '/tmp/default-workspace' }],
  ['open', 'session-1']
])
```

另加失败测试：ensure 抛错时 `sessions.create` 和 `sessions.open` 都不执行；默认流程不接收也不生成 `workspaceId`。

- [ ] **Step 4: 运行新增测试确认失败**

Run:

```sh
corepack pnpm exec vitest run packages/desktop-temporary-workspace/test/plugin.test.js -t "workspace menu|default session"
```

Expected: FAIL，失败点是导出 helper 尚不存在，而不是断言或 fixture 错误。

- [ ] **Step 5: 提交测试 seam**

```sh
git add packages/desktop-temporary-workspace/test/plugin.test.js
git commit -m "test: define standard default workspace picker behavior"
```

### Task 2: 实现 Host 依赖的标准 Client Picker

**Files:**
- Modify: `packages/desktop-temporary-workspace/client.js`
- Modify: `packages/desktop-temporary-workspace/test/plugin.test.js`

**Interfaces:**
- Consumes: `ensureDefaultWorkspace(fetchImpl)`、settings card、`conversation.hero.workspace` Owner props、Host services `sessions`, `workspaces`, `uiWorkspace`。
- Produces: `buildWorkspaceMenu(workspaces, labels, busy, addAvailable)`、`createDefaultSession(ensure, sessions)`、`DefaultWorkspacePicker` 和标准 Slot 注册；Picker 注入 `createDefaultSession`、`createWorkspace` 与 `pickDirectory` 三个回调。

- [ ] **Step 1: 实现纯函数 helper 使 Task 1 测试通过**

在 `client.js` 中加入固定菜单 ID：

```js
const DEFAULT_WORKSPACE_ID = 'default'
const ADD_WORKSPACE_ID = 'add-workspace'
```

实现 `buildWorkspaceMenu(workspaces, labels, busy, addAvailable)`：

- 第一个 item 固定为 `{ id: 'default', label: labels.defaultWorkspace, disabled: busy }`；
- 真实 Workspace 映射为 `{ id: workspace.workspaceId, label: workspace.title, disabled: busy }`；
- `addAvailable` 为真时返回 footer `{ id: 'add-workspace', label: labels.addWorkspace, disabled: busy }`，否则返回空数组；
- 不把 Host Workspace 对象放入返回值，避免把 live data 跨越 UI 边界。

实现 `createDefaultSession(ensure, sessions)`：

```js
async function createDefaultSession(ensure, sessions) {
  const path = await ensure()
  const sessionId = await sessions.create({ cwd: path })
  sessions.open(sessionId)
  return { path, sessionId }
}
```

函数只在 ensure 成功后创建 Session；不添加 workspace 字段。

- [ ] **Step 2: 运行 helper 测试确认通过**

Run:

```sh
corepack pnpm exec vitest run packages/desktop-temporary-workspace/test/plugin.test.js -t "workspace menu|default session"
```

Expected: PASS。

- [ ] **Step 3: 写 Picker 组件注册的最小实现**

将现有 `inject` 改为包含：

```js
const inject = ['slots', 'locale', 'settingsScope', 'sessions', 'workspaces', 'uiWorkspace']
```

`apply(ctx)` 中通过 `ctx.get('sessions')`、`ctx.get('workspaces')`、`ctx.get('uiWorkspace')` 取得服务，保留 locale 与 settings 注册。把 `*.createSource` 注册删除，改为：

```js
ctx.slots.inject('conversation.hero.workspace', () =>
  ctx.slots.register(
    { name: 'conversation.hero.workspace', inject: () => ({
      createDefaultSession: () => createDefaultSession(() => ensureDefaultWorkspace(), sessions),
      createWorkspace: (input) => workspaces.create(input),
      pickDirectory: () => uiWorkspace.pickDirectory()
    }), locale: NS },
    DefaultWorkspacePicker
  )
)
```

不填写 `children`，让标准 Host 的 `directoryFlow` 声明继续由标准 Picker 持有；本插件自己的 Picker 通过 `pickDirectory` 服务完成添加目录流程。

- [ ] **Step 4: 实现 DefaultWorkspacePicker 的菜单和默认项动作**

组件读取标准 props：`open`、`anchorRef`、`useWorkspaces`、`selectedId`、`onPick`、`onClose`、`createDefaultSession`、`createWorkspace`、`pickDirectory`、`t`。使用 `React.useState` 管理 `busy`、`errorOpen` 和错误消息，使用 `useWorkspaces((state) => state)` 读取 `items` 与 `phase`。

默认项动作执行：

```js
onClose()
setBusy(true)
createDefaultSession()
  .catch((reason) => showError(reason))
  .finally(() => setBusy(false))
```

真实 Workspace 仍执行 `onClose(); onPick(id)`。添加入口执行 `pickDirectory()`，取消时直接结束，成功后 `await createWorkspace({ path })` 并 `onPick(workspace.workspaceId)`。Menu 使用 `portal: true`、`getAnchorRect`、`footer` 和 `selectedId`，错误使用 `Modal`，沿用现有 UI token 样式。

组件必须在 busy 期间把所有菜单项和 footer 禁用，且避免同一次渲染中重复处理点击。

- [ ] **Step 5: 更新 Client 测试 fixture 与注册断言**

让 fixture 的 `ctx.get()` 返回真实的 `sessions`、`workspaces`、`uiWorkspace`，并将旧的 create-source 断言改为：

```js
expect(entries.filter((entry) => entry.options.name === 'conversation.hero.workspace')).toHaveLength(1)
expect(entries.some((entry) => entry.options.name.endsWith('.createSource'))).toBe(false)
```

对 `uiWorkspace.pickDirectory()` 返回路径、`workspaces.create()` 返回 Workspace ID 的顺序增加一个纯行为测试，确认取消选择不调用 create。

- [ ] **Step 6: 运行插件全部测试**

Run:

```sh
corepack pnpm exec vitest run packages/desktop-temporary-workspace/test/plugin.test.js packages/desktop-temporary-workspace/test/package.test.js
```

Expected: PASS，且没有 create-source 相关失败。

- [ ] **Step 7: 提交 Client 实现**

```sh
git add packages/desktop-temporary-workspace/client.js packages/desktop-temporary-workspace/test/plugin.test.js
git commit -m "feat: add default workspace to standard picker"
```

### Task 3: 更新包元数据、文档与打包验证

**Files:**
- Modify: `packages/desktop-temporary-workspace/package.json`
- Modify: `packages/desktop-temporary-workspace/README.md`
- Modify: `packages/desktop-temporary-workspace/README.zh.md`
- Modify: `packages/desktop-temporary-workspace/test/package.test.js`
- Modify: `README.md`
- Modify: `README.zh.md`
- Modify: `scripts/verify-pack.mjs`

**Interfaces:**
- Consumes: Task 2 的标准 Picker Client 和现有 Host Bundle。
- Produces: `0.4.0` 包，声明 `@deepseek-ai/dsh-client-ui-primitives` Client 依赖，文档与实际入口一致。

- [ ] **Step 1: 写 manifest 和文档的失败断言**

在 `package.test.js` 将版本期望改为 `0.4.0`，断言 `manifest.dsh.client.inject` 包含 `@deepseek-ai/dsh-client-ui-primitives`，并断言 peerDependencies 包含同名 `^0.1.0-rc.7`。在测试中断言 README 不再包含 `create-source`、`deferred-composer` 和“侧栏新任务入口”等旧兼容描述。先运行测试，确认当前 manifest/README 失败。

- [ ] **Step 2: 更新 manifest 和包版本**

将 `version` 改为 `0.4.0`，在 `dsh.client.inject` 增加 `@deepseek-ai/dsh-client-ui-primitives`，在 peerDependencies 增加：

```json
"@deepseek-ai/dsh-client-ui-primitives": "^0.1.0-rc.7"
```

保留 `@deepseek-ai/dsh-client-ui-workspace`，因为标准 Picker 和 `uiWorkspace` 是本插件的宿主能力来源。

- [ ] **Step 3: 更新中英文包 README**

把使用说明统一为：打开输入框上方 Workspace 下拉，选择 **Default workspace / 默认执行目录**。删除依赖桌面 `create-source`、延迟 Composer 补丁和侧栏入口的表述，说明真实 Workspace 与添加工作区继续可用。保留固定默认路径、设置路径、首次选择时自动创建、共享目录和未分组 Session 语义。

- [ ] **Step 4: 更新 monorepo README**

把包功能描述从“现有 Workspace 选择器创建”改为“标准 Workspace 下拉中的共享可配置默认执行目录”，并更新兼容性说明为标准 Picker、Session、Workspace 服务版本要求。

- [ ] **Step 5: 更新 pack 内容校验与测试期望**

包文件集合仍保持现有七个发布文件，不把测试或文档之外的新运行时文件遗漏到 `files`。运行 package test 和 pack check，确认 npm dry-run 只包含期望文件。

- [ ] **Step 6: 运行完整验证**

Run:

```sh
corepack pnpm exec vitest run packages/desktop-temporary-workspace/test/plugin.test.js packages/desktop-temporary-workspace/test/package.test.js
corepack pnpm pack:check
corepack pnpm check
```

Expected: 所有插件测试和 pack 校验通过。

- [ ] **Step 7: 进行消融检查并修正**

检查 `client.js`：删除只为 create-source 兼容保留的 `source()`、旧入口文案和重复的状态分支；检查 `package.json`：删除未被 Client `require` 或 Host 服务使用的依赖声明；检查 README：删除实现细节重复段落。每次删改后重跑插件测试和 pack check。

- [ ] **Step 8: 提交包元数据与文档**

```sh
git add packages/desktop-temporary-workspace/package.json packages/desktop-temporary-workspace/README.md packages/desktop-temporary-workspace/README.zh.md packages/desktop-temporary-workspace/test/package.test.js README.md README.zh.md scripts/verify-pack.mjs
git commit -m "docs: document standard default workspace picker"
```

### Task 4: 最终审查与工作区交付

**Files:**
- Review: `packages/desktop-temporary-workspace/index.js`
- Review: `packages/desktop-temporary-workspace/client.js`
- Review: `packages/desktop-temporary-workspace/package.json`
- Review: `packages/desktop-temporary-workspace/test/plugin.test.js`
- Review: `packages/desktop-temporary-workspace/test/package.test.js`

**Interfaces:**
- Consumes: Task 1–3 的提交与通过的自动化验证。
- Produces: 只含插件仓库目标改动的可审查工作区状态。

- [ ] **Step 1: 检查 diff 和状态**

Run:

```sh
git status --short
git diff HEAD~3..HEAD --stat
git diff --check HEAD~3..HEAD
```

确认没有修改 `/Users/yewei/yyw/project/dsh-desktop`，也没有触碰原有未跟踪的 Jizhi 计划文件。

- [ ] **Step 2: 复跑核心路径测试**

Run:

```sh
corepack pnpm exec vitest run packages/desktop-temporary-workspace/test/plugin.test.js -t "default workspace|standard conversation workspace picker|default session"
```

Expected: 默认路径、ensure、标准下拉和 Session 创建路径全部 PASS。

- [ ] **Step 3: 汇报结果**

交付时说明：标准 Workspace 下拉已新增“默认执行目录”；默认路径是 `<DSH_HOME>/default-workspace`，可在设置修改；第一次选择时自动创建目录并打开未分组 Session；真实 Workspace/添加工作区仍可用；列出测试与 pack check 结果及人工 Smoke Test 尚需在桌面应用中执行的部分。
