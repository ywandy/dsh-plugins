# Awesome DSH Plugin 收录准备设计

## 目标

让 `@ywandy/dsh-desktop-temporary-workspace` 符合
`awesome-dsh-plugin/awesome-dsh-plugin` 的安装与收录规则，并在全部硬性门槛满足后提交上游 Pull Request。

本次发布目标更新为可由 `dsh plugin add` 自动挂载、兼容原始 DSH Desktop `origin/main` 的默认执行目录插件 `0.2.0`。收录 PR 必须等到 GitHub 仓库创建满 24 小时且默认分支拥有至少 10 个真实提交后再创建；不得用空提交或无意义拆分规避规则。

## 当前差距

- 包只声明了 `dsh.client`，没有收录规则要求的 `dsh.bundle`。
- 安装后仍需用户手工编辑 Profile 的 `cordis.patch.yml`。
- GitHub 仓库创建时间不足 24 小时。
- 默认分支目前只有 4 个提交，低于 10 个提交的自动检查门槛。

## Bundle 设计

插件包新增 `cordis.patch.yml`：

```yaml
- insert:
    - id: dsh-desktop-temporary-workspace
      name: '@ywandy/dsh-desktop-temporary-workspace'
```

`package.json` 在保留现有 `dsh.client` 声明的同时新增：

```json
{
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  }
}
```

`cordis.patch.yml` 加入发布文件白名单。安装命令保持为：

```sh
dsh plugin --profile web add @ywandy/dsh-desktop-temporary-workspace
```

DSH Loader 读取 `dsh.bundle.patch` 后自动把 Host/Client 插件插入 Web Profile，不再要求用户手工修改组合补丁。插件内部 ID、设置命名空间和安装命令保持不变；`0.2.0` 将运行行为升级为从现有 Workspace Picker 创建共用固定目录的未分组 Session。

## 兼容性边界

插件 `0.2.0` 只使用原始 DSH Desktop `origin/main` 所用 `@deepseek-ai/dsh@0.1.0-rc.7` 已公开的能力：`conversation.hero.workspace` single slot、Slot priority shadow、`ctx.sessions.create({ cwd })`、`ctx.sessions.open(id)`、Workspace 列表与目录选择服务。它不依赖任何 Desktop 扩展补丁。

## 版本与文档

- npm 版本从已发布的 `0.1.x` 提升为 `0.2.0`，不覆盖已发布版本，并明确标注目录生命周期的破坏性变化。
- 包级中英文 README 删除手工编辑 `cordis.patch.yml` 的步骤，改为说明 Bundle 会自动挂载。
- 仓库级中英文 README 同步安装方式与兼容性边界。
- GitHub 创建 `v0.2.0` Release，并保留所有 `v0.1.x` 历史版本。

## 测试与发布校验

核心测试覆盖：

- manifest 同时声明 `dsh.bundle.patch` 与既有 `dsh.client`；
- `cordis.patch.yml` 精确插入预期插件 ID 和 npm 包名；
- npm tarball 包含新增补丁，且没有意外文件；
- 现有 Host、Client 与安全边界测试继续通过；
- Node.js 22.19 和 24 的 GitHub Actions 均通过；
- 发布后匿名 `npm view` 与 `npm pack` 能读取 `0.2.0`。

发布只使用本机已登录的 npm 会话，不读取或复述聊天中出现过的 Token。若身份验证或二次验证失败，停止发布并报告，不反复修改版本。

## Awesome 收录条目

仓库属于 monorepo，收录 URL 指向子包：

```yaml
url: https://github.com/ywandy/dsh-plugins/tree/main/packages/desktop-temporary-workspace
name: ywandy/dsh-plugins#desktop-temporary-workspace
description:
  en: Adds a default Workspace-picker option that creates ungrouped sessions sharing one configurable working directory.
  zh: 在现有 Workspace 选择器中增加默认执行目录选项，创建共用一个可配置工作目录的未分组 Session。
tags:
  - workflow
```

上游文件名使用：

```text
data/plugins/ywandy__dsh-plugins--packages-desktop-temporary-workspace.yml
```

条目描述只陈述代码能够验证的行为，不使用营销措辞。分类选 `workflow`，因为插件改变的是开始任务时的工作区与会话创建流程。

## 提交流程与门槛

1. 在功能分支实现 Bundle、测试和文档修改。
2. 本地检查通过后，把本任务提交整理为一个计划提交再合入 `main`。
3. 推送 `main`，等待 CI 通过后发布 npm `0.2.0` 和 GitHub `v0.2.0`。
4. 重新检查仓库创建时间和默认分支提交数。
5. 只有在仓库创建满 24 小时且提交数达到 10 个真实提交后，才 Fork Awesome 仓库。
6. 添加一个 YAML 条目，运行 `npm ci` 和 `node scripts/generate-readme.mjs`，只提交该条目与生成的两个 README。
7. 推送收录分支并向 `awesome-dsh-plugin/awesome-dsh-plugin:main` 创建 PR。

若 Bundle 已发布但仓库成熟度门槛尚未满足，任务状态应明确保持“等待收录资格”，不得创建必然失败的 PR。

## 验收标准

- `npm pack` 中包含 `cordis.patch.yml`，manifest 指向路径正确；
- 安装文档不再要求手工挂载插件；
- 当前插件、manifest 与 Bundle 自动测试全部通过；
- npm 和 GitHub Release 均存在 `0.2.0`；
- 不制造空提交满足 Awesome 门槛；
- 满足全部自动门槛后，上游 PR 只包含本插件条目和生成文件，CI 通过。
