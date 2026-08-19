# DSH Plugins Monorepo 发布实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建并发布 `ywandy/dsh-plugins` monorepo，首个公开包为 `@ywandy/dsh-desktop-temporary-workspace@0.1.0`。

**Architecture:** 根仓库只管理 pnpm workspace、测试、文档与 CI；每个 `packages/*` 子目录都是独立可发布的 DSH 插件。首个包复用 `dsh-desktop` 已验证的 Host/Client 实现，但独立声明 npm 元数据，并明确限制为兼容带工作区扩展补丁的 DSH Desktop。

**Tech Stack:** Node.js 22.19+/24、ES Modules、pnpm 11.7.0、Vitest、GitHub Actions、GitHub CLI、npm registry。

## 全局约束

- GitHub 目标固定为公开仓库 `ywandy/dsh-plugins`，默认分支为 `main`。
- npm 包名固定为 `@ywandy/dsh-desktop-temporary-workspace`，首版固定为 `0.1.0`。
- 内部 Cordis/Client ID 与 settings namespace 保持 `dsh-desktop-temporary-workspace`，不得随 npm scope 改名。
- 首版只发布一个插件，不创建只有一个成员的 Bundle。
- README 必须明确：插件当前依赖 DSH Desktop 的工作区创建来源和延迟 Session 扩展，不兼容原版 `@deepseek-ai/dsh@0.1.0-rc.7`。
- npm 只发布运行时入口、双语 README、LICENSE 和 package manifest。
- 不修改 `/Users/yewei/yyw/project/dsh-desktop/package-lock.json` 与 `/Users/yewei/yyw/project/dsh-desktop/pnpm-lock.yaml`。
- 各任务允许产生审查提交；最终合并到 `main` 前，将所有实现任务 squash 为一个计划提交。
- npm 未登录或账号不拥有 `@ywandy` scope 时必须停止发布，不更换包名或冒充成功。

---

## 文件职责

- `package.json`：私有 workspace 根包，固定 pnpm 版本并提供 test/pack 脚本。
- `pnpm-workspace.yaml`：只发现 `packages/*`。
- `.gitignore`：忽略依赖、覆盖率、tarball 和临时打包输出。
- `packages/desktop-temporary-workspace/package.json`：公开 npm manifest、exports、DSH Client 元数据、依赖和发布文件白名单。
- `packages/desktop-temporary-workspace/index.js`：Host 配置、路径创建、安全接口和 Cordis apply。
- `packages/desktop-temporary-workspace/client.js`：Web Client 来源、设置卡、locale 和 slot 注册。
- `packages/desktop-temporary-workspace/test/plugin.test.js`：Host/Client 核心行为测试。
- `packages/desktop-temporary-workspace/test/package.test.js`：manifest 与公开包契约测试。
- `scripts/verify-pack.mjs`：执行 dry-run pack 并拒绝意外文件或缺失文件。
- `README.md` / `README.zh.md`：仓库目录、兼容边界与贡献说明。
- `packages/desktop-temporary-workspace/README.md` / `README.zh.md`：插件安装、挂载、配置与兼容说明。
- `.github/workflows/ci.yml`：Node 22.19/24 的测试与打包验证。

---

### Task 1：建立 monorepo 与 npm manifest 契约

**Files:**
- Create: `.gitignore`
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `packages/desktop-temporary-workspace/test/package.test.js`
- Create: `packages/desktop-temporary-workspace/package.json`
- Create: `packages/desktop-temporary-workspace/LICENSE`

**Interfaces:**
- Consumes: 设计文档中的仓库名、包名、版本与发布白名单。
- Produces: workspace 脚本 `pnpm test`、`pnpm pack:check`，以及可由后续任务填入入口的公开 npm manifest。

- [ ] **Step 1：创建 workspace 基础配置**

使用 `apply_patch` 创建根 `package.json`：

```json
{
  "name": "dsh-plugins",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.7.0",
  "engines": {
    "node": ">=22.19"
  },
  "scripts": {
    "test": "vitest run",
    "pack:check": "node scripts/verify-pack.mjs",
    "check": "pnpm test && pnpm pack:check"
  },
  "devDependencies": {
    "vitest": "^3.2.4"
  }
}
```

创建 `pnpm-workspace.yaml`：

```yaml
packages:
  - 'packages/*'
```

创建 `.gitignore`：

```gitignore
node_modules/
coverage/
*.tgz
.DS_Store
```

- [ ] **Step 2：先写 manifest 失败测试**

创建 `packages/desktop-temporary-workspace/test/package.test.js`：

```js
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
```

- [ ] **Step 3：安装测试工具并验证 RED**

Run：

```bash
corepack pnpm install
corepack pnpm test packages/desktop-temporary-workspace/test/package.test.js
```

Expected：测试因 `packages/desktop-temporary-workspace/package.json` 不存在而 FAIL；不得是语法错误。

- [ ] **Step 4：创建最小公开 manifest 与许可证**

以 `/Users/yewei/yyw/project/dsh-desktop/packages/dsh-desktop-temporary-workspace/package.json` 为依赖基线，创建子包 manifest；精确修改为：

- `name: "@ywandy/dsh-desktop-temporary-workspace"`；
- `version: "0.1.0"`；
- `private: false`；
- 添加上述 `files`；
- 添加 `keywords: ["deepseek-harness", "dsh", "dsh-plugin", "workspace"]`；
- 添加 `repository.url: "git+https://github.com/ywandy/dsh-plugins.git"` 与 `repository.directory: "packages/desktop-temporary-workspace"`；
- 添加 `homepage`、`bugs.url`、`publishConfig.access: "public"`、`engines.node: ">=22.19"`；
- 保留原 `exports`、`dsh.client`、dependencies、peerDependencies 和 MIT license。

将标准 MIT 许可证文本写入根 `LICENSE`，版权行为 `Copyright (c) 2026 ywandy`，并复制为包内 `LICENSE`。

- [ ] **Step 5：验证 GREEN**

Run：

```bash
corepack pnpm test packages/desktop-temporary-workspace/test/package.test.js
git diff --check
```

Expected：3 tests PASS，`git diff --check` 无输出。

- [ ] **Step 6：提交任务审查点**

```bash
git add .gitignore package.json pnpm-workspace.yaml pnpm-lock.yaml LICENSE packages/desktop-temporary-workspace/package.json packages/desktop-temporary-workspace/LICENSE packages/desktop-temporary-workspace/test/package.test.js
git commit -m "build: scaffold DSH plugin monorepo"
```

---

### Task 2：迁移 Host/Client 插件并保留核心行为

**Files:**
- Create: `packages/desktop-temporary-workspace/test/plugin.test.js`
- Create: `packages/desktop-temporary-workspace/index.js`
- Create: `packages/desktop-temporary-workspace/client.js`

**Interfaces:**
- Consumes: Task 1 的公开 exports 和 `/Users/yewei/yyw/project/dsh-desktop/packages/dsh-desktop-temporary-workspace/{index.js,client.js}` 已验证实现。
- Produces: `defaultRootDirectory(home?: string): string`、`formatDirectoryName(date: Date): string`、`normalizeRootDirectory(value: string, pathApi?): string`、`createTemporaryDirectory(root: string, now?: Date): Promise<string>`、`isTrustedRequest(req, mutation?): boolean`、`handleCreateRequest(...)`、Host/Client `apply`。

- [ ] **Step 1：先迁移独立行为测试**

以 `/Users/yewei/yyw/project/dsh-desktop/test/temporary-workspace.test.js` 为基线创建包内测试，并做以下精确裁剪：

- Host import 改为 `../index.js`；
- Client bundle 路径改为 `new URL('../client.js', import.meta.url)`；
- 保留 directory naming、directory creation、create route、host configuration、client plugin 五组测试；
- 删除 `temporary workspace desktop composition` 组，因为该组验证宿主仓库 patch 与 deployment；
- 保留 `loadClientBundle()` 的 VM 注入与 slot mock，使测试执行真实 `client.js`。

- [ ] **Step 2：验证 RED**

Run：

```bash
corepack pnpm test packages/desktop-temporary-workspace/test/plugin.test.js
```

Expected：测试因 `../index.js` 或 `../client.js` 不存在而 FAIL；不得是错误的相对路径。

- [ ] **Step 3：迁移最小生产实现**

使用 `apply_patch` 将以下两个已验证文件逐字迁入新包：

```text
/Users/yewei/yyw/project/dsh-desktop/packages/dsh-desktop-temporary-workspace/index.js
  -> packages/desktop-temporary-workspace/index.js

/Users/yewei/yyw/project/dsh-desktop/packages/dsh-desktop-temporary-workspace/client.js
  -> packages/desktop-temporary-workspace/client.js
```

不得修改默认根目录、目录命名、同源安全、延迟 activation、设置卡或内部插件 ID。迁移后运行：

```bash
cmp /Users/yewei/yyw/project/dsh-desktop/packages/dsh-desktop-temporary-workspace/index.js packages/desktop-temporary-workspace/index.js
cmp /Users/yewei/yyw/project/dsh-desktop/packages/dsh-desktop-temporary-workspace/client.js packages/desktop-temporary-workspace/client.js
```

Expected：两个 `cmp` 都退出 0。

- [ ] **Step 4：验证 GREEN 与回归**

Run：

```bash
corepack pnpm test
```

Expected：package manifest 与 plugin tests 全部 PASS，无 warning/error。

- [ ] **Step 5：提交任务审查点**

```bash
git add packages/desktop-temporary-workspace/index.js packages/desktop-temporary-workspace/client.js packages/desktop-temporary-workspace/test/plugin.test.js
git commit -m "feat: add temporary workspace plugin"
```

---

### Task 3：补齐双语文档、pack gate 与 CI

**Files:**
- Create: `README.md`
- Create: `README.zh.md`
- Create: `packages/desktop-temporary-workspace/README.md`
- Create: `packages/desktop-temporary-workspace/README.zh.md`
- Create: `scripts/verify-pack.mjs`
- Create: `.github/workflows/ci.yml`
- Modify: `packages/desktop-temporary-workspace/test/package.test.js`

**Interfaces:**
- Consumes: Task 1 的 manifest/files 与 Task 2 的插件能力。
- Produces: 用户可执行的安装/挂载说明、可复现的包内容检查、Node 22.19/24 CI。

- [ ] **Step 1：先扩展文档与发布契约失败测试**

向 `test/package.test.js` 增加：

```js
it('documents the desktop-only compatibility boundary', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8')
  expect(readme).toContain('DSH Desktop')
  expect(readme).toContain('not compatible with stock `@deepseek-ai/dsh@0.1.0-rc.7`')
  expect(readme).toContain('dsh plugin --profile web add @ywandy/dsh-desktop-temporary-workspace')
  expect(readme).toContain("name: '@ywandy/dsh-desktop-temporary-workspace'")
})
```

- [ ] **Step 2：验证 RED**

Run：

```bash
corepack pnpm test packages/desktop-temporary-workspace/test/package.test.js
```

Expected：因包级 `README.md` 不存在而 FAIL。

- [ ] **Step 3：编写双语 README**

仓库级 README 必须包含：项目定位、包列表、开发命令、兼容声明、贡献方式和 `dsh-plugin` 链接。

包级 README 必须包含：功能、延迟创建语义、默认目录、配置、兼容边界、以下安装命令与以下 patch：

```bash
dsh plugin --profile web add @ywandy/dsh-desktop-temporary-workspace
```

```yaml
- insert:
    - id: dsh-desktop-temporary-workspace
      name: '@ywandy/dsh-desktop-temporary-workspace'
```

英文 README 必须逐字包含测试要求的兼容句；中文 README 使用“当前不兼容原版 `@deepseek-ai/dsh@0.1.0-rc.7`”。

- [ ] **Step 4：验证 README GREEN**

Run：

```bash
corepack pnpm test packages/desktop-temporary-workspace/test/package.test.js
```

Expected：全部 PASS。

- [ ] **Step 5：实现 pack gate**

创建 `scripts/verify-pack.mjs`，使用 `execFileSync('npm', ['pack', packageDir, '--dry-run', '--json'])` 解析 JSON；断言 tarball 文件路径集合严格等于：

```js
const expected = new Set([
  'LICENSE',
  'README.md',
  'README.zh.md',
  'client.js',
  'index.js',
  'package.json'
])
```

集合不一致时打印 missing/unexpected 并退出 1；一致时输出 `pack contents verified`。

- [ ] **Step 6：创建 CI**

`.github/workflows/ci.yml` 固定：

```yaml
name: CI
on:
  push:
  pull_request:
jobs:
  check:
    strategy:
      matrix:
        node: ['22.19.0', '24']
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 11.7.0
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm check
```

- [ ] **Step 7：运行全部验证**

Run：

```bash
corepack pnpm check
git diff --check
```

Expected：全部 tests PASS，输出 `pack contents verified`，diff check 无输出。

- [ ] **Step 8：提交任务审查点**

```bash
git add README.md README.zh.md packages/desktop-temporary-workspace/README.md packages/desktop-temporary-workspace/README.zh.md packages/desktop-temporary-workspace/test/package.test.js scripts/verify-pack.mjs .github/workflows/ci.yml
git commit -m "docs: prepare temporary workspace release"
```

---

### Task 4：最终评审、squash 并合并本地 main

**Files:**
- Review: repository-wide tracked files
- Modify: Git history only

**Interfaces:**
- Consumes: Tasks 1–3 的完整工作树与通过的检查。
- Produces: `main` 上一个计划实现提交，保留此前设计与计划文档提交。

- [ ] **Step 1：进行发布前静态评审**

Run：

```bash
git status --short
git diff main...HEAD --check
rg -n "T[B]D|T[O]DO|private.?[:=].?true|dsh-desktop-temporary-workspace.*file:" . --glob '!docs/superpowers/**'
```

Expected：只有预期文件；无 whitespace error；不得存在发布占位符、子包 `private: true` 或本地 `file:` 发布依赖。

- [ ] **Step 2：运行最终验证**

Run：

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm check
```

Expected：退出 0。

- [ ] **Step 3：将实现任务 squash 为一个计划提交**

在功能分支执行：

```bash
git reset --soft main
git commit -m "feat: publish DSH temporary workspace plugin"
```

Expected：`git log main..HEAD --oneline` 只有一个提交。

- [ ] **Step 4：合并到本地 main**

```bash
git switch main
git merge --ff-only codex/publish-temporary-workspace
```

Expected：main 快进到计划提交，工作树干净。

---

### Task 5：创建 GitHub 仓库、发布 npm 与 GitHub Release

**Files:**
- External: `https://github.com/ywandy/dsh-plugins`
- External: `https://www.npmjs.com/package/@ywandy/dsh-desktop-temporary-workspace`

**Interfaces:**
- Consumes: Task 4 的干净 `main`、GitHub 登录和 npm `@ywandy` 发布权限。
- Produces: 公开 GitHub 仓库、Topics、通过的 CI、npm `0.1.0` 和 GitHub Release `v0.1.0`。

- [ ] **Step 1：确认远端目标不存在或为空**

Run：

```bash
gh repo view ywandy/dsh-plugins --json nameWithOwner,isPrivate,url
```

Expected：若 404，进入创建；若已存在则停止并检查，不覆盖任何远端历史。

- [ ] **Step 2：创建公开仓库并推送**

当目标不存在时运行：

```bash
gh repo create ywandy/dsh-plugins --public --source=. --remote=origin --push --description "Community plugins for DeepSeek Harness"
```

Expected：远端 `main` 与本地一致。

- [ ] **Step 3：添加并验证 Topics**

```bash
gh repo edit ywandy/dsh-plugins --add-topic dsh-plugin --add-topic deepseek-harness --add-topic dsh
gh repo view ywandy/dsh-plugins --json repositoryTopics,url
```

Expected：返回三个 Topics。

- [ ] **Step 4：等待 CI 完成**

```bash
gh run list --repo ywandy/dsh-plugins --limit 1
gh run watch --repo ywandy/dsh-plugins --exit-status
```

Expected：Node 22.19 与 24 matrix 均成功；失败时停止发布并修复。

- [ ] **Step 5：检查 npm 身份与 scope**

```bash
npm whoami
npm view @ywandy/dsh-desktop-temporary-workspace@0.1.0 version
```

Expected：`npm whoami` 成功；包查询为 404 表示版本尚未发布。若未登录或 scope 无权限，停止并要求用户完成 `npm login`。

- [ ] **Step 6：发布 npm 公共包**

在 `packages/desktop-temporary-workspace` 目录执行：

```bash
npm publish --access public
```

Expected：发布 `@ywandy/dsh-desktop-temporary-workspace@0.1.0`；不得在失败后盲目重复执行。

- [ ] **Step 7：验证 registry**

```bash
npm view @ywandy/dsh-desktop-temporary-workspace@0.1.0 name version dist.tarball repository --json
```

Expected：name/version/repository 与 manifest 一致，dist.tarball 存在。

- [ ] **Step 8：创建标签和 GitHub Release**

```bash
git tag -a v0.1.0 -m "v0.1.0"
git push origin v0.1.0
gh release create v0.1.0 --repo ywandy/dsh-plugins --title "v0.1.0" --notes "Initial release of @ywandy/dsh-desktop-temporary-workspace. Requires the DSH Desktop workspace-source and deferred-session extensions."
```

Expected：Release 指向已推送标签并明确兼容边界。

- [ ] **Step 9：最终外部验收**

```bash
gh repo view ywandy/dsh-plugins --json url,defaultBranchRef,repositoryTopics
gh release view v0.1.0 --repo ywandy/dsh-plugins --json url,tagName,isDraft,isPrerelease
npm view @ywandy/dsh-desktop-temporary-workspace@0.1.0 version
```

Expected：默认分支 `main`，Topics 完整，Release 非 draft，npm version 为 `0.1.0`。
