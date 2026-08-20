# Awesome DSH Plugin 收录准备实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `@ywandy/dsh-desktop-temporary-workspace` 升级为可由 `dsh plugin add` 自动挂载的 `0.2.0` Bundle，并在不规避社区规则的前提下完成 Awesome 收录前置检查。

**Architecture:** `cordis.patch.yml` 继续由 `package.json#dsh.bundle.patch` 暴露给 DSH Loader；`0.2.0` 的 Host/Client 改为固定目录 Ensure 与 priority shadow Picker，同时保持插件 ID、settings namespace 和自动挂载方式。测试锁定 manifest、组合补丁和 tarball 文件集合，文档声明兼容原始 DSH Desktop `origin/main`。

**Tech Stack:** Node.js 22.19/24、pnpm 11.7.0、Vitest 3、npm package manifest、Cordis YAML patch、GitHub Actions。

## Global Constraints

- 包名固定为 `@ywandy/dsh-desktop-temporary-workspace`，修正版固定为 `0.2.0`。
- Node.js 最低版本保持 `22.19`，pnpm 固定为 `11.7.0`。
- `dsh.bundle.patch` 必须精确指向 `./cordis.patch.yml`。
- Cordis 插件 ID 保持 `dsh-desktop-temporary-workspace`，包名保持 `@ywandy/dsh-desktop-temporary-workspace`。
- 保留现有 `dsh.client` 注入声明、Host/Client 入口、设置命名空间与安全边界。
- 兼容性固定为：已验证原始 DSH Desktop `origin/main` 所用 `@deepseek-ai/dsh@0.1.0-rc.7`，不依赖任何 Desktop 扩展补丁。
- npm tarball 只允许 7 个文件：`LICENSE`、`README.md`、`README.zh.md`、`client.js`、`cordis.patch.yml`、`index.js`、`package.json`。
- 不读取或复述聊天中出现过的 npm Token；发布只使用本机已登录的 npm 会话。
- 不创建空提交或无意义拆分来满足 Awesome 的 10 提交门槛。
- 只有仓库创建满 24 小时且默认分支达到至少 10 个真实提交时，才允许创建 Awesome 收录 PR。

---

## 文件职责

- `packages/desktop-temporary-workspace/cordis.patch.yml`：把已安装 npm 包插入 DSH Profile。
- `packages/desktop-temporary-workspace/package.json`：声明 `dsh.bundle`、保留 `dsh.client`、提升版本并维护发布白名单。
- `packages/desktop-temporary-workspace/test/package.test.js`：验证版本、Bundle manifest、Cordis patch 与 Client 注入契约。
- `scripts/verify-pack.mjs`：验证 npm tarball 严格包含 7 个公开文件。
- `packages/desktop-temporary-workspace/README.md`：英文安装与兼容说明。
- `packages/desktop-temporary-workspace/README.zh.md`：中文安装与兼容说明。
- `README.md`：仓库级英文 Bundle 与聚合 Bundle 说明。
- `README.zh.md`：仓库级中文 Bundle 与聚合 Bundle 说明。

### Task 1: 增加可自动挂载的 Bundle 契约

**Files:**
- Create: `packages/desktop-temporary-workspace/cordis.patch.yml`
- Modify: `packages/desktop-temporary-workspace/package.json:13-51`
- Modify: `packages/desktop-temporary-workspace/test/package.test.js:1-40`
- Modify: `scripts/verify-pack.mjs:11-18`
- Test: `packages/desktop-temporary-workspace/test/package.test.js`

**Interfaces:**
- Consumes: DSH Loader 的 `package.json#dsh.bundle.patch` 约定和现有包入口 `@ywandy/dsh-desktop-temporary-workspace`。
- Produces: `dsh.bundle.patch: "./cordis.patch.yml"`，以及精确插入插件的 `cordis.patch.yml`。

- [ ] **Step 1: 为 Bundle manifest 和 Cordis patch 写失败测试**

将测试文件顶部常量改为：

```js
const packageDirectoryUrl = new URL('../', import.meta.url)
const manifestUrl = new URL('package.json', packageDirectoryUrl)
const patchUrl = new URL('cordis.patch.yml', packageDirectoryUrl)
```

在 `published package manifest` 分组中加入：

```js
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
```

并把发布白名单断言改为：

```js
expect(manifest.files).toEqual([
  'index.js',
  'client.js',
  'cordis.patch.yml',
  'README.md',
  'README.zh.md',
  'LICENSE'
])
```

- [ ] **Step 2: 运行测试并确认先失败**

Run:

```sh
pnpm exec vitest run packages/desktop-temporary-workspace/test/package.test.js
```

Expected: FAIL；读取 `cordis.patch.yml` 时得到 `ENOENT`，且 manifest 尚无 `dsh.bundle`。

- [ ] **Step 3: 写入最小 Bundle 实现**

创建 `packages/desktop-temporary-workspace/cordis.patch.yml`：

```yaml
- insert:
    - id: dsh-desktop-temporary-workspace
      name: '@ywandy/dsh-desktop-temporary-workspace'
```

在 `package.json` 的 `files` 中将 `cordis.patch.yml` 放在 `client.js` 后；将 `dsh` 改为：

```json
"dsh": {
  "bundle": {
    "patch": "./cordis.patch.yml"
  },
  "client": {
    "inject": [
      "@deepseek-ai/dsh-client-locale",
      "@deepseek-ai/dsh-client-ui-settings",
      "@deepseek-ai/dsh-client-ui-settings-plugins",
      "@deepseek-ai/dsh-client-ui-workspace"
    ],
    "platform": "web"
  }
}
```

- [ ] **Step 4: 运行包级测试并确认通过**

Run:

```sh
pnpm exec vitest run packages/desktop-temporary-workspace/test/package.test.js
```

Expected: PASS，`published package manifest` 分组全部通过。

- [ ] **Step 5: 先运行旧 pack gate 并确认它能发现新增文件**

Run:

```sh
pnpm pack:check
```

Expected: FAIL，并报告 `unexpected: cordis.patch.yml`。

- [ ] **Step 6: 更新 pack gate 的精确文件集合**

把 `scripts/verify-pack.mjs` 中的 `expected` 改为：

```js
const expected = new Set([
  'LICENSE',
  'README.md',
  'README.zh.md',
  'client.js',
  'cordis.patch.yml',
  'index.js',
  'package.json'
])
```

- [ ] **Step 7: 运行 Bundle 任务的完整校验**

Run:

```sh
pnpm exec vitest run packages/desktop-temporary-workspace/test/package.test.js
pnpm pack:check
```

Expected: 两条命令均退出 0；pack gate 输出 `pack contents verified`。

- [ ] **Step 8: 提交 Bundle 契约检查点**

```sh
git add packages/desktop-temporary-workspace/cordis.patch.yml \
  packages/desktop-temporary-workspace/package.json \
  packages/desktop-temporary-workspace/test/package.test.js \
  scripts/verify-pack.mjs
git commit -m "feat: add installable DSH bundle manifest"
```

### Task 2: 提升版本并同步中英文安装文档

**Files:**
- Modify: `packages/desktop-temporary-workspace/package.json:3`
- Modify: `packages/desktop-temporary-workspace/test/package.test.js:7-21`
- Modify: `packages/desktop-temporary-workspace/README.md:13-34`
- Modify: `packages/desktop-temporary-workspace/README.zh.md:13-34`
- Modify: `README.md:17-28`
- Modify: `README.zh.md:17-28`
- Test: `packages/desktop-temporary-workspace/test/package.test.js`

**Interfaces:**
- Consumes: Task 1 产生的 `dsh.bundle.patch` 与 `cordis.patch.yml`。
- Produces: npm 版本 `0.2.0`，以及无需手工修改 Profile、兼容 stock Desktop 的中英文安装说明。

- [ ] **Step 1: 先把 manifest 版本断言改为 0.2.0**

将测试中的版本改为：

```js
version: '0.2.0',
```

- [ ] **Step 2: 运行版本测试并确认先失败**

Run:

```sh
pnpm exec vitest run packages/desktop-temporary-workspace/test/package.test.js
```

Expected: FAIL；实际版本为 `0.1.0`，期望版本为 `0.2.0`。

- [ ] **Step 3: 将 npm 包版本提升到 0.2.0**

把 `packages/desktop-temporary-workspace/package.json` 改为：

```json
"version": "0.2.0",
```

- [ ] **Step 4: 将英文安装段落改为 Bundle 自动挂载说明**

保留安装命令，并用以下正文替换手工 `cordis.patch.yml` 指引：

```markdown
The package declares a `dsh.bundle` manifest, so `dsh plugin add` installs and mounts it automatically. No manual `cordis.patch.yml` edit is required.

Verify the composed tree before starting the profile:
```

命令块保持：

```sh
dsh --profile web --dump-config
dsh web
```

- [ ] **Step 5: 将中文安装段落改为 Bundle 自动挂载说明**

保留安装命令，并用以下正文替换手工 `cordis.patch.yml` 指引：

```markdown
该包声明了 `dsh.bundle` manifest，`dsh plugin add` 会自动安装并挂载插件，无需手工修改 `cordis.patch.yml`。

启动前检查最终组合：
```

命令块保持：

```sh
dsh --profile web --dump-config
dsh web
```

- [ ] **Step 6: 同步仓库级安装说明，并区分单包 Bundle 与聚合 Bundle**

在英文包表格后、`## Compatibility` 前加入：

````markdown
## Install

```sh
dsh plugin --profile web add @ywandy/dsh-desktop-temporary-workspace
```

The package's `dsh.bundle` manifest mounts it automatically. See the package README for host compatibility and configuration details.
````

在中文包表格后、`## 兼容性` 前加入：

````markdown
## 安装

```sh
dsh plugin --profile web add @ywandy/dsh-desktop-temporary-workspace
```

包内的 `dsh.bundle` manifest 会自动挂载插件。宿主兼容范围和配置方式见包级 README。
````

将英文 README 的末句：

```markdown
Each directory under `packages/` is an independent npm package. Add a bundle only when at least two plugins need a shared composition.
```

替换为：

```markdown
Each directory under `packages/` is an independent npm package and may declare its own `dsh.bundle` installation manifest. Add an aggregate suite bundle only when at least two plugins need a shared composition.
```

将中文 README 的对应句替换为：

```markdown
`packages/` 下的每个目录都是独立 npm 包，并可声明自己的 `dsh.bundle` 安装清单。只有出现至少两个需要统一组合的插件时，才新增聚合 Suite Bundle。
```

- [ ] **Step 7: 运行版本和全文校验**

Run:

```sh
pnpm exec vitest run packages/desktop-temporary-workspace/test/package.test.js
rg -n "does not mount an ordinary plugin|只安装依赖，不会自动挂载|Add a bundle only|只有出现至少两个需要统一组合的插件时，才新增 Bundle" \
  README.md README.zh.md \
  packages/desktop-temporary-workspace/README.md \
  packages/desktop-temporary-workspace/README.zh.md
```

Expected: Vitest PASS；`rg` 退出 1 且没有输出，表示旧说明已全部移除。

- [ ] **Step 8: 提交版本与文档检查点**

```sh
git add packages/desktop-temporary-workspace/package.json \
  packages/desktop-temporary-workspace/test/package.test.js \
  packages/desktop-temporary-workspace/README.md \
  packages/desktop-temporary-workspace/README.zh.md \
  README.md README.zh.md
git commit -m "docs: prepare temporary workspace bundle release"
```

### Task 3: 执行完整验证并记录收录资格

**Files:**
- Verify only: repository working tree and remote metadata

**Interfaces:**
- Consumes: Task 1 的 Bundle 文件集合和 Task 2 的 `0.2.0` manifest/文档。
- Produces: 可供分支收尾评审的测试证据，以及“允许创建 PR”或“等待资格”的明确结论。

- [ ] **Step 1: 运行全部测试和 pack gate**

Run:

```sh
pnpm check
```

Expected: 当前全部 Vitest 测试通过，最后输出 `pack contents verified`。

- [ ] **Step 2: 匿名检查 npm tarball 元数据**

Run:

```sh
temp_dir=$(mktemp -d)
npm pack ./packages/desktop-temporary-workspace \
  --pack-destination "$temp_dir" \
  --json \
  --userconfig /dev/null
tar -tzf "$temp_dir/ywandy-dsh-desktop-temporary-workspace-0.2.0.tgz" | sort
```

Expected: npm 输出版本 `0.2.0`；tar 列表只有 `package/` 下的 7 个约定文件。

- [ ] **Step 3: 检查工作树差异与敏感信息**

Run:

```sh
git status --short
git diff --check HEAD~2..HEAD
git diff --name-only HEAD~2..HEAD
git grep -nE 'npm_[A-Za-z0-9]{20,}|gh[opsu]_[A-Za-z0-9]+' HEAD -- . ':!pnpm-lock.yaml'
```

Expected: 工作树为空；`diff --check` 无输出；文件列表只包含插件、测试、lockfile、设计和计划文档；敏感信息扫描退出 1 且无输出。

- [ ] **Step 4: 查询 Awesome 的两个自动门槛**

Run:

```sh
gh api repos/ywandy/dsh-plugins --jq '.created_at'
gh api 'repos/ywandy/dsh-plugins/commits?per_page=100' --jq 'length'
```

Expected: 记录仓库创建时间与默认分支真实提交数。只有年龄至少 24 小时且提交数至少 10 时，结论才是“允许准备收录 PR”；否则结论是“等待收录资格”，且本计划不得 Fork 或创建上游 PR。

- [ ] **Step 5: 进入开发分支收尾流程**

执行 `superpowers:finishing-a-development-branch`。在合并目标分支前，把本任务实现提交 squash 为一个计划 Commit；设计文档和实施计划可保留为先行文档提交。合并完成后再发布 npm `0.2.0` 与 GitHub `v0.2.0`，避免 Release 标签指向未合入主线的临时提交。

## 合并后的发布清单

以下操作只在 Task 3 全部通过、实现已合入 `main` 后执行：

1. 使用本机 npm 登录会话运行：

   ```sh
   npm publish ./packages/desktop-temporary-workspace --access public
   ```

2. 匿名验证 registry：

   ```sh
   npm view @ywandy/dsh-desktop-temporary-workspace@0.2.0 version dist.tarball \
     --userconfig /dev/null \
     --registry https://registry.npmjs.org/
   npm pack @ywandy/dsh-desktop-temporary-workspace@0.2.0 \
     --dry-run --json \
     --userconfig /dev/null \
     --registry https://registry.npmjs.org/
   ```

3. 创建 Release：

   ```sh
   git tag v0.2.0
   git push origin main v0.2.0
   gh release create v0.2.0 --repo ywandy/dsh-plugins \
     --title "@ywandy/dsh-desktop-temporary-workspace v0.2.0" \
     --notes "Adds a stock-compatible Workspace-picker option for ungrouped sessions sharing one configurable default directory."
   ```

4. 再次检查 Awesome 门槛。若仍未同时满足“仓库创建满 24 小时”和“默认分支至少 10 个真实提交”，停止在“等待收录资格”，不创建失败 PR。
