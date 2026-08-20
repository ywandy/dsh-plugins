import { refreshWorkspaceSnapshot } from './lib/workspace-markdown.js'
import { createToolJsonlBridge } from './lib/tool-jsonl.js'

export const name = 'dsh-jizhi-bridge'
export const inject = ['systemPrompt', 'attachments']

export function apply(ctx) {
  const snapshots = new WeakMap()
  const warn = (message) => ctx.logger.warn(message)
  const toolJsonl = createToolJsonlBridge({ attachments: ctx.attachments, warn })

  ctx.systemPrompt.variable('jizhi_open', () => '{{')
  ctx.systemPrompt.section({
    name: 'jizhi:workspace',
    order: 50,
    text: ({ agent }) => agent === undefined ? '' : snapshots.get(agent)?.text ?? ''
  })

  ctx.on('agent/inbox/claimed', ({ agent, message }) => {
    if (message.source.kind !== 'user') return
    const next = refreshWorkspaceSnapshot(
      agent.session.header.cwd,
      snapshots.get(agent),
      { warn }
    )
    if (next === undefined) snapshots.delete(agent)
    else snapshots.set(agent, next)
  })

  ctx.on('session/event', (session, event) => {
    toolJsonl.observe(session, event)
  })
  ctx.on('session/flush', (session) => toolJsonl.flush(session))
}
