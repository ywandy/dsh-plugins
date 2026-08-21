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
- Registers the standard DSH `skill` provider for mounted Jizhi skills. It reads system skills from `/agent/skills` and user skills from `/agent/user/<net>/<user>/user_skills`.
- Derives `<net>/<user>` from a Session cwd shaped like `/agent/user/<net>/<user>/workspace/...`; system skills win same-name conflicts.
- Skill summaries are catalog-cached by DSH, while full `SKILL.md` bodies load only when the model invokes `skill`. File watchers invalidate the catalog after mounted files change.

The plugin never creates `.jizhiagent/`. Internal Code Mode dispatches that are absent from DSH model history do not get separate files.

## Mounted skills

The DSH service container must mount the Jizhi skill roots at these exact paths:

```text
/agent/skills
/agent/user/<net>/<user>/user_skills
```

Each skill is one first-level directory containing `SKILL.md`. The provider preserves the Markdown frontmatter and exposes the directory as the skill resource base, so relative scripts and references remain container-local. A missing root or an invalid individual file is skipped with a warning and does not affect the DSH session.

## Compatibility

Verified with Node.js 22.19+, Cordis 4.0.1, and DeepSeek Harness 0.1.0-rc.7.

## License

[MIT](LICENSE)
