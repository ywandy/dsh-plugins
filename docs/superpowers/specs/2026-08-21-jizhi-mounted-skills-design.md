# DSH 极智挂载 Skill Provider 设计

## 目标

在现有 `@ywandy/dsh-jizhi-bridge` Host-only 插件中增加 DSH 原生 Skill Provider，让 DSH 服务容器直接读取极智挂载的多目录 `SKILL.md`，并交给标准 `skill` 工具按需加载。该增量不修改 Eino 或 `jizhi_ai` 源码。

## 固定路径与身份解析

容器内只使用以下路径：

- 系统技能根目录：`/agent/skills`；
- 用户技能根目录：`/agent/user/${net}/${user}/user_skills`。

DSH Session 的 `cwd` 由极智适配器按 `/agent/user/${net}/${user}/workspace/...` 创建。Provider 从绝对 `cwd` 的固定段提取 `net` 和 `user`，不读取宿主机路径、不猜测环境变量，也不让模型覆盖路径。无法匹配该布局时仍可列出系统技能，但跳过用户技能目录。

## Provider 与优先级

插件注册一个名为 `jizhi-mounted-skills` 的 Provider，并声明 `skills` 注入。Provider 对每个 lookup cwd 合并两个来源：系统源 rank `500`，用户源 rank `700`；同名按大小写不敏感的 kebab-case 名称去重，系统源优先。每个候选包含 `resourceBase.kind = directory`，路径只使用容器内技能目录。

目录扫描只查找一层子目录中的普通 `SKILL.md`。候选名称取 frontmatter `name`，缺失时回退到目录名；`description` 使用 frontmatter 值，缺失时用稳定的目录名描述以满足 DSH registry 非空约束。无效名称、符号链接、非目录根和单个坏文件只告警并跳过，不影响另一来源。

`list()` 只返回摘要和文件 locator；`get()` 重新校验文件并读取完整正文，去除 YAML frontmatter 后返回 DSH `SkillDefinition`。这样正文不会进入每次 Agent Loop 的 system prompt，模型仍通过标准 `skill` 工具按需获得完整内容。

## 缓存与失效

不在插件内按 Agent Loop 强制刷新。DSH registry 自带按 cwd 的 catalog cache；Provider 在首次访问根目录时安装非持久文件监听，系统根目录和已发现的技能子目录发生变更时调用该注册实例的 `invalidate()`。失效只清理 registry catalog，下一次 `list/get` 才重新扫描；监听器在 Provider dispose 或 abort 时关闭。监听不可用时 fail-soft，仍保留 registry 的正常缓存语义。

## 错误处理与安全

- 缺失目录、单个 `SKILL.md` 读取失败、非法 YAML、非法 skill 名称均记录 warning 后跳过；
- `options.signal` 取消时停止尚未开始的扫描并抛出取消错误；
- 只接受绝对固定路径和真实普通文件，避免符号链接把资源目录指向挂载外部；
- Provider 失败不能影响 DSH 主会话、工具结果、已有 Markdown section 或 Tool JSONL 写入；
- `resourceBase` 和 `path` 暴露的仅是容器内固定路径，绝不返回 Eino 宿主机路径。

## 验收

- Provider 能从系统和用户根目录读取 frontmatter 与正文；
- `cwd` 派生 `/agent/user/wan/gz0175/user_skills` 等路径正确，普通 cwd 不越界；
- 系统同名技能覆盖用户技能，候选顺序稳定；
- `get()` 懒加载正文且返回资源基目录；
- 文件监听触发一次 invalidate，dispose 后不再触发；
- 现有 Markdown、Tool JSONL、包契约和 pack 检查全部通过。
