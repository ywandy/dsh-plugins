import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { normalizeWorkspaceCwd } from './workspace-markdown.js'

const MAX_CALL_ID_BYTES = 241

export function isValidCallId(callId) {
  return (
    typeof callId === 'string' &&
    callId.length > 0 &&
    callId.trim() === callId &&
    callId !== '.' &&
    callId !== '..' &&
    !/[\\/\0]/.test(callId) &&
    !(process.platform === 'win32' && /[<>:"|?*]/.test(callId)) &&
    Buffer.byteLength(callId, 'utf8') <= MAX_CALL_ID_BYTES
  )
}

function toolResultBlock(resultEvent) {
  return resultEvent.data.message.content.find((block) => block.type === 'tool-result')
}

function diagnostic(error) {
  return error instanceof Error ? error.message : String(error)
}

export async function convertResultParts(resultEvent, attachments, warn = () => {}) {
  const result = toolResultBlock(resultEvent)
  if (result === undefined) throw new Error('tool/result event has no tool-result block')
  const parts = []

  for (const block of result.content) {
    if (block.type === 'text') {
      parts.push({ type: 'text', text: block.text })
    } else if (block.type === 'reasoning') {
      parts.push({ type: 'text', text: block.text, extra: { dsh_type: 'reasoning' } })
    } else if (block.type === 'image') {
      try {
        const stored = await attachments.readImage(block.attachment)
        parts.push({
          type: 'image',
          image: {
            base64data: Buffer.from(stored.data).toString('base64'),
            mime_type: stored.ref.mediaType
          }
        })
      } catch (error) {
        warn(`jizhi bridge: cannot read image attachment: ${diagnostic(error)}`)
        parts.push({
          type: 'text',
          text: `[DSH image unavailable: ${diagnostic(error)}]`,
          extra: { dsh_type: 'image' }
        })
      }
    } else {
      parts.push({
        type: 'text',
        text: JSON.stringify(block),
        extra: { dsh_type: String(block.type) }
      })
    }
  }

  return {
    parts,
    isError: Boolean(result.isError || resultEvent.data.error)
  }
}

async function ensureToolsDirectory(systemDir, fsApi) {
  const info = await fsApi.stat(systemDir)
  if (!info.isDirectory()) return undefined
  const toolsDir = path.join(systemDir, 'tools')
  try {
    await fsApi.mkdir(toolsDir)
  } catch (error) {
    if (!error || error.code !== 'EEXIST') throw error
    if (!(await fsApi.stat(toolsDir)).isDirectory()) throw error
  }
  return toolsDir
}

const defaultFs = { mkdir, rename, rm, stat, writeFile }

export async function writeToolJsonl(
  session,
  call,
  resultEvent,
  attachments,
  options = {}
) {
  const {
    fsApi = defaultFs,
    randomId = randomUUID,
    warn = () => {}
  } = options
  const cwd = normalizeWorkspaceCwd(session.header?.cwd)
  if (cwd === undefined || !isValidCallId(call?.callId)) {
    warn('jizhi bridge: invalid cwd or callId; skipping tool JSONL')
    return false
  }
  const result = toolResultBlock(resultEvent)
  if (result?.toolCallId !== call.callId) {
    warn('jizhi bridge: tool call/result id mismatch')
    return false
  }

  const systemDir = path.join(cwd, '.jizhiagent')
  let temporaryPath
  try {
    const toolsDir = await ensureToolsDirectory(systemDir, fsApi)
    if (toolsDir === undefined) return false
    const converted = await convertResultParts(resultEvent, attachments, warn)
    const payload = `${JSON.stringify({
      type: 'tool_call',
      call_id: call.callId,
      tool_name: call.name,
      arguments: call.arguments
    })}\n${JSON.stringify({
      type: 'tool_result',
      call_id: call.callId,
      result_parts: converted.parts,
      is_error: converted.isError
    })}\n`
    temporaryPath = path.join(toolsDir, `.dsh-jizhi-${process.pid}-${randomId()}.tmp`)
    await fsApi.writeFile(temporaryPath, payload, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await fsApi.rename(temporaryPath, path.join(toolsDir, `call_id_${call.callId}.jsonl`))
    return true
  } catch (error) {
    if (!error || error.code !== 'ENOENT') {
      warn(`jizhi bridge: cannot write tool JSONL: ${diagnostic(error)}`)
    }
    return false
  } finally {
    if (temporaryPath !== undefined) await fsApi.rm(temporaryPath, { force: true }).catch(() => {})
  }
}

function findHistoricalCall(session, callId) {
  return session.events.findLast(
    (event) => event.type === 'tool/call' && event.data.callId === callId
  )?.data
}

export function createToolJsonlBridge({ attachments, warn = () => {}, write = writeToolJsonl }) {
  const calls = new WeakMap()
  const pending = new WeakMap()

  function callMap(session) {
    let map = calls.get(session)
    if (map === undefined) calls.set(session, (map = new Map()))
    return map
  }

  function pendingSet(session) {
    let set = pending.get(session)
    if (set === undefined) pending.set(session, (set = new Set()))
    return set
  }

  function observe(session, event) {
    if (event.type === 'tool/call') {
      callMap(session).set(event.data.callId, event.data)
      return
    }
    if (event.type !== 'tool/result') return
    const callId = toolResultBlock(event)?.toolCallId
    const map = callMap(session)
    const call = map.get(callId) ?? findHistoricalCall(session, callId)
    map.delete(callId)
    if (call === undefined) {
      warn(`jizhi bridge: missing tool/call for ${String(callId)}`)
      return
    }

    const set = pendingSet(session)
    let task
    task = Promise.resolve()
      .then(() => write(session, call, event, attachments, { warn }))
      .catch((error) => warn(`jizhi bridge: tool JSONL task failed: ${diagnostic(error)}`))
      .finally(() => set.delete(task))
    set.add(task)
  }

  async function flush(session) {
    const set = pending.get(session)
    if (set === undefined) return
    await Promise.allSettled([...set])
  }

  return { observe, flush }
}
