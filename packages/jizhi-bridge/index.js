import { refreshWorkspaceSnapshot } from './lib/workspace-markdown.js'
import { createJizhiSkillProvider } from './lib/skill-provider.js'
import { createToolJsonlBridge } from './lib/tool-jsonl.js'
import { createCredentialForwarder } from './lib/credential-forwarder.js'

export const name = 'dsh-jizhi-bridge'
export const inject = ['systemPrompt', 'attachments', 'skills', 'credentials', 'subprocess']

export async function apply(ctx) {
  const snapshots = new WeakMap()
  const warn = (message) => ctx.logger.warn(message)
  const toolJsonl = createToolJsonlBridge({ attachments: ctx.attachments, warn })
  const forwarder = createCredentialForwarder({
    credentials: ctx.credentials,
    subprocess: ctx.subprocess
  })

  await forwarder.refresh()
  forwarder.install()
  ctx.effect(() => {
    const removeCredentialListener = ctx.on('credentials/updated', () => {
      void forwarder.refresh()
    })
    return () => {
      removeCredentialListener()
      forwarder.dispose()
    }
  }, 'dsh-jizhi-bridge: credential forwarding')

  if (ctx.skills?.registerProvider) {
    ctx.skills.registerProvider((control) => createJizhiSkillProvider({
      invalidate: control.invalidate,
      signal: control.signal,
      warn
    }))
  } else {
    warn('jizhi bridge: DSH skill registry is unavailable; mounted skills disabled')
  }

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
