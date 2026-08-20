# @ywandy/dsh-jizhi-bridge

[English](README.md)

这是连接 DeepSeek Harness 与既有极智 Agent 工作区的纯 Host 插件。

## 安装

```sh
dsh plugin --profile web add @ywandy/dsh-jizhi-bridge
```

Bundle patch 会自动挂载 Host 插件；本包不包含 Client bundle 或设置页面。

## 行为

- 仅当 Session 的绝对 `cwd` 已存在 `.jizhiagent/` 目录时启用。
- 固定按 `AGENTS.md`、`IDENTITY.md`、`USER.md`、`MEMORY.md`、`SUMMARY.md` 顺序加载。
- 每条被 Agent 领取且来源为 `user` 的消息刷新一次；同一 Agent Loop 的后续模型请求复用完全相同的提示词，保持前缀缓存稳定。
- 在最终结果提交后，把模型可见的顶层工具调用写入 `.jizhiagent/tools/call_id_<callId>.jsonl`。
- 成功、失败、文本、reasoning、图片和扩展 block 都会记录；桥接失败不会改变 DSH 工具结果。

插件永远不会创建 `.jizhiagent/`。未进入 DSH 模型历史的 Code Mode 内部 dispatch 不会生成独立文件。

## 兼容范围

已验证 Node.js 22.19+、Cordis 4.0.1 和 DeepSeek Harness 0.1.0-rc.7。

## 许可证

[MIT](LICENSE)
