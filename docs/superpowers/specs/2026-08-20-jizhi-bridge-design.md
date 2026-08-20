# DSH 极智兼容桥插件设计

## 背景与目标

`jizhi_ai` 的 Eino Agent 会在会话工作区中维护一组系统 Markdown，并把完整工具调用持久化到 `.jizhiagent/tools/`。DSH 目前可以直接把这些目录作为 Session `cwd` 使用，但不会自动加载 `.jizhiagent/` 中的上下文，也不会生成极智可消费的工具调用 JSONL。

本次在 `dsh-plugins` monorepo 新增统一桥接包 `@ywandy/dsh-jizhi-bridge`。第一版完成两项能力：

1. 自动识别极智工作区，并把指定 Markdown 作为稳定的 DSH system prompt 片段加载；
2. 把 DSH 模型可见的顶层工具调用写成极智兼容的双行 JSONL。

插件定位为后续所有 DSH ↔ 极智兼容能力的统一承载点。未来可在包内追加产物、会话元数据或其他极智协议模块，但不得把尚未确认的未来能力提前放入第一版。

## 范围

本次包含：

- 新建 Host-only DSH 插件包 `@ywandy/dsh-jizhi-bridge@0.1.0`；
- 依据 DSH Agent Session 的绝对 `cwd` 自动识别 `.jizhiagent/`；
- 按固定顺序加载 `AGENTS.md`、`IDENTITY.md`、`USER.md`、`MEMORY.md`、`SUMMARY.md`；
- 每条真实用户消息进入 Agent 时刷新一次 Markdown 快照；
- 同一用户消息触发的后续 Agent Loop step 复用完全相同的快照；
- 监听 DSH 持久化 Session 事件，关联原始 `tool/call` 与最终 `tool/result`；
- 写入 `.jizhiagent/tools/call_id_<callId>.jsonl`；
- 成功、失败、文本、reasoning 和图片结果的转换；
- 中英文 README、包契约测试、核心行为测试和 pack 校验。

本次不包含：

- 修改或提交 `jizhi_ai` 项目代码；
- 创建新的 Eino 适配器或改造极智读取链路；
- DSH Client UI、插件设置页面或手动开关；
- 自动创建、迁移或删除极智工作区；
- 导入极智历史消息为 DSH Session 历史；
- 记录 Code Mode 中不直接出现在模型历史里的内部子调用；
- npm 发布、GitHub Release 或外部仓库变更。

## 包与兼容性

新包使用以下稳定标识：

- npm 包：`@ywandy/dsh-jizhi-bridge`；
- Cordis ID：`dsh-jizhi-bridge`；
- monorepo 目录：`packages/jizhi-bridge`；
- 初始版本：`0.1.0`。

最低验证目标为当前仓库已使用的 DSH `0.1.0-rc.7` 系列。插件只依赖该版本公开的 Host 能力：

- `agent/inbox/claimed`；
- `systemPrompt.section()` 与 `systemPrompt.variable()`；
- `session/event` 和 `session/flush`；
- `Session.header.cwd` 与 `Session.events`；
- DSH attachment service 的 `readImage()`。

包只提供 Host 入口，不生成 `client.js`，也不声明 `dsh.client`。Bundle 通过 `cordis.patch.yml` 自动插入 Host 插件。运行时 peer dependencies 至少包含 `@deepseek-ai/cordis`、`@deepseek-ai/dsh-agent`、`@deepseek-ai/dsh-attachment`、`@deepseek-ai/dsh-session` 和 `@deepseek-ai/dsh-system-prompt`，版本与 monorepo 现有 DSH 基线一致。

## 工作区识别

插件只使用 `agent.session.header.cwd` 作为工作区事实源。`cwd` 缺失、不是绝对路径或 `<cwd>/.jizhiagent` 不存在时，该 Agent 被视为普通 DSH 工作区：

- system prompt 不增加任何极智内容；
- 不创建 `.jizhiagent`；
- 不写工具 JSONL；
- 不改变普通 DSH Agent 的事件或工具结果。

当 `.jizhiagent` 是可读取目录时，插件把它识别为极智系统目录。Markdown 和工具日志路径都从同一个经 `path.resolve()`、`path.normalize()` 规范化的 `cwd` 派生，调用方不能通过消息内容或工具参数覆盖目标目录。

## Markdown 快照

### 刷新边界

DSH `0.1.0-rc.7` 会先从 Inbox claim 消息，再 assemble system prompt，最后才进入 `agent/pre-step` waterfall。因此插件监听同步的 `agent/inbox/claimed` 事件；仅当被 Agent 实际领取的消息满足 `message.source.kind === "user"` 时，才刷新该 Agent 的极智 Markdown 快照。不能把刷新放在 `agent/pre-step`，否则该用户消息的第一次模型请求已经完成 prompt assemble，只能看到旧快照。

这一定义同时覆盖普通 follow-up 与用户 steering，但排除工具产生的附加上下文、插件注入消息和纯工具结果 step。五个 Markdown 的同步读取发生在 claim 通知中、prompt assemble 之前，因此本轮第一次模型请求一定看到新快照；文件 I/O 只按真实用户消息发生，不按 Agent Loop step 重复发生。

每次触发刷新都重新读取当前文件内容。快照用 `WeakMap<Agent, Snapshot>` 按 Agent 实例保存：

- 本轮后续模型请求只读内存，不再访问文件系统；
- 同一轮发生的工具调用不会改变 system prompt 前缀；
- 文件在本轮中途变化时，等下一条真实用户消息进入后才生效；
- Agent 释放后，WeakMap 不保留 Session 或路径引用。

### 文件顺序与渲染

文件固定按以下顺序处理：

1. `AGENTS.md`
2. `IDENTITY.md`
3. `USER.md`
4. `MEMORY.md`
5. `SUMMARY.md`

不存在或内容为空的文件不生成片段。非空文件使用固定、无时间戳、无绝对路径的标题包裹，并拼成一个 `jizhi:workspace` section。该 section 的 order 固定为 `50`，因此位于 DSH deployment persona（order `0`）之后、工具指导约定区间（order `100–199`）之前。

section provider 只读取 WeakMap 中已生成的字符串，不做文件 I/O。相同文件内容会产生逐字相同的 section 文本和顺序，避免插件自身破坏同一用户轮次内的 KV Cache 前缀。

### 双花括号保真

DSH system prompt renderer 会把任意 `{{name}}` 解释成变量，极智 Markdown 可能包含 Handlebars、Go template 或代码示例。插件注册固定变量 `jizhi_open`，值为字面量 `{{`；生成 section 前，把 Markdown 中每个字面量 `{{` 替换为 `{{jizhi_open}}`。

DSH renderer 不会再次扫描变量替换值，所以最终送给模型的文本会恢复为原始 `{{`，既不会触发未知变量错误，也不需要插入零宽字符或改写用户代码。该转换必须用测试证明渲染结果与输入逐字一致。

## Tool JSONL

### 事件与关联

插件监听 `session/event`，而不是只监听执行期 `tools/result`：

- `tool/call` 事件包含模型原样产生的 `arguments` JSON 字符串；
- `tool/result` 事件是 DSH 已提交到持久化历史的最终模型可见结果；
- 两者通过 `callId` 精确关联，输出与 DSH 可重放历史一致。

每个 live Session 维护待关联的 `callId → { toolName, arguments }` 映射。若插件未观察到对应 live `tool/call`，处理 `tool/result` 时允许从该 Session 当前不可变事件快照中反向查找最近的匹配调用；仍找不到则只记 warning，不猜测工具名或参数。

只为 DSH 模型可见的顶层 `tool/call` / `tool/result` 写文件。Code Mode 的内部 `tool/code-dispatch*` 子调用不拥有独立模型历史节点，不单独生成 JSONL；外层 `run_code` 调用会完整记录其模型可见结果。

### 文件格式

目标路径固定为：

```text
<cwd>/.jizhiagent/tools/call_id_<callId>.jsonl
```

文件恰好包含两行，末尾保留换行：

```json
{"type":"tool_call","call_id":"call_123","tool_name":"read_file","arguments":"{\"path\":\"README.md\"}"}
{"type":"tool_result","call_id":"call_123","result_parts":[{"type":"text","text":"..."}],"is_error":false}
```

`tool_call` 行兼容现有 Eino 字段。`tool_result` 行保留现有 `result_parts`，并增加 `is_error` 布尔值，供未来极智新适配器区分成功和失败；旧读取端忽略未知字段时仍能读取核心内容。

### 结果转换

`tool/result` 的单个 `tool-result` block 内部 content 按原顺序转换：

- DSH `text` → Eino `{ "type": "text", "text": value }`；
- DSH `reasoning` → Eino text part，并在 `extra.dsh_type` 标记 `reasoning`；
- DSH `image` → 通过 `attachments.readImage()` 读取已验证字节，生成 `{ "type": "image", "image": { "base64data": "...", "mime_type": "..." } }`；
- 未知的 merge-extensible block → JSON 字符串形式的 text part，并在 `extra.dsh_type` 保留原始 type。

失败工具仍写完整 `result_parts`，同时令 `is_error: true`。图片读取失败时记录 warning，并为该图片生成可诊断的 text fallback；不能因为单个附件失败而丢掉整次工具调用。

### 文件名与原子性

`callId` 必须非空、无首尾空白，不能是 `.` / `..`，且不能包含路径分隔符、NUL 或当前操作系统不允许的文件名字符。`call_id_` 前缀、原始 `callId` 与 `.jsonl` 后缀组成的最终 UTF-8 文件名总长不得超过 255 bytes；固定前后缀共 14 bytes，因此 `callId` 上限为 241 bytes。非法值只记 warning，不创建替代文件名，因为编码或改名会破坏极智按原始 `callId` 查找文件的契约。

写入流程为：

1. 重新确认既有 `.jizhiagent` 仍是目录；不存在时跳过，不能由日志模块重新创建系统目录；
2. 非递归创建其下的 `tools` 子目录；父目录在检查后被并发删除时让创建失败，不能由递归 mkdir 重建 `.jizhiagent`；
3. 在同一目录创建不包含 `callId` 的唯一临时文件；
4. 一次写入两行完整 JSONL 并关闭文件；
5. 原子 rename 到最终路径；
6. 写入失败时清理本次临时文件，不修改 Agent 的工具结果。

同一 Session 中不同工具调用可并行生成不同文件。插件跟踪尚未完成的写入 Promise，并在对应 `session/flush` 中等待它们全部 settle。桥接失败只记录 warning；它不能让 DSH 主会话 flush 或 Agent 对话失败。

## 模块边界

包内文件职责固定为：

```text
packages/jizhi-bridge/
├── index.js                       # Cordis 装配、事件订阅、跨模块生命周期
├── lib/workspace-markdown.js      # 工作区识别、用户消息级快照、提示词转义
├── lib/tool-jsonl.js              # call/result 关联、内容转换、原子 JSONL 写入
├── test/plugin.test.js            # Host 事件、快照与 JSONL 核心行为
├── test/package.test.js           # npm manifest、Bundle 和发布文件契约
├── package.json
├── cordis.patch.yml
├── README.md
├── README.zh.md
└── LICENSE
```

`workspace-markdown.js` 不知道 JSONL；`tool-jsonl.js` 不参与提示词组装。`index.js` 只把 DSH 事件和两个模块连接起来，不复制路径校验、内容转换或文件写入逻辑。

根仓库同步更新：

- `README.md` / `README.zh.md` 的插件列表和安装示例；
- `scripts/verify-pack.mjs` 的包检查集合；
- pnpm lockfile 中的新 workspace importer。

## 错误处理

- Markdown 文件不存在或为空：跳过；
- 单个 Markdown 首次读取失败：warning 后省略该文件；
- 单个 Markdown 后续读取出现非 `ENOENT` 错误：warning 后保留该文件上一版快照；
- Markdown 后续变为 `ENOENT`：下一条用户消息起从快照移除；
- `.jizhiagent` 被删除或不再是目录：下一条用户消息起清空该 Agent 快照并停用工具落盘；
- 工具结束前 `.jizhiagent` 被删除：日志模块跳过本次写入，不重新创建系统目录；
- `cwd` 非法、`callId` 非法、call/result 关联失败：warning 后跳过对应桥接动作；
- JSON 序列化、附件读取、临时文件或 rename 失败：warning，清理可识别的本次临时文件，保留 DSH 原始 Session 事件和 Agent 结果；
- 插件不吞掉 DSH 其他监听器异常，也不改变 `PreStepDecision`、Session event 或工具结果内容。

## 测试与验收

自动测试聚焦插件可稳定保证的行为：

- 普通 DSH 工作区没有 prompt 片段、目录创建或 JSONL；
- 极智工作区识别只依赖绝对 `cwd` 和现有 `.jizhiagent`；
- 五个 Markdown 的固定顺序、缺失/空文件处理和稳定包装；
- 只有 `agent/inbox/claimed` 中 `source.kind === "user"` 的消息触发刷新；
- 同一用户轮次后续 step 复用快照，下一条用户消息读取文件变更；
- 非 `ENOENT` 读取失败保留旧文件内容，文件删除会移除旧内容；
- `{{` 保护经过 DSH `renderPrompt()` 后与原始 Markdown 逐字一致；
- `tool/call` 原始参数与 `tool/result` 精确配对；
- 成功、失败、text、reasoning、image 和未知 block 的 `result_parts`；
- 并行调用生成独立文件，最终文件始终是完整双行 JSONL；
- 非法 `callId`、缺失 call 记录、附件失败和文件写入失败不阻断主流程；
- `session/flush` 等待当前 Session 的写入 settle；
- manifest、peer dependencies、Host-only `dsh.bundle`、Cordis patch 和 tarball 文件集合正确；
- 根 README 与 pack 检查包含新包。

验证命令至少包括：

```sh
corepack pnpm exec vitest run packages/jizhi-bridge/test
corepack pnpm test
corepack pnpm pack:check
```

人工 Smoke Test：

1. 用本地 `link:` 方式安装 `packages/jizhi-bridge`；
2. 在普通工作区发送消息，确认行为不变且未创建 `.jizhiagent`；
3. 选择包含 `.jizhiagent` 的极智工作区，发送一条消息并从请求日志确认五个 Markdown 按固定顺序出现；
4. 让同一轮执行至少一个工具，确认后续模型请求复用相同 system prompt；
5. 修改 `SUMMARY.md`，确认当前轮不变、下一条用户消息起生效；
6. 执行一个成功工具和一个失败工具，检查对应 JSONL 都是完整两行且参数为模型原文；
7. 重启/关闭前触发 Session flush，确认已开始的日志写入完成。

## 验收标准

- `packages/jizhi-bridge` 可作为 DSH Host 插件安装并由 Bundle 自动挂载；
- 普通 DSH 工作区完全不受影响；
- 极智 Markdown 每条真实用户消息刷新一次，同一 Agent Loop 内提示词稳定；
- 最终渲染保留 Markdown 原文，包括任意双花括号；
- 模型可见的顶层工具调用生成极智兼容双行 JSONL，成功和失败均记录；
- JSONL 使用原始工具参数，文本、reasoning 和图片结果可由未来极智适配器读取；
- 写盘失败不改变 DSH 对话结果，flush 会等待所有已调度写入；
- 插件核心测试、全仓测试、pack 检查和人工 Smoke Test 通过；
- `jizhi_ai` 仓库没有新增或修改文件。
