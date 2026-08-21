# DSH 全局 Skill 凭据转发临时方案实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不修改 DeepSeek Harness 核心源码的前提下，通过 `@ywandy/dsh-jizhi-bridge` 临时把 `OPENAI_API_KEY` 和 `OPENAI_BASE_URL` 从 `ctx.credentials` 显式转发到所有由 DSH subprocess service 创建的子进程。

**Architecture:** 新增独立的 `credential-forwarder` helper，按调用实时解析凭据并缓存非空值，包装 `ctx.subprocess.spawn()` 与 `spawnTerminal()` 的 spec，在 Harness ambient scrub 之后重新加入显式 `env`。Jizhi Host 插件在启动时等待首次解析，监听 `credentials/updated` 刷新快照，并在 effect 销毁时恢复原始方法；Skill Provider、Workspace prompt 和 JSONL bridge 的现有逻辑保持不变。

**Tech Stack:** Node.js >=22.19、ES Modules、Vitest 3、Cordis Host plugin、`@deepseek-ai/dsh-credentials@^0.1.0-rc.7`、`@deepseek-ai/dsh-subprocess@^0.1.0-rc.7`、pnpm 11.7.0。

## Global Constraints

- DSH 的 `scrubbedParentEnv()` 保持不变；不得修改全局 `SENSITIVE_ENV_PATTERN`。
- 仅转发 `OPENAI_API_KEY` 和 `OPENAI_BASE_URL`，二者均使用同名 credential reference。
- 凭据值不得进入 Skill 文本、模型消息、工具参数、session event、Jizhi JSONL 或日志。
- 本临时方案覆盖所有 `ctx.subprocess` 普通 spawn 和 terminal spawn，而不区分 Skill、bash、LSP 或其他调用方。
- Provider 没有配置某个 credential 时，不在子进程环境中创建该键。
- Explicit spec env 先合并，forwarded credential snapshot 后合并；当前 credential 值覆盖同名旧值。
- 插件卸载必须恢复被包装的原始方法，并停止监听 `credentials/updated`。
- 所有实现先写失败测试，再写生产代码；每个任务独立运行相关 Vitest 检查。
- 文档必须同时更新英文和中文 README；发布包验证清单必须包含新增 `lib` 文件。

---

## 文件结构与职责

- Create: `packages/jizhi-bridge/lib/credential-forwarder.js` — 纯 Host-side forwarder，负责 credential resolution、snapshot、spawn/terminal wrapping 和 restore。
- Create: `packages/jizhi-bridge/test/credential-forwarder.test.js` — 使用 fake credential provider 与 fake subprocess service 覆盖 helper 生命周期和 env merge。
- Modify: `packages/jizhi-bridge/index.js` — 声明 `credentials`/`subprocess` 注入，启动 forwarder，监听更新并注册 effect disposal。
- Modify: `packages/jizhi-bridge/test/plugin.test.js` — 扩展 Host fixture 的 credential/subprocess/effect seam，断言插件组合与卸载行为。
- Modify: `packages/jizhi-bridge/package.json` — 增加两个 DSH runtime peer dependencies。
- Modify: `packages/jizhi-bridge/test/package.test.js` — 锁定 peer manifest、README 说明和新发布文件。
- Modify: `packages/jizhi-bridge/README.md` — 记录临时全局凭据转发、变量名称、覆盖范围和安全风险。
- Modify: `packages/jizhi-bridge/README.zh.md` — 同步中文说明。
- Modify: `scripts/verify-pack.mjs` — 将 `lib/credential-forwarder.js` 加入 jizhi-bridge 的 expected pack files。
- Modify: `pnpm-lock.yaml` — 使用 pnpm lockfile-only 安装刷新 jizhi-bridge importer 和 peer resolution。

### Task 1: 为 credential forwarder 写失败测试

**Files:**
- Create: `packages/jizhi-bridge/test/credential-forwarder.test.js`

**Interfaces:**
- Consumes: `createCredentialForwarder({ credentials, subprocess, refs? })`，其中 `credentials.resolve(ref)` 返回 `{ value, source }` 或 `undefined`；`subprocess.spawn(spec)` 和 `subprocess.spawnTerminal(spec)` 是可替换的 fake 方法。
- Produces: 测试锁定 `createCredentialForwarder` 的返回接口：`refresh(): Promise<void>`、`install(): void`、`getEnvironment(): Readonly<Record<string,string>>`、`dispose(): void`。

- [ ] **Step 1: 创建 fake seams 和最小失败断言**

  在新测试文件中创建 `credentialRef`、fake credentials map、`spawnCalls`、`terminalCalls`，并导入尚不存在的 `../lib/credential-forwarder.js`。首个测试应表达完整 env 合并契约：provider 返回两个值，`await forwarder.refresh()` 后 `forwarder.install()`，普通 spawn 与 terminal spawn 都收到 `{ ...spec.env, OPENAI_API_KEY, OPENAI_BASE_URL }`，且旧的 `OPENAI_API_KEY` 被当前 credential 覆盖。

- [ ] **Step 2: 增加缺失值和刷新行为测试**

  添加两个独立测试：一个只返回 `OPENAI_API_KEY` 并断言环境中没有 `OPENAI_BASE_URL`；另一个修改 fake provider 的值，重新调用 `refresh()` 后断言下一次 spawn 使用新值而不是旧快照。

- [ ] **Step 3: 增加 restore 生命周期测试**

  保存 fake subprocess 的原始 `spawn`/`spawnTerminal` 函数引用；安装后调用 `dispose()`，断言方法引用恢复且后续 spawn 不再带 forwarder 环境。测试还要断言 `getEnvironment()` 在 dispose 后为空。

- [ ] **Step 4: 运行测试确认是预期失败**

  Run: `corepack pnpm exec vitest run packages/jizhi-bridge/test/credential-forwarder.test.js`

  Expected: FAIL，失败原因是 `../lib/credential-forwarder.js` 尚不存在，而不是 fixture 或断言语法错误。

- [ ] **Step 5: Commit 测试红灯**

  ```bash
  git add packages/jizhi-bridge/test/credential-forwarder.test.js
  git commit -m "test: specify credential forwarder lifecycle"
  ```

### Task 2: 实现 credential-forwarder helper

**Files:**
- Create: `packages/jizhi-bridge/lib/credential-forwarder.js`
- Test: `packages/jizhi-bridge/test/credential-forwarder.test.js`

**Interfaces:**
- Consumes: `credentialRef` from `@deepseek-ai/dsh-credentials`、`credentials.resolve()`、`subprocess.spawn()`、`subprocess.spawnTerminal()`。
- Produces: `FORWARDED_CREDENTIAL_NAMES` 常量和 `createCredentialForwarder(options)`；安装后的两个 wrapper 只把 non-empty snapshot 写入显式 `env`，原始返回值和异常原样透传。

- [ ] **Step 1: 定义固定 credential names 与 snapshot 初始状态**

  导出冻结的 `FORWARDED_CREDENTIAL_NAMES = ['OPENAI_API_KEY', 'OPENAI_BASE_URL']`。`createCredentialForwarder` 接受可选 `refs`，默认使用该常量；内部用普通对象保存当前非空值，并以 `disposed` 标志阻止销毁后的异步刷新重新发布。

- [ ] **Step 2: 实现 `refresh()` 的逐项解析**

  对每个名称调用 `credentials.resolve(credentialRef(name))`。只保留返回对象中非空字符串 `value`；每次刷新整体替换 snapshot，确保 Provider 删除的 credential 不会继续残留。若解析 rejected，让错误传给调用方，不吞掉配置或 Provider 故障。

- [ ] **Step 3: 实现显式 env merge**

  使用 `withForwardedEnv(spec, environment)` 私有 helper：没有 snapshot 时返回原 spec；有值时返回浅复制 spec 和 `env: { ...(spec.env ?? {}), ...environment }`。不要复制、打印或修改 `process.env`。

- [ ] **Step 4: 实现 `install()` 和 `dispose()`**

  在 `install()` 中先保存 `subprocess.spawn.bind(subprocess)` 与 `subprocess.spawnTerminal.bind(subprocess)`，再替换实例方法；wrapper 将 transformed spec 传给原方法。`dispose()` 幂等执行，恢复原始方法并清空 snapshot；重复 install 必须抛出稳定错误，避免同一服务被重复包装。

- [ ] **Step 5: 运行 helper 测试确认通过**

  Run: `corepack pnpm exec vitest run packages/jizhi-bridge/test/credential-forwarder.test.js`

  Expected: PASS，覆盖两个 credential、缺失 credential、刷新覆盖和 dispose restore 四组行为。

- [ ] **Step 6: Commit helper**

  ```bash
  git add packages/jizhi-bridge/lib/credential-forwarder.js packages/jizhi-bridge/test/credential-forwarder.test.js
  git commit -m "feat: add temporary credential forwarder"
  ```

### Task 3: 把 helper 接入 Jizhi Host plugin

**Files:**
- Modify: `packages/jizhi-bridge/index.js`
- Modify: `packages/jizhi-bridge/test/plugin.test.js`

**Interfaces:**
- Consumes: `createCredentialForwarder()`、`ctx.credentials`、`ctx.subprocess`、Cordis `ctx.on('credentials/updated')` 和 effect cleanup。
- Produces: 插件加载完成前已完成首次 credential refresh；后续 credential 更新影响下一次 spawn；插件卸载恢复 subprocess seam。

- [ ] **Step 1: 扩展 Host fixture 的真实 seam**

  在 `hostFixture()` 增加 fake `credentials.resolve()`、fake `subprocess.spawn()`、fake `subprocess.spawnTerminal()` 和可记录 cleanup 的 `effect()`。保留现有 `skills`、`systemPrompt`、`attachments` 和 event handlers，不把真实 Harness Service 引入插件单测。

- [ ] **Step 2: 更新插件 manifest injection 失败断言**

  将 Host plugin 的预期 injection 改为 `['systemPrompt', 'attachments', 'skills', 'credentials', 'subprocess']`，先运行现有插件测试确认旧 `index.js` 会在该断言处失败。

- [ ] **Step 3: 在 `apply()` 中等待首次 refresh 并安装 wrapper**

  将 `apply(ctx)` 改为 async：创建 forwarder，`await forwarder.refresh()`，调用 `forwarder.install()`，注册 `ctx.on('credentials/updated', () => { void forwarder.refresh() })`，并用 `ctx.effect()` 注册 cleanup，按顺序移除 listener、调用 `forwarder.dispose()`。现有 Workspace/Skill/JSONL 注册逻辑保持原顺序和行为。

- [ ] **Step 4: 更新所有插件测试调用点为 await**

  因 `apply()` 现在等待首次凭据解析，把 `Jizhi bridge Host plugin` describe 中的 `apply(fixture.ctx)` 改为 `await apply(fixture.ctx)`；非 async 测试改成 async。断言仍覆盖 prompt section、brace variable、Skill Provider、inbox refresh 和 JSONL bridge。

- [ ] **Step 5: 添加插件级转发和销毁测试**

  添加一个测试：fake provider 返回 `key-v1`/`base-v1`，`await apply()` 后触发普通和 terminal fake spawn，断言两个 spec 收到值；再触发 `credentials/updated` 并让 provider 返回 `key-v2`，断言下一次 spawn 使用 v2；执行 fixture cleanup 后断言原始方法引用恢复。不要在断言或事件记录中打印 credential 值。

- [ ] **Step 6: 运行插件测试确认通过**

  Run: `corepack pnpm exec vitest run packages/jizhi-bridge/test/plugin.test.js packages/jizhi-bridge/test/credential-forwarder.test.js`

  Expected: PASS，现有 Workspace/Skill/JSONL 测试与新增 forwarder integration 测试全部通过。

- [ ] **Step 7: Commit plugin integration**

  ```bash
  git add packages/jizhi-bridge/index.js packages/jizhi-bridge/test/plugin.test.js
  git commit -m "feat: forward credentials from jizhi host plugin"
  ```

### Task 4: 更新 package contract、文档和 pack verifier

**Files:**
- Modify: `packages/jizhi-bridge/package.json`
- Modify: `packages/jizhi-bridge/test/package.test.js`
- Modify: `packages/jizhi-bridge/README.md`
- Modify: `packages/jizhi-bridge/README.zh.md`
- Modify: `scripts/verify-pack.mjs`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: 已发布的 `credential-forwarder.js` 和新的 DSH service imports。
- Produces: 可安装包声明 `@deepseek-ai/dsh-credentials`、`@deepseek-ai/dsh-subprocess` peer，文档说明临时全局范围和禁用方式，pack gate 能找到所有公开文件。

- [ ] **Step 1: 写 manifest 失败断言**

  在 `packages/jizhi-bridge/test/package.test.js` 中把期望 peerDependencies 扩展为：

  ```js
  '@deepseek-ai/dsh-credentials': '^0.1.0-rc.7',
  '@deepseek-ai/dsh-subprocess': '^0.1.0-rc.7'
  ```

  并把 `lib/credential-forwarder.js` 加入预期发布文件；先运行该测试确认 manifest 尚未满足。

- [ ] **Step 2: 更新 package manifest 和 lockfile**

  在 `packages/jizhi-bridge/package.json` 的 peerDependencies 中加入两个包，执行 `corepack pnpm install --lockfile-only`，确认 `pnpm-lock.yaml` 只更新 importer/已有 rc.7 resolution，不引入无关依赖。

- [ ] **Step 3: 更新双语 README**

  在 Behavior 小节说明插件会临时把 Harness credential provider 中的 `OPENAI_API_KEY` 和 `OPENAI_BASE_URL` 作为显式 env 转发给所有 DSH subprocess；说明这覆盖普通 bash、terminal、LSP 等调用方，且不会修改 Harness scrub 规则。中文文档明确这是临时兼容层，任何使用该插件的子进程都可能读取这些变量。

- [ ] **Step 4: 更新 pack expected set**

  在 `scripts/verify-pack.mjs` 的 jizhi-bridge expected set 中加入 `lib/credential-forwarder.js`，保持其余公开文件集合不变。

- [ ] **Step 5: 更新 package tests**

  在 `package.test.js` 断言两个 peer、helper 文件、英文 README 的 `OPENAI_API_KEY`/`subprocess`/`temporary` 文案，以及中文 README 的对应术语，避免文档遗漏安全范围。

- [ ] **Step 6: 运行 package/pack 测试**

  Run: `corepack pnpm exec vitest run packages/jizhi-bridge/test/package.test.js && corepack pnpm exec node scripts/verify-pack.mjs`

  Expected: PASS；npm pack dry-run 只包含 manifest、README、patch、现有 lib 与新 helper。

- [ ] **Step 7: Commit package contract**

  ```bash
  git add packages/jizhi-bridge/package.json packages/jizhi-bridge/test/package.test.js packages/jizhi-bridge/README.md packages/jizhi-bridge/README.zh.md scripts/verify-pack.mjs pnpm-lock.yaml
  git commit -m "docs: document global credential forwarding"
  ```

### Task 5: 全量验证并整理提交

**Files:**
- Test only: repository test commands; no additional production files.

**Interfaces:**
- Consumes: Tasks 1–4 的 helper、Host plugin wiring、manifest、README 和 pack contract。
- Produces: focused tests、完整 Vitest、pack check 均通过；最终把实现提交 squash 成一个计划 Commit。

- [ ] **Step 1: 运行 jizhi-bridge 全部测试**

  Run: `corepack pnpm exec vitest run packages/jizhi-bridge/test`

  Expected: PASS，所有 bridge、Skill Provider、JSONL 和 credential forwarding 测试通过。

- [ ] **Step 2: 运行仓库检查**

  Run: `corepack pnpm test && corepack pnpm pack:check`

  Expected: PASS；如果其他 workspace 测试失败，只处理由本次 peer/lockfile 或共享 helper 引起的失败，不修改无关包。

- [ ] **Step 3: 检查敏感值泄露和工作树**

  Run: `rg -n "OPENAI_API_KEY|OPENAI_BASE_URL|credential" packages/jizhi-bridge --glob '*.js' --glob '*.md'`，确认源码只出现变量名、没有测试 secret；再运行 `git diff --check` 和 `git status --short`。

- [ ] **Step 4: squash 实现提交**

  在所有 Task 完成、测试通过后，把本计划产生的实现提交 squash 为一个提交，保留先前已提交的设计文档提交不变：

  ```bash
  git log --oneline --decorate -8
  git rebase -i ef1d3a5^   # ef1d3a5 是本计划对应设计文档提交
  ```

  目标提交信息：`feat: forward credentials to dsh subprocesses`。

## 自检

- Spec 的目标、全局范围、首次解析、更新刷新、spawn/terminal 覆盖、销毁恢复、安全限制、测试和非目标均有对应任务。
- 未使用 `TODO`、`TBD` 或“稍后实现”等占位描述；每个测试步骤给出文件、命令和预期结果。
- helper API 在 Task 1 定义，并在 Task 2/3 中保持同名；package peer 名称与 `index.js` 的 service import 一致。
