# @ywandy/dsh-desktop-temporary-workspace

[English](README.md)

这是一个 DSH Desktop 插件，让用户无需先选择或创建项目工作区即可开始临时任务。

选择“临时工作区”时只会进入可编辑状态，不会创建磁盘目录、Workspace 或 Session。用户首次发送任务时，插件才创建按本地日期时间命名且永久保留的目录，创建以该目录为 `cwd` 的独立未分组 Session，并提交原草稿。插件不会注册 Workspace，也不会自动删除目录。

## 兼容性

该包依赖对应 DSH Desktop 宿主提供的“工作区创建来源”和“延迟 Session”扩展。当前不兼容原版 `@deepseek-ai/dsh@0.1.0-rc.7`，因为该版本尚未暴露这些 Client 扩展点。

## 安装

将包安装到 Web Profile：

```sh
dsh plugin --profile web add @ywandy/dsh-desktop-temporary-workspace
```

`dsh plugin` 只安装依赖，不会自动挂载普通插件。还需要在 Profile 的 `cordis.patch.yml` 中加入：

```yaml
- insert:
    - id: dsh-desktop-temporary-workspace
      name: '@ywandy/dsh-desktop-temporary-workspace'
```

启动前检查最终组合：

```sh
dsh --profile web --dump-config
dsh web
```

## 行为

- 选择来源时没有文件系统或 Session 副作用。
- 首次发送时创建 `<根目录>/YYYYMMDD-HHmmss`。
- 时间戳冲突时依次使用 `-02`、`-03` 等后缀。
- 并发请求会得到不同目录。
- 后续阶段失败时，同一草稿会复用已创建的目录或 Session。
- 已创建的目录和 Session 永久保留。

## 配置

默认根目录是 `<DSH_HOME>/temporary-workspaces`；没有设置 `DSH_HOME` 时，使用当前用户主目录下的 `.dsh`。可在“设置 → 插件 → 插件配置 → 临时工作区”中修改。

配置值必须是宿主操作系统格式的绝对路径。保存设置不会创建或移动目录；下一次临时任务首次发送时才读取当时的配置。

## 安全边界

Host 接口只接受同源回环地址的 `POST` 请求。调用方不能传入目标目录：Host 始终读取经过校验的 settings namespace，并且只返回自己创建的目录。

## 许可证

[MIT](LICENSE)
