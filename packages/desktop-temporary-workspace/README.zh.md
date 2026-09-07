# @ywandy/dsh-desktop-temporary-workspace

[English](README.md)

这是一个 DSH 插件，在输入框上方的标准 Workspace 下拉中加入“默认执行目录”。用户无需注册持久工作区，就能启动独立的 Agent 会话。

## 兼容性

宿主需要提供标准的 `conversation.hero.workspace` Picker、Session、Workspace 服务和 UI primitives。本插件按 `@deepseek-ai/dsh` `0.1.0-rc.7` 服务契约测试。

## 安装

将包安装到 Web Profile：

```sh
dsh plugin --profile web add @ywandy/dsh-desktop-temporary-workspace
```

包内声明了 `dsh.bundle` manifest，`dsh plugin add` 会自动安装并挂载 Host 部分。

## 使用方式

打开输入框上方的 Workspace 下拉，选择“默认执行目录”。DSH 会依次：

1. 确保配置的目录存在；
2. 创建一个 `cwd` 为该目录的新 Session；
3. 打开这个未分组 Session，不创建持久 Workspace。

所有默认 Session 共用同一个目录。真实 Workspace 选择和“添加工作区…”入口继续可用。

## 配置

默认目录是 `<DSH_HOME>/default-workspace`；未设置 `DSH_HOME` 时使用当前用户的 `.dsh` 目录。可在“设置 → 插件 → 插件配置 → 默认执行目录”中修改。

配置值必须是宿主操作系统格式的绝对路径。保存时只持久化路径；第一次选择“默认执行目录”时才自动创建目录。修改设置只影响后续 Session，不会移动或删除已有文件。

所有默认 Session 共享该目录，可以同时读取和修改其中的文件；插件不会串行化 Agent 的文件操作。

## 安全边界

Host 接口只接受同源回环地址的 `POST` 请求。请求体不能覆盖配置路径。Host 会校验设置值、确保目录存在，并通过 `cache-control: no-store` 返回规范化后的绝对路径。

## 本地开发

```sh
export DSH_HOME=/absolute/path/to/a-disposable-dsh-home
dsh plugin --profile web add link:/absolute/path/to/dsh-plugins/packages/desktop-temporary-workspace
dsh --profile web --dump-config
dsh web
```

修改 Host 或 manifest 后重启 `dsh web`。修改 Client 后刷新页面；如果链接的 Client bundle 没有重新加载，再重启 Profile。

## 许可证

[MIT](LICENSE)
