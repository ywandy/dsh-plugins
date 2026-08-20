# @ywandy/dsh-jizhi-bridge

[中文](README.zh.md)

Host-only bridge between DeepSeek Harness and an existing Jizhi Agent workspace.

## Install

```sh
dsh plugin --profile web add @ywandy/dsh-jizhi-bridge
```

The bundle patch mounts the Host plugin automatically. No Client bundle or settings UI is included.

## Behavior

- Activates only when the Session's absolute `cwd` already contains a `.jizhiagent/` directory.
- Reads `AGENTS.md`, `IDENTITY.md`, `USER.md`, `MEMORY.md`, and `SUMMARY.md` in that fixed order.
- Refreshes once for each claimed message whose source is `user`; later model requests in the same Agent loop reuse the same prompt text for stable prefix caching.
- Writes each model-visible top-level tool call to `.jizhiagent/tools/call_id_<callId>.jsonl` after its committed result arrives.
- Records successful and failed text, reasoning, image, and extension blocks without changing the DSH tool result when bridging fails.

The plugin never creates `.jizhiagent/`. Internal Code Mode dispatches that are absent from DSH model history do not get separate files.

## Compatibility

Verified with Node.js 22.19+, Cordis 4.0.1, and DeepSeek Harness 0.1.0-rc.7.

## License

[MIT](LICENSE)
