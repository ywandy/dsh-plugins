# 默认执行目录虚拟 Picker 设计

## 背景与目标

部分 Agent 任务并不属于某个项目，但 DSH Session 仍然需要一个确定的 `cwd`。本次直接演进已发布的 `@ywandy/dsh-desktop-temporary-workspace`：不再为每个任务创建日期命名目录，而是让所有这类独立 Session 共用一个固定默认目录。

插件必须兼容原始 `dsh-desktop` `origin/main`，不得要求 workspace-create-source、deferred-session 或其他 Desktop 源码补丁。所有 Host、Client、组合、测试与文档改动只进入 `dsh-plugins` 仓库。

用户通过输入框顶部现有的 Workspace 按钮选择“默认执行目录”。该选项是 Client Picker 中的虚拟项，不创建 Host Workspace；插件使用默认目录直接创建 Session，因此会话继续显示在侧栏“未分组”。

## 范围

本次包含：

- 将插件目录语义从“每次创建子目录”改为“确保并复用固定目录”；
- 通过 Slot 优先级影子替换 `conversation.hero.workspace` Picker；
- 在 Picker 中同时保留真实 Workspace、添加本地 Workspace 和虚拟默认目录；
- 使用固定目录创建并打开未分组 Session；
- 保留默认目录设置，并更新中英文文案与兼容性说明；
- 将 npm 包版本提升为 `0.2.0`；
- 更新 Bundle、单元测试和打包校验。

本次不包含：

- 修改或提交 `dsh-desktop` 代码、补丁、依赖或 lockfile；
- 自动迁移、移动、合并或删除既有日期目录；
- 自动发布 npm、创建 GitHub Release 或提交 Awesome 列表 PR；
- 让不同默认目录 Session 获得文件隔离；
- 修改 DSH 的 Session、Workspace 或 Slot 数据模型。

## 包与兼容性

包名继续使用 `@ywandy/dsh-desktop-temporary-workspace`，内部 Cordis ID、设置 namespace 和 Bundle 安装方式保持不变。由于版本 `0.1.x` 的核心目录生命周期被替换，版本提升到 `0.2.0`，README 明确标注破坏性变化。

最低验证目标为原始 `dsh-desktop` `origin/main` 所使用的 `@deepseek-ai/dsh@0.1.0-rc.7`。插件只使用该版本已经公开的能力：

- `conversation.hero.workspace` 单槽及其 priority shadow 语义；
- `ctx.sessions.create({ cwd })` 与 `ctx.sessions.open(id)`；
- `ctx.workspaces` 列表、目录选择与 Workspace 创建能力；
- `settings.plugin.item` 与 settings namespace；
- Web Client UI primitives。

插件不再依赖 DSH Desktop 分支中曾增加的 `*.createSource` 插槽和延迟 Session 协调器。

## Host 设计

### 固定目录

默认值改为：

```text
<DSH_HOME>/default-workspace
```

`rootDirectory` 配置字段和 `desktop-temporary-workspace` settings namespace 保持不变，以便读取用户已保存的绝对路径。升级时：

- 用户未保存覆盖值：采用新的默认路径；
- 用户保存过旧版根目录：把该路径直接作为共享默认目录，不在其下继续创建日期子目录；
- 插件不移动该路径下的历史内容。

配置仍要求非空绝对路径，并按当前操作系统规则规范化。

### Ensure 接口

Host 将创建接口改为幂等的“确保目录存在”接口：

```text
POST /dsh-desktop/default-workspace/ensure
```

处理流程：

1. 先验证 method、回环来源、转发头和同源 Origin；
2. 从 settings namespace 读取当前 `rootDirectory`；
3. 使用 `mkdir(path, { recursive: true })` 确保目录存在；
4. 返回规范化后的绝对路径。

请求体不能覆盖目标路径。重复和并发请求返回同一个目录；目标是普通文件、权限不足或其他文件系统错误时返回结构化 `500`。响应继续使用 `cache-control: no-store`。

## Client Picker 设计

### Shadow 机制

stock `@deepseek-ai/dsh-client-ui-workspace` 已在 `conversation.hero.workspace` 以默认 priority `0` 注册 Picker。Slot 系统允许同一 single slot 在不同 priority 注册多个候选，并渲染最低 priority。

插件以 priority `-10` 注册自己的 Picker，从而只影子替换输入框顶部 Workspace 按钮弹出的菜单：

- Conversation 按钮、Composer、Session Header 和 Sidebar 仍由 stock 插件拥有；
- stock Picker 保留在 priority `0`，插件候选卸载或渲染失败时可回退；
- 插件不替换 `sidebar.workspaces`，侧栏 Workspace/Session 浏览保持原样。

### 菜单内容

Picker 打开时按以下结构展示：

1. 固定虚拟项“默认执行目录”，使用区别于文件夹的图标；
2. 当前 Host 返回的真实 Workspace 列表；
3. footer 中保留“添加工作区…”。

真实 Workspace 选择继续调用 owner 的 `onPick(workspaceId)`，保持 stock 连接和草稿迁移语义。“添加工作区…”优先使用 DSH Desktop 已暴露的目录选择 bridge；bridge 不可用时回退到 `ctx.workspaces.pickDirectory()`，选中路径后调用 `ctx.workspaces.create({ path })` 并把新 Workspace ID 交给 `onPick`。

### 默认目录 Session

选择“默认执行目录”后：

1. 关闭或锁定菜单，防止重复提交；
2. 调用 Ensure 接口获得固定绝对路径；
3. 调用 `ctx.sessions.create({ cwd: path })`，不传 `workspaceId`；
4. 调用 `ctx.sessions.open(sessionId)`；
5. 恢复空闲状态。

不调用 `ctx.workspaces.create`，所以 Session 不属于任何 Workspace，出现在“未分组”。每次选择都会创建一个新的独立 Session，但这些 Session 的 `cwd` 相同，彼此能够看到对方对默认目录的文件修改。

## 配置界面

原 `settings.plugin.item` 配置卡继续存在，但文案改为：

- 标题：默认执行目录；
- 描述：无需选择项目即可创建独立任务，所有快速任务共享此目录；
- 字段：默认执行目录；
- 提示：修改只影响后续创建的 Session，不移动或清理已有文件。

保存设置只验证并持久化路径，不创建目录。下一次选择虚拟项时 Ensure 接口才创建目录。恢复默认值改回 `<DSH_HOME>/default-workspace`。

## 错误处理与并发

- Ensure 失败：不创建 Session，显示插件自有错误弹窗，允许关闭或重试；
- `sessions.create` 失败：保留目录，不注册 Workspace，显示同一错误弹窗；
- 本地目录选择取消：关闭目录选择流程，不显示错误；
- 本地 Workspace 创建失败：显示错误并允许重新选择；
- 创建默认 Session 期间虚拟项和其他菜单项禁用，快速重复点击只产生一个创建流程；
- `sessions.open` 使用已返回的 Session ID，同一流程不重复调用 `sessions.create`；
- Picker 渲染异常由 Slot 的 single-candidate abdication 机制回退到 stock Picker。

插件不承诺并发 Agent 对共享目录写入的业务一致性。多个 Session 可以同时读写相同文件；这是共享默认目录的明确语义，而不是需要插件串行化的异常。

## 开发环境

插件开发不需要修改或启动 `dsh-desktop` 源码。推荐使用独立 Harness home 和本地链接安装：

```sh
export DSH_HOME=/absolute/path/to/a-disposable-dsh-home
dsh plugin --profile web add link:/absolute/path/to/dsh-plugins/packages/desktop-temporary-workspace
dsh --profile web --dump-config
dsh web
```

Host、manifest 或 Bundle 改动后重启 `dsh web`；Client bundle 改动后按当前 DSH HMR 能力刷新，若未被观察到则重启 Profile。最终再用未修改的 DSH Desktop `origin/main` 安装包做一次人工验收。

## 测试与验收

自动测试聚焦插件自身可稳定保证的行为：

- 默认路径、旧配置复用、绝对路径校验和规范化；
- Ensure 的幂等、并发、同源限制和错误响应；
- Picker 使用 priority `-10` 注册到正确 single slot；
- 菜单同时包含虚拟项、真实 Workspace 和添加入口；
- 虚拟项只调用 `sessions.create({ cwd })` 与 `sessions.open`，不调用 Workspace 创建；
- 创建期间阻止重复选择，失败时不产生 Session；
- 真实 Workspace 和添加本地 Workspace 流程仍可用；
- manifest、`dsh.bundle`、Client inject、peer dependencies 与 tarball 文件集合正确；
- 中英文 README 不再宣称日期目录或依赖 Desktop 补丁。

人工 Smoke Test：

1. 在未修改的 DSH Desktop `origin/main` 环境安装插件；
2. 从输入框顶部 Workspace 按钮选择“默认执行目录”；
3. 验证创建的新 Session 位于“未分组”；
4. 重复创建两个 Session，验证两者 `cwd` 相同且文件互相可见；
5. 验证真实 Workspace 选择和添加本地 Workspace 未回归；
6. 修改默认目录后创建新 Session，验证只影响新 Session；
7. 卸载插件后验证 stock Workspace Picker 恢复。

## 验收标准

- `dsh-desktop` 仓库没有新增或修改文件；
- 插件可由 `dsh plugin --profile web add @ywandy/dsh-desktop-temporary-workspace` 安装并自动挂载；
- 原始 `origin/main` 无扩展补丁时，输入框顶部 Picker 展示“默认执行目录”；
- 选择虚拟项创建未分组 Session，所有此类 Session 共用同一绝对目录；
- 普通 Workspace 与本地目录选择仍可用；
- 自动测试、pack 检查和人工 Smoke Test 通过；
- npm 包版本为 `0.2.0`，文档明确说明从 `0.1.x` 升级后的破坏性语义变化。
