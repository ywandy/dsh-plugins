# DSH 插件集

[English](README.md)

这是一个面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的社区插件 monorepo。每个插件都作为独立 npm 包维护和发布版本。

## 插件

| 包 | 功能 | 兼容范围 |
| --- | --- | --- |
| [`@ywandy/dsh-desktop-temporary-workspace`](packages/desktop-temporary-workspace/README.zh.md) | 从现有 Workspace 选择器创建共用可配置默认执行目录的未分组 Session。 | 使用 `@deepseek-ai/dsh@0.1.0-rc.7` 的未修改 DSH Desktop `origin/main` |

## 安装

```sh
dsh plugin --profile web add @ywandy/dsh-desktop-temporary-workspace
```

包内的 `dsh.bundle` manifest 会自动挂载插件。宿主兼容范围和配置方式见包级 README。

## 兼容性

DeepSeek Harness 当前处于开发者预览阶段，可能发生破坏性变更。每个包会单独声明经过验证的宿主和 peer dependency 要求。默认执行目录插件已在使用 `@deepseek-ai/dsh@0.1.0-rc.7` 的未修改 DSH Desktop `origin/main` 组合上验证。

## 开发

需要 Node.js 22.19 或更高版本，并通过 Corepack 使用 pnpm 11.7.0。

```sh
corepack pnpm install
corepack pnpm check
```

`packages/` 下的每个目录都是独立 npm 包，并可声明自己的 `dsh.bundle` 安装清单。只有出现至少两个需要统一组合的插件时，才新增聚合 Suite Bundle。

## 社区发现

本仓库加入 GitHub [`dsh-plugin`](https://github.com/topics/dsh-plugin) Topic。欢迎通过 GitHub Issues 提交兼容性反馈和改进建议。

## 许可证

[MIT](LICENSE)
