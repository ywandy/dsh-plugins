# jizhi-bridge 交付工具设计

## 目标

在 `@ywandy/dsh-jizhi-bridge` 中注册一个模型可调用的 `collect_artifacts` 工具。工具只把 `artifacts/` 目录中的最终交付文件登记到极智约定的清单文件，交付文件的读取、上传和用户侧渲染继续由极智后端在回答结束时完成。

## 约束与请求 ID

- 清单路径固定为 `<cwd>/.jizhiagent/logs/artifacts_msg_<req_msgid>.json`。
- 清单 JSON 使用 `{ "req_msgid": <正整数>, "files": [{ "path": "..." }] }` 结构。
- 当前 DSH 用户消息 ID 是 UUID，不能直接当作极智 `req_msgid`。插件只接受当前真实用户消息 `source.rpcId` 中的正整数（上游负责把极智数据库请求 ID 透传到该字段）；缺少或非法时返回工具错误并不写入清单。
- 插件不创建 `.jizhiagent`。清单写入前必须确认它是既有目录；`logs` 子目录可在确认父目录后创建。

## 架构

新增 `lib/artifact-delivery.js`，封装请求 ID 解析、相对路径校验、清单去重及原子写入，并导出 `createArtifactDeliveryTool`。`index.js` 注入 DSH `tools` 服务，使用 `WeakMap<Agent, number>` 保存最近一次真实用户消息的请求 ID，在 `agent/inbox/claimed` 中同步更新，并在插件 effect 生命周期内注册和卸载工具。

工具参数为 `files: [{ path: string }]`。路径必须位于当前工作区的 `artifacts` 目录下，规范化后不能是目录、不能包含 `..` 穿越，且目标必须是常规文件。空数组表示显式登记本轮无交付文件。成功结果返回状态、规范化后的去重路径和平台自动交付提示；失败只影响工具调用，不影响 Agent 主会话。

写入使用同目录临时文件、一次性 JSON 序列化、关闭后 `rename` 的流程，保证后端不会看到半份清单。工具不执行上传、不复制文件、不登记技能目录内容。

## 错误处理

- 无 Agent、无绝对 `cwd`、`.jizhiagent` 缺失/非目录、请求 ID 非正整数：返回可读工具错误，不创建元数据目录。
- 路径非法、目标不存在或是目录：整次调用失败，不覆盖旧清单。
- JSON 序列化、目录创建、临时文件或 rename 失败：清理可识别的临时文件并返回工具错误。
- 清单中重复路径按首次出现顺序去重；路径分隔符统一为 `/`。

## 验证

自动测试覆盖：工具 schema 与注册/卸载、请求 ID 解析、路径穿越与目录拒绝、空数组、去重、清单格式、原子写入、普通工作区不创建 `.jizhiagent` 以及写入失败不污染旧文件。运行 `corepack pnpm exec vitest run packages/jizhi-bridge/test`、`corepack pnpm test` 和 `corepack pnpm pack:check`。
