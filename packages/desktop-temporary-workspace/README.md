# @ywandy/dsh-desktop-temporary-workspace

[中文](README.zh.md)

A DSH Desktop plugin for starting independent Agent tasks without choosing a project. It adds **Default workspace** to the new-task entry points above the composer and in the sidebar.

Selecting that option opens an editable composer immediately. The shared default directory is ensured only when the first message is submitted, and the new Session uses it as `cwd` without registering a persistent Workspace.

## Compatibility

Requires the DSH Desktop create-source and deferred-composer patches for `@deepseek-ai/dsh@0.1.0-rc.7`; these are included in the current DSH Desktop `main` branch. Older Desktop builds can install the package but do not expose its new-task entries.

## Install

Install the package into the Web profile:

```sh
dsh plugin --profile web add @ywandy/dsh-desktop-temporary-workspace
```

The package declares a `dsh.bundle` manifest, so `dsh plugin add` installs and mounts it automatically. No manual `cordis.patch.yml` edit is required.

Verify the composed tree and start the profile:

```sh
dsh --profile web --dump-config
dsh web
```

## Use

Select **Default workspace** above the composer or from the sidebar's new-task menu. Then type the prompt normally. On the first submit, DSH:

1. ensures the configured directory exists;
2. creates a new Session with that directory as `cwd`;
3. sends the message without creating or attaching a persistent Workspace.

Choosing **Default workspace** does not create a Session before the first message, so the composer is immediately editable and abandoned drafts leave no empty Session behind. Real Workspaces and the local-directory flow remain unchanged.

All default Sessions share `<DSH_HOME>/default-workspace` unless the setting is overridden. They can see and modify the same files concurrently; the plugin does not provide write isolation or serialize Agent access.

## Configuration

The default directory is `<DSH_HOME>/default-workspace`, where `DSH_HOME` falls back to the current user's `.dsh` directory. Change it under **Settings → Plugins → Plugin configuration → Default workspace**.

The configured value must be an absolute path for the host operating system. Saving only persists the path; the directory is created on the next first-message submit for **Default workspace**. A setting change affects future Sessions only and never moves or removes existing files.

## Upgrade to 0.2.0

Version `0.2.0` replaces the `0.1.x` directory lifecycle:

- a saved `rootDirectory` override now becomes the shared working directory itself;
- the plugin no longer creates date-named child directories;
- existing directories and files are not moved, merged, or deleted.

This is a breaking behavioral change for users upgrading from `0.1.x`.

## Upgrade to 0.3.0

Version `0.3.0` changes **Default workspace** from immediate Session creation to deferred first-message creation. It also exposes the same option in the sidebar's new-task menu. DSH Desktop builds that provide the create-source slots are required.

## Security boundary

The Host endpoint accepts only same-origin loopback `POST` requests. The request body cannot override the target path: the Host reads the validated settings namespace, ensures that directory, and returns its normalized absolute path with `cache-control: no-store`.

## Local development

Develop the plugin from this repository without modifying DSH Desktop:

```sh
export DSH_HOME=/absolute/path/to/a-disposable-dsh-home
dsh plugin --profile web add link:/absolute/path/to/dsh-plugins/packages/desktop-temporary-workspace
dsh --profile web --dump-config
dsh web
```

Restart `dsh web` after Host, manifest, or Bundle changes. Refresh the page after Client changes; restart the profile if the current HMR session does not observe the linked bundle.

## License

[MIT](LICENSE)
