# DSH 社区插件 Monorepo 设计

## 目标

创建公开仓库 `ywandy/dsh-plugins`，用于集中维护和发布多个 DeepSeek Harness 社区插件。首个发布包为 `@ywandy/dsh-desktop-temporary-workspace@0.1.0`，源码来自当前 `dsh-desktop` 仓库中的临时工作区插件。

仓库通过 GitHub Topic `dsh-plugin` 进入社区发现入口，并同时使用 `deepseek-harness` 与 `dsh` Topic。首版发布包含 GitHub Release 和公开 npm 包。

## 范围

首版包含：

- 一个支持后续扩展的 pnpm monorepo；
- 临时工作区 Host/Client 插件包；
- 中英文仓库和包级说明；
- MIT 许可证；
- 核心测试、打包检查和 GitHub Actions CI；
- GitHub 公开仓库、Topics、`v0.1.0` Release；
- npm 公共包 `@ywandy/dsh-desktop-temporary-workspace@0.1.0`。

首版不包含：

- 只有一个成员的聚合 Bundle；
- 自动 npm 发布工作流或 npm Token Secret；
- 对原版 DeepSeek Harness 的 UI 扩展补丁；
- 将现有 `dsh-desktop` 立即迁移到已发布 npm 包；
- 修改 `dsh-desktop` 中用户已有的 `package-lock.json` 或 `pnpm-lock.yaml`。

## 仓库结构

```text
dsh-plugins/
├── .github/workflows/ci.yml
├── docs/superpowers/specs/
├── packages/
│   └── desktop-temporary-workspace/
│       ├── client.js
│       ├── index.js
│       ├── LICENSE
│       ├── package.json
│       ├── README.md
│       ├── README.zh.md
│       └── test/
├── LICENSE
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── README.md
└── README.zh.md
```

根包保持 `private: true`，只负责工作区脚本和开发依赖。每个 `packages/*` 子目录是独立 npm 包，拥有自己的版本、入口、README 和发布文件白名单。

## 包设计

首个包名为 `@ywandy/dsh-desktop-temporary-workspace`，版本为 `0.1.0`。内部 Cordis/Client ID 继续使用 `dsh-desktop-temporary-workspace`，避免改变现有配置标识与设置命名空间。

包继续提供：

- `.`：Host 插件入口；
- `./client`：Web Client 插件入口；
- `./package.json`：供 DSH Loader 读取元数据；
- `dsh.client`：Client 注入依赖和 Web 平台声明。

包通过 `files` 仅发布运行时入口、说明和许可证。运行时直接导入的 DSH/Cordis/React 服务继续声明为 peer dependencies；插件自身使用的 Schemastery 保持普通 dependency。

## 兼容性

当前插件依赖 `dsh-desktop` 中新增的两项 Client 能力：

1. 工作区创建来源扩展槽；
2. 首次发送时创建独立 Session 的延迟协调流程。

这两项能力不属于原版 `@deepseek-ai/dsh@0.1.0-rc.7`，因此首版必须明确标注为 **DSH Desktop 专用插件**，不得宣称兼容原版 Harness。README 同时说明兼容前提、已验证的 DSH 版本和失败表现。

将来原版 Harness 提供等价扩展点后，再放宽 peer dependency 和兼容说明。分组到 monorepo 或 Bundle 不改变这一兼容边界。

## 安装与组合

兼容环境中使用：

```sh
dsh plugin --profile web add @ywandy/dsh-desktop-temporary-workspace
```

安装只会把 npm 包加入 Profile 依赖；`dsh plugin` 本质上把参数转发给 pnpm，不会自动挂载普通插件。因此 README 还必须要求用户在目标 Profile 的 `cordis.patch.yml` 中加入：

```yaml
- insert:
    - id: dsh-desktop-temporary-workspace
      name: '@ywandy/dsh-desktop-temporary-workspace'
```

随后通过 `dsh --profile web --dump-config` 检查组合结果，再启动 Harness。

当仓库至少拥有两个可组合插件时，再新增 `@ywandy/dsh-workspace-suite` Bundle。Bundle 负责依赖多个插件并通过 `dsh.bundle` 指向组合补丁；首版不提前创建空泛抽象。

## 测试与 CI

测试聚焦插件能够独立保证的行为：

- 默认配置、绝对路径校验和路径规范化；
- 本地日期时间目录命名、冲突后缀和并发创建；
- Host 创建接口的方法、来源与同源限制；
- Client 创建请求、延迟来源声明和设置卡注册；
- npm manifest、exports、`dsh.client` 与发布文件集合；
- `npm pack --dry-run` 或等价 pack 检查。

依赖 `dsh-desktop` 补丁的集成测试继续留在 `dsh-desktop` 仓库，因为它们验证的是宿主扩展槽和延迟 Session 协调器，不属于插件包可以独立保证的行为。

GitHub Actions 在 Node.js 22.19 和 24 上使用固定 pnpm 版本安装依赖并运行测试与 pack 检查。首版不配置自动发布，避免在仓库中引入 npm 发布 Secret。

## 发布流程

1. 在本地完成测试与 pack 检查。
2. 将实现历史整理为一个计划提交。
3. 通过 GitHub CLI 在 `ywandy` 下创建公开仓库并推送 `main`。
4. 添加 `dsh-plugin`、`deepseek-harness`、`dsh` Topics。
5. 确认操作者已登录 npm，且账号拥有 `@ywandy` scope 的公开发布权限。
6. 从插件包目录执行 `npm publish --access public`。
7. 使用 `npm view @ywandy/dsh-desktop-temporary-workspace@0.1.0` 验证 registry 元数据。
8. 创建并推送 `v0.1.0` 标签，发布对应 GitHub Release。

如果 npm 登录或 scope 权限不足，GitHub 仓库仍可先创建，但 npm 发布和 Release 不应假装完成；需要在权限恢复后继续。

## 错误处理与回滚

- GitHub 仓库名已存在：停止创建并检查现有仓库，不覆盖远端内容。
- npm 包名已存在且不属于当前账号：停止发布，重新确认 scope 或包名。
- npm 发布失败：不重复修改版本；先判断包是否已实际写入 registry，再决定重试或提升版本。
- GitHub 推送或 Topic 设置失败：保留本地仓库和提交，可重试，不删除用户仓库。
- 发布后发现包内容错误：npm 版本不可覆盖，发布修正版 `0.1.1`；只有在 npm 允许且确有必要时才考虑撤回。

## 验收标准

- `ywandy/dsh-plugins` 是公开仓库，默认分支为 `main`；
- 仓库包含三个约定 Topics；
- CI 对首个提交通过；
- npm registry 可读取 `@ywandy/dsh-desktop-temporary-workspace@0.1.0`；
- npm tarball 只包含预期运行时文件、README、LICENSE 和 manifest；
- README 不误导用户认为插件兼容原版 Harness；
- 当前 `dsh-desktop` 工作区的用户 lockfile 修改保持不变。
