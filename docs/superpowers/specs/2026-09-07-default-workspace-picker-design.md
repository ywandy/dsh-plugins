# 默认工作区 Picker 设计

## 背景

`@ywandy/dsh-desktop-temporary-workspace` 当前通过 DSH Desktop 专用的 `*.createSource` 插槽提供“默认执行目录”。这使插件依赖桌面仓库的额外补丁，安装到标准 DSH Host 后无法稳定出现在 Workspace 下拉菜单中。

本次将插件改为兼容标准 `conversation.hero.workspace` Picker：用户安装插件后，可以在输入框上方的 Workspace 下拉中选择“默认执行目录”。默认目录有固定默认值，可在插件设置中修改；目录在第一次使用时自动创建。

## 范围

包含：

- 在标准 `conversation.hero.workspace` 单槽注册插件自有 Picker；
- 下拉顶部增加“默认执行目录”，并继续显示真实 Workspace 与“添加工作区…”；
- 选择默认项时确保配置目录存在，创建使用该目录的未分组 Session，并打开该 Session；
- 保留现有 Host 设置 namespace、绝对路径校验和 ensure 接口；
- 保留设置页，说明路径只影响后续 Session；
- 更新包版本、Client 注入依赖、自动化测试和中英文文档。

不包含：

- 修改 `dsh-desktop` 仓库；
- 修改 Session、Workspace 或 Slot 的 Host 数据模型；
- 把默认目录注册为持久 Workspace；
- 在侧栏 Workspace 浏览器中新增默认项；
- 自动搬迁、合并或删除旧目录内容。

## Client 架构

插件 Client 继续由 `dsh.bundle` 挂载，并通过 `ctx.slots.inject('conversation.hero.workspace', ...)` 注册一个低优先级 Picker。标准 Picker 仍保留在同一 Slot，插件卸载或自身渲染失败时由 Slot 机制回退到标准实现。

插件不声明标准 Picker 已声明的 `conversation.hero.workspace.directoryFlow` 子槽，避免重复声明冲突。添加真实 Workspace 时直接调用标准 `uiWorkspace.pickDirectory()`，拿到目录后调用 `workspaces.create({ path })`，再把返回的 Workspace ID 交给标准 Owner 的 `onPick`。

自定义 Picker 接收标准 Owner props：`open`、`anchorRef`、`selectedId`、`onPick` 和 `onClose`，并通过标准 root hook 读取 Workspace 列表。菜单使用 DSH UI primitives 的 `Menu`、`Modal` 与文件夹/加号图标，保持标准 UI 的菜单交互和错误反馈风格。

## 下拉行为

菜单内容按以下顺序生成：

1. 虚拟项“默认执行目录”；
2. Host 返回的真实 Workspace 列表；
3. 底部的“添加工作区…”入口。

真实 Workspace 选择直接调用 `onPick(workspaceId)`，由宿主继续处理 Workspace 切换和草稿状态。

选择默认项时关闭菜单并设置 busy 状态，执行以下顺序：

1. `POST /dsh-desktop/default-workspace/ensure`；
2. `sessions.create({ cwd: ensuredPath })`，不传 `workspaceId`；
3. `sessions.open(sessionId)`。

流程不调用 `onPick` 和 `workspaces.create`，因此 Session 保持未关联 Workspace，显示在“未分组”下。相同操作每次创建新的 Session，但所有 Session 使用相同配置目录。

流程期间菜单项禁用，重复点击只允许一个请求链。ensure 或 Session 创建/打开失败时保留错误信息，Session 创建成功后即使打开失败也不再重复创建；用户可关闭错误提示后再次操作。

“添加工作区…”先调用 `uiWorkspace.pickDirectory()`。取消选择直接关闭流程；成功后创建真实 Workspace 并交给 `onPick`；选择或创建失败显示错误并允许重试。

## Host 与设置

Host 继续使用现有设置：

- namespace：`desktop-temporary-workspace`；
- 字段：`rootDirectory`；
- 默认值：`<DSH_HOME>/default-workspace`；
- 配置值必须是当前操作系统格式的绝对路径；
- `POST /dsh-desktop/default-workspace/ensure` 从已校验设置读取目录，使用 `mkdir(..., { recursive: true })`，返回规范化绝对路径。

设置保存只持久化路径，不创建目录。设置变更只影响之后创建的默认 Session，不移动或清理已有文件。

## 兼容性与版本

插件从依赖 DSH Desktop create-source 插槽调整为依赖标准 Workspace Picker、Session、Workspace 和 UI primitives 服务。该行为和宿主依赖发生变化，包版本提升到 `0.4.0`。README 删除对桌面专用 create-source/deferred patch 的要求，并改为说明需要标准 Workspace Picker 能力的 DSH 版本。

## 测试与验收

自动测试覆盖：

- 默认目录、路径规范化、ensure 幂等与并发；
- ensure 请求的同源回环限制与错误响应；
- Client 在标准 Picker 单槽注册，且不再注册 create-source；
- 菜单包含默认项、真实 Workspace 和添加入口；
- 默认项按 ensure → `sessions.create({ cwd })` → `sessions.open` 执行；
- 默认流程不创建 Workspace，失败时不打开不存在的 Session；
- 真实 Workspace 选择和添加目录流程保留；
- manifest、Bundle、Client 依赖和 npm pack 文件集合正确。

人工 Smoke Test：

1. 在标准 DSH Web Profile 安装插件；
2. 打开输入框上方 Workspace 下拉，确认出现“默认执行目录”；
3. 选择默认项，确认目录自动创建并产生未分组 Session；
4. 再创建一个默认 Session，确认两者使用相同目录；
5. 在设置中修改路径，确认新 Session 使用新路径；
6. 验证真实 Workspace 选择和“添加工作区…”仍可用。
