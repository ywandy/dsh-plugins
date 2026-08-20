# @ywandy/dsh-desktop-temporary-workspace

[English](README.md)

这是一个用于启动非项目型 Agent 任务的 DSH Desktop 插件。它在输入框上方和侧栏的新任务入口中加入“默认执行目录”，用户无需先选择项目。

选择该项后会立即进入可编辑的输入状态。只有第一次发送消息时，插件才确保共享默认目录存在，并以该目录作为新 Session 的 `cwd`，不会注册持久 Workspace。

## 兼容性

需要 DSH Desktop 针对 `@deepseek-ai/dsh@0.1.0-rc.7` 提供 create-source 与延迟输入补丁；当前 DSH Desktop `main` 已包含这些补丁。旧版 Desktop 即使能安装本包，也不会显示新的任务入口。

## 安装

将包安装到 Web Profile：

```sh
dsh plugin --profile web add @ywandy/dsh-desktop-temporary-workspace
```

该包声明了 `dsh.bundle` manifest，`dsh plugin add` 会自动安装并挂载插件，无需手工修改 `cordis.patch.yml`。

检查最终组合并启动 Profile：

```sh
dsh --profile web --dump-config
dsh web
```

## 使用方式

在输入框上方或侧栏的新任务菜单中选择“默认执行目录”，然后直接输入提示词。第一次发送时，DSH 会：

1. 确保配置的目录存在；
2. 创建一个以该目录为 `cwd` 的新 Session；
3. 发送消息，不创建也不关联持久 Workspace。

选择“默认执行目录”后不会在第一次发送前创建 Session，因此输入框可立即编辑，放弃草稿也不会留下空 Session。真实 Workspace 和本地目录流程保持不变。

除非用户覆盖设置，所有默认 Session 都共享 `<DSH_HOME>/default-workspace`。这些 Session 可以同时看到并修改相同文件；插件不提供写入隔离，也不会串行化 Agent 的文件操作。

## 配置

默认目录是 `<DSH_HOME>/default-workspace`；没有设置 `DSH_HOME` 时，使用当前用户主目录下的 `.dsh`。可在“设置 → 插件 → 插件配置 → 默认执行目录”中修改。

配置值必须是宿主操作系统格式的绝对路径。保存时只持久化路径；下一次使用“默认执行目录”发送第一条消息时才创建目录。修改设置只影响后续 Session，不会移动或删除已有文件。

## 升级到 0.2.0

`0.2.0` 替换了 `0.1.x` 的目录生命周期：

- 已保存的 `rootDirectory` 覆盖值会直接成为共享工作目录；
- 插件不再创建按日期时间命名的子目录；
- 既有目录和文件不会被移动、合并或删除。

因此，从 `0.1.x` 升级属于行为层面的破坏性变化。

## 升级到 0.3.0

`0.3.0` 将“默认执行目录”从立即创建 Session 改为发送第一条消息时再创建，同时在侧栏新任务菜单中提供相同入口。需要 DSH Desktop 提供 create-source slots 的版本。

## 安全边界

Host 接口只接受同源回环地址的 `POST` 请求。请求体不能覆盖目标路径：Host 始终读取经过校验的 settings namespace，确保该目录存在，并以 `cache-control: no-store` 返回规范化后的绝对路径。

## 本地开发

可以直接从本仓库开发插件，无需修改 DSH Desktop：

```sh
export DSH_HOME=/absolute/path/to/a-disposable-dsh-home
dsh plugin --profile web add link:/absolute/path/to/dsh-plugins/packages/desktop-temporary-workspace
dsh --profile web --dump-config
dsh web
```

修改 Host、manifest 或 Bundle 后重启 `dsh web`。修改 Client 后先刷新页面；如果当前 HMR 没有观察到链接 Bundle，再重启 Profile。

## 许可证

[MIT](LICENSE)
