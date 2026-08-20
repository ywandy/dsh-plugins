# DSH Plugins

[中文](README.zh.md)

Community plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), maintained as independently versioned packages in one pnpm workspace.

## Packages

| Package | Description | Compatibility |
| --- | --- | --- |
| [`@ywandy/dsh-desktop-temporary-workspace`](packages/desktop-temporary-workspace/README.md) | Creates ungrouped sessions that share a configurable default working directory, selected from the existing Workspace picker. | Unmodified DSH Desktop `origin/main` with `@deepseek-ai/dsh@0.1.0-rc.7` |

## Install

```sh
dsh plugin --profile web add @ywandy/dsh-desktop-temporary-workspace
```

The package's `dsh.bundle` manifest mounts it automatically. See the package README for host compatibility and configuration details.

## Compatibility

DeepSeek Harness is in developer preview and may make breaking changes. Every package documents its own verified host and peer dependency requirements. The default-workspace plugin is verified against the unmodified DSH Desktop `origin/main` composition using `@deepseek-ai/dsh@0.1.0-rc.7`.

## Development

Requires Node.js 22.19 or newer and pnpm 11.7.0 through Corepack.

```sh
corepack pnpm install
corepack pnpm check
```

Each directory under `packages/` is an independent npm package and may declare its own `dsh.bundle` installation manifest. Add an aggregate suite bundle only when at least two plugins need a shared composition.

## Community

This repository is listed under the [`dsh-plugin`](https://github.com/topics/dsh-plugin) GitHub topic. Contributions and compatibility reports are welcome through GitHub Issues.

## License

[MIT](LICENSE)
