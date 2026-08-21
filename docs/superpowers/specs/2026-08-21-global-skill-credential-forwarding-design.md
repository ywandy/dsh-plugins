# DSH 全局 Skill 凭据转发临时方案

## 目标

在不修改 `deepseek-harness` 核心源码的前提下，让 `@ywandy/dsh-jizhi-bridge` 临时把 Harness 凭据 Provider 中的 `OPENAI_API_KEY` 和 `OPENAI_BASE_URL` 传给所有由 DSH 管理的子进程，使现有 Skill 脚本能够直接使用平台 OpenAI 代理。

## 当前约束

- DSH 的 `scrubbedParentEnv()` 会从父进程环境移除名称包含 `KEY`、`PASSWORD`、`SECRET`、`TOKEN` 的变量。
- `ctx.credentials.resolve()` 返回凭据值，但凭据不会自动物化为 `process.env`。
- `dsh-jizhi-bridge` 当前只注册 Workspace、Skill Provider 和工具 JSONL 桥接。
- `ctx.subprocess.spawn()` 是同步创建接口，因此凭据需要在 spawn 前被异步解析并缓存。
- 本方案暂时覆盖所有 DSH 子进程，而不是仅覆盖 Skill；因此普通 bash、终端和其他使用该服务的进程也会获得配置的变量。

## 方案

插件声明 `credentials` 和 `subprocess` 依赖。加载后按以下流程工作：

1. 使用 `credentialRef('OPENAI_API_KEY')` 和 `credentialRef('OPENAI_BASE_URL')` 解析当前值。
2. 把非空结果保存在插件私有内存快照中；缺失值不进入环境映射。
3. 监听 `credentials/updated`，在下一次 spawn 前刷新快照。
4. 包装 `ctx.subprocess.spawn()` 和 `ctx.subprocess.spawnTerminal()`，将快照作为显式 `env` 合并到原始 spec。显式凭据转发发生在 Harness 的 ambient scrub 之后，因此可恢复被 scrub 的变量。
5. 插件卸载时移除事件监听并恢复原始方法引用；未由本插件创建的进程仍由原 subprocess Service 管理。

显式环境的合并顺序为：Harness 原始 spec 的 `env` 先保留，本插件的已解析凭据后写入并覆盖同名值。这样插件控制的凭据不会被陈旧或调用方的同名值替换。

## 安全限制

- 凭据值只存在于插件内存和传给子进程的 spawn spec，不写入 Skill 文本、模型消息、工具参数、session event 或日志。
- 不修改 `process.env`，不改变全局 `SENSITIVE_ENV_PATTERN`。
- 凭据 Provider 尚未配置时不注入变量；Skill 脚本自行报告缺失配置。
- 该方案是临时兼容层，覆盖范围过大。后续应迁移到按 Tool/Skill 显式授权的 credential-env seam，并删除此 monkey patch。

## 测试

- Provider 返回两个凭据时，普通 spawn 和 terminal spawn 的最终 spec 均包含两个变量，且同名旧值被当前凭据覆盖。
- Provider 缺少其中一个凭据时，只转发另一个。
- `credentials/updated` 后下一次 spawn 使用新值。
- 插件销毁后，原始 spawn 方法被恢复，且更新事件不再改变快照。
- 转发值不会出现在工具调用参数或桥接 JSONL 事件中。

## 非目标

- 不改变 DSH 核心 subprocess 的凭据清理规则。
- 不限制到单个 Skill 或命令。
- 不把凭据加入 `DSH_*` 受管环境注册表。
