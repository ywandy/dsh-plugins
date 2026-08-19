# @ywandy/dsh-desktop-temporary-workspace

[中文](README.zh.md)

A DSH Desktop plugin that lets a user begin a temporary task without selecting or creating a project workspace first.

Selecting **Temporary workspace** only prepares the composer. On the first task submission, the plugin creates a persistent directory named with the local timestamp, creates an independent ungrouped Session whose `cwd` is that directory, and submits the draft. It does not register a Workspace and never deletes created directories automatically.

## Compatibility

This package requires the workspace-create-source and deferred-session extensions shipped by the corresponding DSH Desktop host. It is not compatible with stock @deepseek-ai/dsh@0.1.0-rc.7 because that release does not expose those client extension points.

## Install

Install the package into the Web profile:

```sh
dsh plugin --profile web add @ywandy/dsh-desktop-temporary-workspace
```

`dsh plugin` installs dependencies but does not mount an ordinary plugin. Add this row to the profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: dsh-desktop-temporary-workspace
      name: '@ywandy/dsh-desktop-temporary-workspace'
```

Verify the composed tree before starting the profile:

```sh
dsh --profile web --dump-config
dsh web
```

## Behavior

- Selecting the source performs no filesystem or Session mutation.
- The first submission creates `<root>/YYYYMMDD-HHmmss`.
- Timestamp collisions use `-02`, `-03`, and later suffixes.
- Concurrent requests receive distinct directories.
- A failed later stage reuses the directory or Session already created for that draft.
- Created directories and Sessions are persistent.

## Configuration

The default root is `<DSH_HOME>/temporary-workspaces`, where `DSH_HOME` falls back to the current user's `.dsh` directory. Change it under **Settings → Plugins → Plugin configuration → Temporary workspace**.

The configured value must be an absolute path for the host operating system. Saving the setting does not create or move directories; the current value is read when the next temporary task is first submitted.

## Security boundary

The Host endpoint accepts only same-origin loopback `POST` requests. The caller cannot supply a target directory: the Host reads the validated settings namespace and returns only the directory it created.

## License

[MIT](LICENSE)
