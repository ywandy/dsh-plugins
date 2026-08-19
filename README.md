# DSH Plugins

[中文](README.zh.md)

Community plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), maintained as independently versioned packages in one pnpm workspace.

## Packages

| Package | Description | Compatibility |
| --- | --- | --- |
| [`@ywandy/dsh-desktop-temporary-workspace`](packages/desktop-temporary-workspace/README.md) | Creates persistent date-named directories only when a temporary task is first submitted. | DSH Desktop with the workspace-source and deferred-session extensions |

## Compatibility

DeepSeek Harness is in developer preview and may make breaking changes. Every package documents its own verified host and peer dependency requirements. The temporary workspace package currently depends on DSH Desktop extensions that are not present in the stock Harness release.

## Development

Requires Node.js 22.19 or newer and pnpm 11.7.0 through Corepack.

```sh
corepack pnpm install
corepack pnpm check
```

Each directory under `packages/` is an independent npm package. Add a bundle only when at least two plugins need a shared composition.

## Community

This repository is listed under the [`dsh-plugin`](https://github.com/topics/dsh-plugin) GitHub topic. Contributions and compatibility reports are welcome through GitHub Issues.

## License

[MIT](LICENSE)
