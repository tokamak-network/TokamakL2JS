#!/usr/bin/env node

import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const args = process.argv.slice(2)
const getArg = (name, fallback) => {
  const idx = args.indexOf(name)
  if (idx === -1) return fallback
  const value = args[idx + 1]
  if (!value) {
    throw new Error(`Missing value for ${name}`)
  }
  return value
}

const BASE_REF = getArg('--base', 'HEAD~1')
const REPORT_PATH = getArg(
  '--report',
  'agents/skills/l2-upgrade-public-api-guardrail/out/public-api-report.md',
)
const JSON_PATH = getArg(
  '--json',
  'agents/skills/l2-upgrade-public-api-guardrail/out/public-api-report.json',
)

const run = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

const safeShow = (refPath) => {
  try {
    return run(`git show ${JSON.stringify(refPath)}`)
  } catch {
    return null
  }
}

const normalizeLines = (src) =>
  src
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter(Boolean)

const extractIndexExports = (sourceText) =>
  normalizeLines(sourceText).filter((line) => line.startsWith('export '))

const extractTypeShapes = (sourceText) => {
  const blocks = sourceText.matchAll(/export type\s+([A-Za-z0-9_]+)\s*=\s*{([\s\S]*?)};/g)
  const result = new Map()

  for (const [, typeName, body] of blocks) {
    const fields = new Map()
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim()
      if (!line || line.startsWith('//')) continue
      const match = line.match(/^([A-Za-z0-9_]+)(\?)?\s*:/)
      if (!match) continue
      fields.set(match[1], { optional: match[2] === '?' })
    }
    result.set(typeName, fields)
  }
  return result
}

const setDiff = (a, b) => [...a].filter((item) => !b.has(item))

const previousIndex = safeShow(`${BASE_REF}:src/index.ts`)
if (previousIndex === null) {
  throw new Error(`Cannot read src/index.ts at base ref: ${BASE_REF}`)
}
const currentIndex = readFileSync('src/index.ts', 'utf8')

const previousConfigTypes = safeShow(`${BASE_REF}:src/interface/configuration/types.ts`)
if (previousConfigTypes === null) {
  throw new Error(`Cannot read src/interface/configuration/types.ts at base ref: ${BASE_REF}`)
}
const currentConfigTypes = readFileSync('src/interface/configuration/types.ts', 'utf8')

const previousExports = new Set(extractIndexExports(previousIndex))
const currentExports = new Set(extractIndexExports(currentIndex))
const removedExports = setDiff(previousExports, currentExports)
const addedExports = setDiff(currentExports, previousExports)

const prevTypeShapes = extractTypeShapes(previousConfigTypes)
const currTypeShapes = extractTypeShapes(currentConfigTypes)

const removedTypes = setDiff(new Set(prevTypeShapes.keys()), new Set(currTypeShapes.keys()))
const addedTypes = setDiff(new Set(currTypeShapes.keys()), new Set(prevTypeShapes.keys()))
const requiredFieldAdditions = []
const optionalToRequired = []
const removedRequiredFields = []

for (const [typeName, prevFields] of prevTypeShapes.entries()) {
  const currFields = currTypeShapes.get(typeName)
  if (!currFields) continue

  for (const [fieldName, currMeta] of currFields.entries()) {
    const prevMeta = prevFields.get(fieldName)
    if (!prevMeta) {
      if (!currMeta.optional) requiredFieldAdditions.push(`${typeName}.${fieldName}`)
      continue
    }
    if (prevMeta.optional && !currMeta.optional) {
      optionalToRequired.push(`${typeName}.${fieldName}`)
    }
  }

  for (const [fieldName, prevMeta] of prevFields.entries()) {
    if (prevMeta.optional) continue
    if (!currFields.has(fieldName)) {
      removedRequiredFields.push(`${typeName}.${fieldName}`)
    }
  }
}

const changedFiles = run(`git diff --name-only ${JSON.stringify(BASE_REF)} -- .`)
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)

const publicCandidates = changedFiles.filter((file) =>
  /^(src\/index\.ts|src\/(tx|stateManager|crypto|interface)\/|package\.json)/.test(file),
)

const breaking = [
  ...removedExports.map((v) => `Removed export: ${v}`),
  ...removedTypes.map((v) => `Removed exported config type: ${v}`),
  ...requiredFieldAdditions.map((v) => `Added required config field: ${v}`),
  ...optionalToRequired.map((v) => `Optional -> required config field: ${v}`),
  ...removedRequiredFields.map((v) => `Removed required config field: ${v}`),
]

const additive = [
  ...addedExports.map((v) => `Added export: ${v}`),
  ...addedTypes.map((v) => `Added exported config type: ${v}`),
]

const reportJson = {
  baseRef: BASE_REF,
  headRef: run('git rev-parse --short HEAD'),
  breaking: breaking.length,
  additive: additive.length,
  internal: 0,
  details: {
    changedFiles,
    publicCandidates,
    breaking,
    additive,
  },
}

const markdown = [
  '# Public API Guardrail Report',
  '',
  `- Base ref: \`${BASE_REF}\``,
  `- Head ref: \`${reportJson.headRef}\``,
  `- Breaking: **${reportJson.breaking}**`,
  `- Additive: **${reportJson.additive}**`,
  '',
  '## Changed Public Candidates',
  ...(publicCandidates.length > 0 ? publicCandidates.map((v) => `- ${v}`) : ['- none']),
  '',
  '## Breaking Deltas',
  ...(breaking.length > 0 ? breaking.map((v) => `- ${v}`) : ['- none']),
  '',
  '## Additive Deltas',
  ...(additive.length > 0 ? additive.map((v) => `- ${v}`) : ['- none']),
  '',
].join('\n')

mkdirSync(dirname(REPORT_PATH), { recursive: true })
mkdirSync(dirname(JSON_PATH), { recursive: true })
writeFileSync(REPORT_PATH, markdown)
writeFileSync(JSON_PATH, `${JSON.stringify(reportJson, null, 2)}\n`)

console.log(markdown)

if (breaking.length > 0) {
  process.exitCode = 2
}
