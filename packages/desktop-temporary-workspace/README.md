# @ywandy/dsh-desktop-temporary-workspace

[中文](README.zh.md)

A DSH plugin that adds **Default workspace** to the standard Workspace picker above the composer. It lets you start an independent Agent Session without registering a persistent Workspace.

## Compatibility

The host must provide the standard `conversation.hero.workspace` Picker, Session and Workspace services, and UI primitives. The plugin is tested against the `@deepseek-ai/dsh` `0.1.0-rc.7` service contracts.

## Install

Install the package into the Web profile:

```sh
dsh plugin --profile web add @ywandy/dsh-desktop-temporary-workspace
```

The package declares a `dsh.bundle` manifest, so `dsh plugin add` installs and mounts the Host half automatically.

## Use

Open the Workspace picker above the composer and select **Default workspace**. DSH then:

1. ensures the configured directory exists;
2. creates a new Session with that directory as `cwd`;
3. opens the Session as an ungrouped task without creating a persistent Workspace.

Every default Session uses the same directory. Existing Workspace selection and the **Add workspace…** action remain available.

## Configuration

The default directory is `<DSH_HOME>/default-workspace`; when `DSH_HOME` is unset, the plugin uses the current user's `.dsh` directory. Change it under **Settings → Plugins → Plugin configuration → Default workspace**.

The configured value must be an absolute path in the host operating system's format. Saving only persists the path. The directory is created the first time **Default workspace** is selected. Changing the setting affects future Sessions and does not move or delete existing files.

All default Sessions share the directory and can read or modify the same files concurrently. The plugin does not serialize Agent file operations.

## Security boundary

The Host endpoint accepts only same-origin loopback `POST` requests. The request body cannot override the configured path. The Host validates the settings value, ensures the directory, and returns its normalized absolute path with `cache-control: no-store`.

## Local development

```sh
export DSH_HOME=/absolute/path/to/a-disposable-dsh-home
dsh plugin --profile web add link:/absolute/path/to/dsh-plugins/packages/desktop-temporary-workspace
dsh --profile web --dump-config
dsh web
```

Restart `dsh web` after Host or manifest changes. Refresh the page after Client changes; restart the profile if the linked Client bundle is not reloaded.

## License

[MIT](LICENSE)
