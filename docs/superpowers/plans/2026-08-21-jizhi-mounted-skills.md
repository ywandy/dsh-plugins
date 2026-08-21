# DSH 极智挂载 Skill Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `@ywandy/dsh-jizhi-bridge` 中注册 DSH 原生多目录 Skill Provider，读取容器内固定的系统/用户 `SKILL.md`，并以缓存友好的方式支持标准 `skill` 工具。

**Architecture:** 新增 `lib/skill-provider.js` 负责 cwd 身份解析、目录扫描、frontmatter 解析、懒加载与 watcher 失效；`index.js` 只负责把 Provider 注册到 `ctx.skills`，继续保留现有工作区快照和 Tool JSONL 事件连接。系统 rank 低于用户 rank，Provider 内部稳定去重；DSH registry 负责按 cwd 缓存，文件变更只调用 registration-scoped `invalidate()`。

**Tech Stack:** Node.js `>=22.19`、ES Modules、Vitest、`js-yaml`、`@deepseek-ai/dsh-skill@0.1.0-rc.7`、Cordis Host。

## Global Constraints

- 系统根目录固定为 `/agent/skills`，用户根目录固定为 `/agent/user/${net}/${user}/user_skills`。
- `net/user` 只能从 `/agent/user/${net}/${user}/workspace/...` 形式的绝对 Session `cwd` 提取；不读取宿主机路径，不从模型输入覆盖。
- 系统技能优先覆盖同名用户技能；候选按名称稳定排序；仅扫描一层 `skill-name/SKILL.md`。
- `list()` 返回摘要和 locator，`get()` 才读取完整正文；正文不追加到已有 `jizhi:workspace` system prompt section。
- 文件变化通过 watcher 调用 `ctx.skills.registerProvider` 控制对象的 `invalidate()`；不在每个 Agent Loop 主动刷新。
- 单个目录/文件/YAML 错误 fail-soft，不能改变 DSH 主会话、Markdown 快照或 Tool JSONL 行为。
- 不修改 `/Users/yewei/yyw/4399/project/jizhi_ai` 中任何文件。

---

### Task 1: 添加 Provider 的失败契约测试和包依赖

**Files:**

- Modify: `packages/jizhi-bridge/package.json`
- Modify: `packages/jizhi-bridge/test/package.test.js`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Produces: `@deepseek-ai/dsh-skill` Host peer 和 `js-yaml` runtime dependency 的发布契约。

- [ ] **Step 1: 扩展 manifest 测试**

在 `package.test.js` 的 peer 断言中加入 `@deepseek-ai/dsh-skill: '^0.1.0-rc.7'`，并增加 `manifest.dependencies` 对 `js-yaml` 的断言。

- [ ] **Step 2: 运行包测试确认 RED**

Run: `corepack pnpm exec vitest run packages/jizhi-bridge/test/package.test.js`

Expected: FAIL，当前 manifest 缺少新增的 peer/dependency。

- [ ] **Step 3: 更新 manifest 与 lockfile**

将 `@deepseek-ai/dsh-skill` 加入 `peerDependencies`，将 `js-yaml` 加入 `dependencies`，运行 `corepack pnpm install --lockfile-only` 更新 workspace lockfile。

- [ ] **Step 4: 运行包测试确认 GREEN**

Run: `corepack pnpm exec vitest run packages/jizhi-bridge/test/package.test.js`

Expected: PASS。

### Task 2: 实现固定路径解析、frontmatter 扫描与懒加载

**Files:**

- Create: `packages/jizhi-bridge/lib/skill-provider.js`
- Modify: `packages/jizhi-bridge/test/plugin.test.js`

**Interfaces:**

- Produces: `SYSTEM_SKILLS_ROOT`、`resolveJizhiSkillRoots(cwd)`、`createJizhiSkillProvider(options)`、Provider 的 `list/get`。

- [ ] **Step 1: 写 RED 测试**

覆盖：固定 cwd 派生用户目录、普通 cwd 只返回系统目录、系统/用户同名系统优先、名称排序、frontmatter `name/description`、缺 frontmatter 的目录名回退，以及 `get()` 返回去 frontmatter 正文和 directory resourceBase。

- [ ] **Step 2: 运行 Provider 测试确认 RED**

Run: `corepack pnpm exec vitest run packages/jizhi-bridge/test/plugin.test.js -t 'mounted skill provider'`

Expected: FAIL，模块和 Provider 尚不存在。

- [ ] **Step 3: 实现最小 Provider**

实现 `resolveJizhiSkillRoots`，只接受 `/agent/user/<net>/<user>/workspace` 前缀；扫描一层真实目录，按 `name.toLowerCase()` 去重；用 `js-yaml` 解析 frontmatter；候选使用 `invocation: { modelInvocable: true, userInvocable: true }`、system rank `500`、user rank `700`、`provider: 'jizhi-mounted-skills'`，并保留 `path/metadata/locator/resourceBase`。

`get()` 用 locator 重新读取并解析正文，若文件被删除返回 `undefined`，若名称已改变返回新定义让 registry 自行失效；所有非取消异常经 `warn` 后跳过。

- [ ] **Step 4: 运行 Provider 测试确认 GREEN**

Run: `corepack pnpm exec vitest run packages/jizhi-bridge/test/plugin.test.js -t 'mounted skill provider'`

Expected: PASS。

### Task 3: 加入 watcher 失效和 DSH Host 注册

**Files:**

- Modify: `packages/jizhi-bridge/index.js`
- Modify: `packages/jizhi-bridge/test/plugin.test.js`

**Interfaces:**

- Consumes: `createJizhiSkillProvider(options)`。
- Produces: `inject` 包含 `skills`，`apply(ctx)` 注册 `jizhi-mounted-skills`，并在 dispose/abort 时关闭 watcher。

- [ ] **Step 1: 写 RED 测试**

扩展 host fixture 的 `ctx.skills.registerProvider`，断言 `apply()` 注册 provider；模拟 watcher 事件触发 `invalidate()`；调用 disposer 后再次触发事件不再 invalidate；确认旧 workspace/JSONL handlers 仍注册。

- [ ] **Step 2: 运行 Host 测试确认 RED**

Run: `corepack pnpm exec vitest run packages/jizhi-bridge/test/plugin.test.js -t 'Host plugin|watcher'`

Expected: FAIL，`inject` 尚无 `skills` 且 `apply()` 未注册 Provider。

- [ ] **Step 3: 接入注册和 watcher**

把 `inject` 改为 `['systemPrompt', 'attachments', 'skills']`；在 `apply()` 中调用 `ctx.skills.registerProvider(control => createJizhiSkillProvider({ invalidate: control.invalidate, warn }))`。Provider 首次访问每个根目录时安装 `fs.watch`（`persistent:false`），监听根目录和发现的技能子目录，事件调用一次 `invalidate()`；监听器在 `control.signal.abort` 时关闭。没有 `ctx.skills` 时只 warning 并保持旧功能可用。

- [ ] **Step 4: 运行 Host 测试确认 GREEN**

Run: `corepack pnpm exec vitest run packages/jizhi-bridge/test/plugin.test.js -t 'Host plugin|watcher'`

Expected: PASS。

### Task 4: 文档、打包清单和全量验证

**Files:**

- Modify: `packages/jizhi-bridge/README.md`
- Modify: `packages/jizhi-bridge/README.zh.md`
- Modify: `README.md`
- Modify: `README.zh.md`
- Modify: `scripts/verify-pack.mjs`
- Modify: `packages/jizhi-bridge/test/package.test.js`

**Interfaces:**

- Produces: 可复制的容器挂载说明、路径解析说明、缓存/失效边界和 tarball 精确文件集合。

- [ ] **Step 1: 写文档契约测试**

断言 pack 期望文件包含 `lib/skill-provider.js`，README 含 `/agent/skills`、`/agent/user/<net>/<user>/user_skills`、`ctx.skills` 和 cache/invalidate 说明。

- [ ] **Step 2: 更新 README 与 pack verifier**

说明安装命令、容器挂载要求、`cwd` 推导规则、system/user 优先级、标准 `skill` 工具懒加载、watcher 失效和普通 cwd 降级行为；在 verifier 精确加入新 lib 文件。

- [ ] **Step 3: 运行完整验证**

Run:

```sh
corepack pnpm test
corepack pnpm pack:check
```

Expected: 所有 Vitest 测试通过，两个包的 pack 内容均 verified。

- [ ] **Step 4: 检查未越界修改并准备 squash**

Run: `git status --short` 和 `git diff --check`；确认 `jizhi_ai` 仓库无变化，最后将本次增量相对当前基线 squash 为一个计划提交。
