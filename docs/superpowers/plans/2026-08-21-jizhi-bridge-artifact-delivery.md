# jizhi-bridge 交付工具 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `@ywandy/dsh-jizhi-bridge` 增加只登记极智 artifacts 清单的 `collect_artifacts` 工具。

**Architecture:** `lib/artifact-delivery.js` 负责请求 ID、路径校验、去重和原子清单写入；`index.js` 负责把工具接入 Cordis 生命周期，并在真实用户消息领取时保存当前请求 ID。工具不上传文件、不创建 `.jizhiagent`，清单由极智后端在回答结束时消费。

**Tech Stack:** Node.js 22.19+、ESM、`@deepseek-ai/dsh-tools`、Vitest、Cordis。

## Global Constraints

- 工具名固定为 `collect_artifacts`。
- 清单路径固定为 `<cwd>/.jizhiagent/logs/artifacts_msg_<req_msgid>.json`。
- `req_msgid` 只能来自当前真实用户消息 `source.rpcId` 的正整数表示；UUID 或缺失值不得猜测。
- 只接受 `artifacts/` 下的相对常规文件；空数组表示显式无交付文件。
- 不存在的 `.jizhiagent` 不得被创建；写入失败不得改变主会话结果。
- 所有写入通过同目录临时文件和 rename 完成，并清理临时文件。

---

### Task 1: 发布契约与失败测试

**Files:**
- Modify: `packages/jizhi-bridge/package.json`
- Modify: `packages/jizhi-bridge/test/package.test.js`
- Modify: `packages/jizhi-bridge/README.zh.md`
- Modify: `packages/jizhi-bridge/README.md`

**Interfaces:**
- Produces: `@deepseek-ai/dsh-tools` peer dependency and documented `collect_artifacts` contract.

- [ ] **Step 1: 写失败的 manifest 断言**

在 `package.test.js` 增加断言：`manifest.peerDependencies['@deepseek-ai/dsh-tools'] === '^0.1.0-rc.7'`，并要求 `manifest.files` 包含 `lib`。

- [ ] **Step 2: 运行发布契约测试确认失败**

运行：`corepack pnpm exec vitest run packages/jizhi-bridge/test/package.test.js`

预期：因缺少 `@deepseek-ai/dsh-tools` peer 断言而失败。

- [ ] **Step 3: 更新 manifest 与 README**

在 `peerDependencies` 增加 `"@deepseek-ai/dsh-tools": "^0.1.0-rc.7"`；中英文 README 增加工具参数、相对路径、清单位置和上游 `source.rpcId` 请求 ID 约定。

- [ ] **Step 4: 运行发布契约测试确认通过**

运行：`corepack pnpm exec vitest run packages/jizhi-bridge/test/package.test.js`

预期：PASS。

### Task 2: 实现交付清单模块

**Files:**
- Create: `packages/jizhi-bridge/lib/artifact-delivery.js`
- Modify: `packages/jizhi-bridge/test/plugin.test.js`

**Interfaces:**
- Produces: `createArtifactDeliveryTool({ requestIdForAgent, warn, fsOps? })`，返回可注册到 `ctx.tools` 的 `ToolDefinition`。

- [ ] **Step 1: 写工具行为失败测试**

覆盖正整数请求 ID、空数组、重复路径、`..` 穿越、绝对路径、目录、缺失文件、清单 JSON 字段和 `.jizhiagent` 不存在时不创建目录。

- [ ] **Step 2: 运行测试确认 RED**

运行：`corepack pnpm exec vitest run packages/jizhi-bridge/test/plugin.test.js -t "collect_artifacts"`

预期：因模块和工具未定义而失败。

- [ ] **Step 3: 实现 schema、校验和原子写入**

使用 `defineTool` 声明 `files` 数组参数；执行时从 `exec.agent` 取请求 ID，确认绝对 `cwd` 与既有 `.jizhiagent` 目录，逐项把路径转换为 POSIX 规范化形式并确认目标是普通文件；使用 `mkdtemp`/`writeFile`/`rename` 在 `logs` 同目录写入格式化 JSON。输出 DTO 为 `{ status: 'success', delivered: string[], note: string }`，失败抛出带上下文的 `Error`。

- [ ] **Step 4: 运行模块测试确认 GREEN**

运行：`corepack pnpm exec vitest run packages/jizhi-bridge/test/plugin.test.js -t "collect_artifacts"`

预期：PASS。

### Task 3: 接入 Host 生命周期与 Agent 请求 ID

**Files:**
- Modify: `packages/jizhi-bridge/index.js`
- Modify: `packages/jizhi-bridge/test/plugin.test.js`

**Interfaces:**
- Consumes: `createArtifactDeliveryTool`。
- Produces: `inject` 包含 `tools`；插件激活时注册一次、dispose 时卸载；每次 `agent/inbox/claimed` 的真实用户消息更新请求 ID。

- [ ] **Step 1: 写 Host 注册与生命周期失败测试**

扩展 host fixture 提供 `tools.register`；断言 `inject` 含 `tools`、注册工具名为 `collect_artifacts`、numeric `source.rpcId` 可写清单、dispose 会调用 unregister；tool 来源消息不更新请求 ID。

- [ ] **Step 2: 运行测试确认 RED**

运行：`corepack pnpm exec vitest run packages/jizhi-bridge/test/plugin.test.js -t "Host plugin|collect_artifacts"`

预期：因未注入/注册工具而失败。

- [ ] **Step 3: 接入注册与 WeakMap**

把 `tools` 加入 `inject`；创建 `requestIds` WeakMap 和 `requestIdForAgent` 解析函数；在用户消息分支保存正整数 ID；通过 `ctx.effect` 注册工具并在清理时调用返回的 unregister 函数。

- [ ] **Step 4: 运行 jizhi-bridge 全部测试**

运行：`corepack pnpm exec vitest run packages/jizhi-bridge/test`

预期：PASS。

### Task 4: 全仓验证与发布检查

**Files:**
- Modify: `scripts/verify-pack.mjs`（仅当包检查集合缺少新 peer/文件断言时）
- Modify: `pnpm-lock.yaml`（如安装依赖导致 lockfile 更新）

- [ ] **Step 1: 运行全仓测试**

运行：`corepack pnpm test`

预期：PASS。

- [ ] **Step 2: 运行 pack 检查**

运行：`corepack pnpm pack:check`

预期：PASS，tarball 含 `lib/artifact-delivery.js`、README 和 manifest，且不含测试文件。

- [ ] **Step 3: 检查 diff 与临时文件**

运行：`git status --short` 与 `git diff --check`；确认没有修改 `/Users/yewei/yyw/4399/project/jizhi_ai`，没有残留临时清单文件。

- [ ] **Step 4: 提交实现**

运行：`git add packages/jizhi-bridge docs/superpowers && git commit -m "feat: add jizhi artifact delivery tool"`。
