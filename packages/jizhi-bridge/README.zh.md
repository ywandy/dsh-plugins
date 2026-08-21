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
- 注册 `collect_artifacts` 交付工具。参数为 `files: [{path}]`，`path` 必须是 `artifacts/` 下的相对常规文件；工具只写入 `.jizhiagent/logs/artifacts_msg_<req_msgid>.json`，由极智后端在回答结束时读取并上传。当前用户消息必须在 `source.rpcId` 携带正整数极智请求 ID；UUID 会被拒绝，不会猜测。
- 注册 DSH 标准 `skill` Provider，读取容器内 `/agent/skills` 的系统技能和 `/agent/user/<net>/<user>/user_skills` 的用户技能。
- 从形如 `/agent/user/<net>/<user>/workspace/...` 的 Session `cwd` 提取 `net/user`；同名技能以系统目录为准。
- 技能摘要由 DSH 按 cwd 缓存，只有模型调用 `skill` 时才加载完整 `SKILL.md`；挂载文件变化由 watcher 触发 catalog invalidate，不按每个 Agent Loop 强制扫描。
- 作为临时兼容层，插件会把 Host credential provider 中非空的 `OPENAI_API_KEY` 和 `OPENAI_BASE_URL` 通过显式环境变量转发给所有 DSH 子进程。这覆盖普通 spawn、terminal、bash、LSP 及其他子进程调用方，不修改 Harness 的 ambient-env scrub 规则。移除或禁用本插件即可停止转发；启用期间，使用该插件的任何子进程都可能读取这些变量。

插件永远不会创建 `.jizhiagent/`。未进入 DSH 模型历史的 Code Mode 内部 dispatch 不会生成独立文件。

`collect_artifacts` 不复制、不上传文件；传空 `files` 数组可显式登记本轮没有交付文件。

## 挂载 Skill 目录

DSH 服务容器必须把极智技能目录挂载到以下固定路径：

```text
/agent/skills
/agent/user/<net>/<user>/user_skills
```

每个技能是目录下的一层子目录，并包含 `SKILL.md`。Provider 保留 frontmatter，并把该目录作为资源基目录，因此脚本和参考文件都按容器内相对路径解析。根目录缺失或单个文件异常时只记录 warning 并跳过，不影响 DSH 会话。

## 兼容范围

已验证 Node.js 22.19+、Cordis 4.0.1 和 DeepSeek Harness 0.1.0-rc.7。

## 许可证

[MIT](LICENSE)
