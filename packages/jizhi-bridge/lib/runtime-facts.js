import process from 'node:process'
import { normalizeWorkspaceCwd, protectPromptBraces } from './workspace-markdown.js'

export const RUNTIME_FACTS_CONTEXT_NAME = 'jizhi:runtime-facts'
export const RUNTIME_FACTS_CONTEXT_ORDER = 1000

const UNKNOWN = 'unknown'
const MARKDOWN_SKILL_LINK = /\[\$([A-Za-z0-9][A-Za-z0-9._:-]*)\]\([^)]+\)/g
const SKILL_ATTR_DOUBLE = /<skill\b[^>]*\bname\s*=\s*"([^"]+)"[^>]*>/gis
const SKILL_ATTR_SINGLE = /<skill\b[^>]*\bname\s*=\s*'([^']+)'[^>]*>/gis
const SKILL_BLOCK_NAME = /<skill\b[^>]*>.*?<name>\s*([^<]+?)\s*<\/name>.*?<\/skill>/gis
const VALID_SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/

function nonEmptyString(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value
    : undefined
}

function normalizeSkillName(value) {
  const name = nonEmptyString(value)?.replace(/^\$/, '')
  return name !== undefined && VALID_SKILL_NAME.test(name) ? name : undefined
}

function normalizeSkillList(value) {
  if (!Array.isArray(value)) return undefined
  const names = []
  const seen = new Set()
  for (const item of value) {
    const name = normalizeSkillName(item)
    if (name === undefined) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    names.push(name)
  }
  return names
}

function textFromMessage(message) {
  if (!Array.isArray(message?.content)) return ''
  return message.content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
}

export function extractRequestedSkillNames(message) {
  const text = textFromMessage(message)
  if (text.trim().length === 0) return []
  const matches = [
    MARKDOWN_SKILL_LINK,
    SKILL_ATTR_DOUBLE,
    SKILL_ATTR_SINGLE,
    SKILL_BLOCK_NAME
  ].flatMap((pattern) => [...text.matchAll(pattern)].map((match) => ({
    index: match.index ?? 0,
    name: normalizeSkillName(match[1])
  }))).filter((match) => match.name !== undefined)
  matches.sort((left, right) => left.index - right.index)

  const names = []
  const seen = new Set()
  for (const { name } of matches) {
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    names.push(name)
  }
  return names
}

function factsOverride(message) {
  return record(message?.runtimeFacts) ?? record(message?.source?.runtimeFacts) ?? {}
}

function deriveChatId(agent) {
  const sessionId = nonEmptyString(agent?.session?.header?.id) ?? nonEmptyString(agent?.id)
  if (sessionId === undefined) return UNKNOWN
  const match = /^(?:jizhi-chat|sess-chatid|sess-chat)-([1-9]\d*)$/.exec(sessionId)
  return match?.[1] ?? sessionId
}

function deriveSenderStaffId(cwd) {
  if (cwd === undefined) return UNKNOWN
  const match = /^\/agent\/user\/[^/]+\/([^/]+)\/workspace(?:\/|$)/.exec(cwd.replaceAll('\\', '/'))
  return nonEmptyString(match?.[1]) ?? UNKNOWN
}

function defaultRuntimeEnvironment() {
  return [
    '## Sandbox Environment',
    '### system',
    `OS: DSH Host (${process.platform}; ${process.arch})`,
    '### Environment:',
    `- Node.js ${process.version}(path: ${process.execPath})`
  ].join('\n')
}

function renderRequestedSkills(skills) {
  if (skills.length === 0) return '- []'
  return `chain: ${skills.join('->')}->\n${skills.map((name) => `- ${name}`).join('\n')}`
}

function renderRuntimeFacts(facts) {
  const safe = (value) => protectPromptBraces(value)
  return [
    '---',
    '<runtime_session_facts>',
    '## Current Workspace',
    `workspacePath: ${safe(facts.workspacePath)}`,
    '',
    safe(facts.runtimeEnvironment),
    '',
    '## Current Model',
    `你是在极智2.0 Agent平台运行的 ${safe(facts.currentModelName)} 模型`,
    '',
    '## Current Session',
    `Chat ID: ${safe(facts.chatId)}`,
    '',
    '## Load Skills',
    '### Requested Skills From Current Prompt',
    renderRequestedSkills(facts.requestedSkills.map(safe)),
    '',
    '## Current Sender',
    `${safe(facts.senderCname)}(${safe(facts.senderStaffID)})`,
    `昵称: ${safe(facts.nickName)}`,
    '',
    '</runtime_session_facts>'
  ].join('\n')
}

export function createRuntimeFactsSnapshot(agent, message, options = {}) {
  const override = factsOverride(message)
  const cwd = normalizeWorkspaceCwd(agent?.session?.header?.cwd)
  const requestedSkills = normalizeSkillList(override.requestedSkills)
    ?? extractRequestedSkillNames(message)
  const facts = Object.freeze({
    workspacePath: nonEmptyString(override.workspacePath) ?? cwd ?? UNKNOWN,
    runtimeEnvironment: nonEmptyString(override.runtimeEnvironment)
      ?? nonEmptyString(options.runtimeEnvironment)
      ?? defaultRuntimeEnvironment(),
    currentModelName: nonEmptyString(override.currentModelName)
      ?? nonEmptyString(agent?.options?.model)
      ?? UNKNOWN,
    chatId: nonEmptyString(String(override.chatId ?? '')) ?? deriveChatId(agent),
    requestedSkills: Object.freeze(requestedSkills),
    senderCname: nonEmptyString(override.senderCname) ?? UNKNOWN,
    senderStaffID: nonEmptyString(override.senderStaffID) ?? deriveSenderStaffId(cwd),
    nickName: nonEmptyString(override.nickName) ?? UNKNOWN
  })
  return Object.freeze({ facts, text: renderRuntimeFacts(facts) })
}
