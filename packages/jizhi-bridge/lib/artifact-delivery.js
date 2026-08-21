import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { normalizeWorkspaceCwd } from './workspace-markdown.js'

export const COLLECT_ARTIFACTS_TOOL_NAME = 'collect_artifacts'

const DESCRIPTION = '登记 artifacts 目录下需要交付给用户的最终文件。path 必须是相对 artifacts 目录的路径；平台会在回答结束时自动附加文件。没有交付文件时传空 files 数组。禁止登记技能目录中的内部文件。'
const DELIVERED_NOTE = '已登记，平台会在回答结束时自动附加并向用户展示。最终回答请用自然语言简述交付内容，不要输出 workspace 路径、URL 或媒体引用标记。'
const EMPTY_NOTE = '已记录本轮无交付文件。'

const defaultFs = { mkdir, rename, rm, stat, writeFile }

function diagnostic(error) {
  return error instanceof Error ? error.message : String(error)
}

export function parseRequestMessageId(value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : undefined
  }
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return undefined
  const parsed = Number(value.trim())
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

function normalizeArtifactPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new Error('artifact path must be a non-empty trimmed string')
  }
  const raw = value.replaceAll('\\', '/')
  if (path.posix.isAbsolute(raw) || path.win32.isAbsolute(raw)) {
    throw new Error(`artifact path must be relative: ${value}`)
  }
  if (raw.split('/').some((part) => part === '..')) {
    throw new Error(`artifact path must not contain '..': ${value}`)
  }
  const normalized = path.posix.normalize(raw)
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`artifact path must stay under artifacts: ${value}`)
  }
  return normalized
}

async function ensureExistingDirectory(directory, fsApi, label) {
  const info = await fsApi.stat(directory)
  if (!info.isDirectory()) throw new Error(`${label} is not a directory: ${directory}`)
}

function toolOutputSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      status: { type: 'string', const: 'success' },
      delivered: { type: 'array', items: { type: 'string' } },
      note: { type: 'string' }
    }
  }
}

export function createArtifactDeliveryTool({
  requestIdForAgent,
  warn = () => {},
  fsApi = defaultFs,
  randomId = randomUUID
}) {
  if (typeof requestIdForAgent !== 'function') {
    throw new TypeError('requestIdForAgent must be a function')
  }

  return defineTool({
    name: COLLECT_ARTIFACTS_TOOL_NAME,
    description: DESCRIPTION,
    parameters: {
      files: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string', required: true }
          }
        }
      }
    },
    output: {
      schema: toolOutputSchema(),
      render: (_args, value) => [{ type: 'text', text: value.note }]
    },
    async execute(args, exec) {
      const cwd = normalizeWorkspaceCwd(exec?.agent?.session?.header?.cwd)
      if (cwd === undefined) throw new Error('collect_artifacts requires an absolute workspace cwd')
      const requestMessageId = parseRequestMessageId(requestIdForAgent(exec.agent))
      if (requestMessageId === undefined) {
        throw new Error('collect_artifacts requires a positive integer request message id')
      }

      const systemDir = path.join(cwd, '.jizhiagent')
      const artifactsDir = path.join(cwd, 'artifacts')
      const logsDir = path.join(systemDir, 'logs')
      let temporaryPath
      try {
        await ensureExistingDirectory(systemDir, fsApi, '.jizhiagent')
        const delivered = []
        const seen = new Set()
        for (const item of args.files) {
          const relative = normalizeArtifactPath(item.path)
          if (seen.has(relative)) continue
          const target = path.join(artifactsDir, ...relative.split('/'))
          const info = await fsApi.stat(target)
          if (!info.isFile()) throw new Error(`artifact path is not a regular file: ${relative}`)
          seen.add(relative)
          delivered.push(relative)
        }

        await fsApi.mkdir(logsDir, { recursive: true })
        const manifest = {
          req_msgid: requestMessageId,
          files: delivered.map((relative) => ({ path: relative }))
        }
        temporaryPath = path.join(logsDir, `.dsh-jizhi-artifacts-${process.pid}-${randomId()}.tmp`)
        const finalPath = path.join(logsDir, `artifacts_msg_${requestMessageId}.json`)
        await fsApi.writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, {
          encoding: 'utf8',
          flag: 'wx',
          mode: 0o600
        })
        await fsApi.rename(temporaryPath, finalPath)
        return {
          status: 'success',
          delivered,
          note: delivered.length === 0 ? EMPTY_NOTE : DELIVERED_NOTE
        }
      } catch (error) {
        warn(`jizhi bridge: cannot write artifact manifest: ${diagnostic(error)}`)
        throw error
      } finally {
        if (temporaryPath !== undefined) await fsApi.rm(temporaryPath, { force: true }).catch(() => {})
      }
    }
  })
}
