# DSH 插件集

[English](README.md)

这是一个面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的社区插件 monorepo。每个插件都作为独立 npm 包维护和发布版本。

## 插件

| 包 | 功能 | 兼容范围 |
| --- | --- | --- |
| [`@ywandy/dsh-desktop-temporary-workspace`](packages/desktop-temporary-workspace/README.zh.md) | 仅在临时任务首次发送时创建按日期时间命名且永久保留的目录。 | 带工作区来源和延迟 Session 扩展的 DSH Desktop |

## 兼容性

DeepSeek Harness 当前处于开发者预览阶段，可能发生破坏性变更。每个包会单独声明经过验证的宿主和 peer dependency 要求。临时工作区插件目前依赖 DSH Desktop 扩展，原版 Harness 尚未提供这些能力。

## 开发

需要 Node.js 22.19 或更高版本，并通过 Corepack 使用 pnpm 11.7.0。

```sh
corepack pnpm install
corepack pnpm check
```

`packages/` 下的每个目录都是独立 npm 包。只有出现至少两个需要统一组合的插件时，才新增 Bundle。

## 社区发现

本仓库加入 GitHub [`dsh-plugin`](https://github.com/topics/dsh-plugin) Topic。欢迎通过 GitHub Issues 提交兼容性反馈和改进建议。

## 许可证

[MIT](LICENSE)
