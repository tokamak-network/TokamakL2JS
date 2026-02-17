#!/usr/bin/env node

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const args = process.argv.slice(2)
const getArg = (name, fallback) => {
  const idx = args.indexOf(name)
  if (idx === -1) return fallback
  const value = args[idx + 1]
  if (!value) throw new Error(`Missing value for ${name}`)
  return value
}

const BASE_REF = getArg('--base', 'HEAD~1')
const REPORT_PATH = getArg('--report', 'agents/skills/upgrade-public-api-guardrail/out/public-api-report.md')
const JSON_PATH = getArg('--json', 'agents/skills/upgrade-public-api-guardrail/out/public-api-report.json')

const run = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

const createCurrentLoader = () => ({
  read(filePath) {
    if (!existsSync(filePath)) return null
    return readFileSync(filePath, 'utf8')
  },
  exists(filePath) {
    return existsSync(filePath)
  },
})

const createGitLoader = (baseRef) => {
  const cache = new Map()
  const read = (filePath) => {
    if (cache.has(filePath)) return cache.get(filePath)
    try {
      const text = run(`git show ${JSON.stringify(`${baseRef}:${filePath}`)}`)
      cache.set(filePath, text)
      return text
    } catch {
      cache.set(filePath, null)
      return null
    }
  }

  return {
    read,
    exists(filePath) {
      return read(filePath) !== null
    },
  }
}

const hasModifier = (node, modifierKind) =>
  Boolean(node.modifiers?.some((m) => m.kind === modifierKind))

const isExportedNode = (node) => hasModifier(node, ts.SyntaxKind.ExportKeyword)

const normalizeWhitespace = (text) => text.replace(/\s+/g, ' ').trim()

const getText = (node, sourceFile) => normalizeWhitespace(node.getText(sourceFile))

const getTypeText = (typeNode, sourceFile) => (typeNode ? getText(typeNode, sourceFile) : 'any')

const getParameterSignature = (param, sourceFile) => {
  const rest = param.dotDotDotToken ? '...' : ''
  const name = getText(param.name, sourceFile)
  const optional = param.questionToken ? '?' : ''
  const type = getTypeText(param.type, sourceFile)
  return `${rest}${name}${optional}: ${type}`
}

const getSignature = (node, sourceFile) => {
  const params = node.parameters.map((p) => getParameterSignature(p, sourceFile)).join(', ')
  const returnType = getTypeText(node.type, sourceFile)
  return `(${params}) => ${returnType}`
}

const getMemberName = (nameNode) => {
  if (!nameNode) return null
  if (ts.isIdentifier(nameNode) || ts.isStringLiteral(nameNode) || ts.isNumericLiteral(nameNode)) {
    return String(nameNode.text)
  }
  return null
}

const sortedUnique = (items) => [...new Set(items)].sort()

const cloneDetail = (detail) => JSON.parse(JSON.stringify(detail))

const buildClassDetail = (classDecl, sourceFile) => {
  const constructors = []
  const methods = new Map()

  const addMethodSig = (name, signature) => {
    if (!methods.has(name)) methods.set(name, [])
    methods.get(name).push(signature)
  }

  for (const member of classDecl.members) {
    const isPrivateOrProtected =
      hasModifier(member, ts.SyntaxKind.PrivateKeyword) || hasModifier(member, ts.SyntaxKind.ProtectedKeyword)
    if (isPrivateOrProtected) continue

    if (ts.isConstructorDeclaration(member)) {
      const params = member.parameters.map((p) => getParameterSignature(p, sourceFile)).join(', ')
      constructors.push(`constructor(${params})`)
      continue
    }

    if (ts.isMethodDeclaration(member)) {
      const name = getMemberName(member.name)
      if (!name) continue
      const staticPrefix = hasModifier(member, ts.SyntaxKind.StaticKeyword) ? 'static ' : ''
      addMethodSig(name, `${staticPrefix}${name}${getSignature(member, sourceFile)}`)
      continue
    }

    if (ts.isGetAccessorDeclaration(member)) {
      const name = getMemberName(member.name)
      if (!name) continue
      const staticPrefix = hasModifier(member, ts.SyntaxKind.StaticKeyword) ? 'static ' : ''
      const returnType = getTypeText(member.type, sourceFile)
      addMethodSig(name, `${staticPrefix}get ${name}(): ${returnType}`)
      continue
    }

    if (ts.isSetAccessorDeclaration(member)) {
      const name = getMemberName(member.name)
      if (!name) continue
      const staticPrefix = hasModifier(member, ts.SyntaxKind.StaticKeyword) ? 'static ' : ''
      const params = member.parameters.map((p) => getParameterSignature(p, sourceFile)).join(', ')
      addMethodSig(name, `${staticPrefix}set ${name}(${params})`)
      continue
    }
  }

  const serializedMethods = {}
  for (const [name, sigs] of methods.entries()) {
    serializedMethods[name] = sortedUnique(sigs)
  }

  return {
    kind: 'class',
    constructors: sortedUnique(constructors),
    methods: Object.fromEntries(Object.entries(serializedMethods).sort(([a], [b]) => a.localeCompare(b))),
  }
}

const buildFunctionDetail = (fnDecl, sourceFile) => ({
  kind: 'function',
  signature: getSignature(fnDecl, sourceFile),
})

const buildUnknownDetail = (kind = 'other') => ({ kind })

const resolveModuleSpecifier = (fromFile, specifierText, loader) => {
  if (!specifierText.startsWith('.')) return null

  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifierText))
  const withoutExt = base.replace(/\.(js|ts|mjs|cjs)$/, '')
  const candidates = [`${withoutExt}.ts`, `${withoutExt}/index.ts`]

  for (const candidate of candidates) {
    if (loader.exists(candidate)) return candidate
  }

  return null
}

const analyzeModuleExports = (entryFile, loader) => {
  const cache = new Map()
  const resolving = new Set()

  const analyze = (filePath) => {
    if (cache.has(filePath)) return cache.get(filePath)
    if (resolving.has(filePath)) return new Map()

    const sourceText = loader.read(filePath)
    if (sourceText === null) {
      throw new Error(`Cannot read source file: ${filePath}`)
    }

    resolving.add(filePath)

    const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const localDecls = new Map()
    const exportMap = new Map()

    const setLocal = (name, detail) => {
      localDecls.set(name, detail)
    }

    const setExport = (name, detail) => {
      exportMap.set(name, detail)
    }

    for (const stmt of sourceFile.statements) {
      if (ts.isFunctionDeclaration(stmt) && stmt.name) {
        setLocal(stmt.name.text, buildFunctionDetail(stmt, sourceFile))
      } else if (ts.isClassDeclaration(stmt) && stmt.name) {
        setLocal(stmt.name.text, buildClassDetail(stmt, sourceFile))
      } else if (ts.isVariableStatement(stmt)) {
        for (const decl of stmt.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) {
            setLocal(decl.name.text, buildUnknownDetail('value'))
          }
        }
      } else if (ts.isTypeAliasDeclaration(stmt)) {
        setLocal(stmt.name.text, buildUnknownDetail('type'))
      } else if (ts.isInterfaceDeclaration(stmt)) {
        setLocal(stmt.name.text, buildUnknownDetail('interface'))
      } else if (ts.isEnumDeclaration(stmt)) {
        setLocal(stmt.name.text, buildUnknownDetail('enum'))
      }
    }

    for (const stmt of sourceFile.statements) {
      if (ts.isFunctionDeclaration(stmt) && stmt.name && isExportedNode(stmt)) {
        setExport(stmt.name.text, buildFunctionDetail(stmt, sourceFile))
        continue
      }

      if (ts.isClassDeclaration(stmt) && stmt.name && isExportedNode(stmt)) {
        setExport(stmt.name.text, buildClassDetail(stmt, sourceFile))
        continue
      }

      if (ts.isVariableStatement(stmt) && isExportedNode(stmt)) {
        for (const decl of stmt.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) {
            setExport(decl.name.text, buildUnknownDetail('value'))
          }
        }
        continue
      }

      if (ts.isTypeAliasDeclaration(stmt) && isExportedNode(stmt)) {
        setExport(stmt.name.text, buildUnknownDetail('type'))
        continue
      }

      if (ts.isInterfaceDeclaration(stmt) && isExportedNode(stmt)) {
        setExport(stmt.name.text, buildUnknownDetail('interface'))
        continue
      }

      if (ts.isEnumDeclaration(stmt) && isExportedNode(stmt)) {
        setExport(stmt.name.text, buildUnknownDetail('enum'))
        continue
      }

      if (!ts.isExportDeclaration(stmt) || !stmt.exportClause && !stmt.moduleSpecifier) {
        continue
      }

      const moduleSpecifierText = stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)
        ? stmt.moduleSpecifier.text
        : null

      if (moduleSpecifierText) {
        const resolved = resolveModuleSpecifier(filePath, moduleSpecifierText, loader)
        if (!resolved) continue
        const targetExports = analyze(resolved)

        if (!stmt.exportClause) {
          for (const [name, detail] of targetExports.entries()) {
            if (name === 'default') continue
            if (!exportMap.has(name)) setExport(name, cloneDetail(detail))
          }
          continue
        }

        if (ts.isNamedExports(stmt.exportClause)) {
          for (const el of stmt.exportClause.elements) {
            const sourceName = el.propertyName ? el.propertyName.text : el.name.text
            const exportName = el.name.text
            setExport(exportName, cloneDetail(targetExports.get(sourceName) ?? buildUnknownDetail('reexport')))
          }
        }
        continue
      }

      if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        for (const el of stmt.exportClause.elements) {
          const sourceName = el.propertyName ? el.propertyName.text : el.name.text
          const exportName = el.name.text
          setExport(exportName, cloneDetail(localDecls.get(sourceName) ?? buildUnknownDetail('local-reexport')))
        }
      }
    }

    cache.set(filePath, exportMap)
    resolving.delete(filePath)
    return exportMap
  }

  return analyze(entryFile)
}

const setDiff = (a, b) => [...a].filter((x) => !b.has(x)).sort()

const diffClassDetail = (symbol, prevDetail, currDetail) => {
  const breaking = []
  const additive = []

  const prevCtors = new Set(prevDetail.constructors || [])
  const currCtors = new Set(currDetail.constructors || [])

  for (const removedCtor of setDiff(prevCtors, currCtors)) {
    breaking.push(`Changed class constructor: ${symbol} missing ${removedCtor}`)
  }
  for (const addedCtor of setDiff(currCtors, prevCtors)) {
    additive.push(`Added class constructor overload: ${symbol} ${addedCtor}`)
  }

  const prevMethods = prevDetail.methods || {}
  const currMethods = currDetail.methods || {}
  const prevMethodNames = new Set(Object.keys(prevMethods))
  const currMethodNames = new Set(Object.keys(currMethods))

  for (const removedMethod of setDiff(prevMethodNames, currMethodNames)) {
    breaking.push(`Removed class method: ${symbol}.${removedMethod}`)
  }
  for (const addedMethod of setDiff(currMethodNames, prevMethodNames)) {
    additive.push(`Added class method: ${symbol}.${addedMethod}`)
  }

  for (const methodName of Object.keys(prevMethods)) {
    if (!currMethods[methodName]) continue

    const prevSigs = new Set(prevMethods[methodName])
    const currSigs = new Set(currMethods[methodName])

    for (const removedSig of setDiff(prevSigs, currSigs)) {
      breaking.push(`Changed class method signature: ${symbol}.${methodName} missing ${removedSig}`)
    }
    for (const addedSig of setDiff(currSigs, prevSigs)) {
      additive.push(`Added class method overload: ${symbol}.${methodName} ${addedSig}`)
    }
  }

  return { breaking, additive }
}

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

const previousConfigTypes = (() => {
  try {
    return run(`git show ${JSON.stringify(`${BASE_REF}:src/interface/configuration/types.ts`)}`)
  } catch {
    return null
  }
})()
if (previousConfigTypes === null) {
  throw new Error(`Cannot read src/interface/configuration/types.ts at base ref: ${BASE_REF}`)
}
const currentConfigTypes = readFileSync('src/interface/configuration/types.ts', 'utf8')

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
    if (!currFields.has(fieldName)) removedRequiredFields.push(`${typeName}.${fieldName}`)
  }
}

const previousApi = analyzeModuleExports('src/index.ts', createGitLoader(BASE_REF))
const currentApi = analyzeModuleExports('src/index.ts', createCurrentLoader())

const previousNames = new Set(previousApi.keys())
const currentNames = new Set(currentApi.keys())

const removedSymbols = setDiff(previousNames, currentNames)
const addedSymbols = setDiff(currentNames, previousNames)

const breaking = []
const additive = []

for (const symbol of removedSymbols) {
  breaking.push(`Removed export: ${symbol}`)
}
for (const symbol of addedSymbols) {
  additive.push(`Added export: ${symbol}`)
}

for (const symbol of [...previousNames].sort()) {
  if (!currentApi.has(symbol)) continue

  const prevDetail = previousApi.get(symbol)
  const currDetail = currentApi.get(symbol)

  if (prevDetail.kind !== currDetail.kind) {
    breaking.push(`Changed export kind: ${symbol} (${prevDetail.kind} -> ${currDetail.kind})`)
    continue
  }

  if (prevDetail.kind === 'function' && prevDetail.signature !== currDetail.signature) {
    breaking.push(`Changed function signature: ${symbol} (${prevDetail.signature} -> ${currDetail.signature})`)
    continue
  }

  if (prevDetail.kind === 'class') {
    const classDelta = diffClassDetail(symbol, prevDetail, currDetail)
    breaking.push(...classDelta.breaking)
    additive.push(...classDelta.additive)
  }
}

breaking.push(...removedTypes.map((v) => `Removed exported config type: ${v}`))
breaking.push(...requiredFieldAdditions.map((v) => `Added required config field: ${v}`))
breaking.push(...optionalToRequired.map((v) => `Optional -> required config field: ${v}`))
breaking.push(...removedRequiredFields.map((v) => `Removed required config field: ${v}`))
additive.push(...addedTypes.map((v) => `Added exported config type: ${v}`))

const changedFiles = run(`git diff --name-only ${JSON.stringify(BASE_REF)} -- .`)
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)

const publicCandidates = changedFiles.filter((file) =>
  /^(src\/index\.ts|src\/(tx|stateManager|crypto|block|utils|interface)\/|package\.json)/.test(file),
)

const reportJson = {
  baseRef: BASE_REF,
  headRef: run('git rev-parse --short HEAD'),
  breaking: breaking.length,
  additive: additive.length,
  internal: 0,
  details: {
    changedFiles,
    publicCandidates,
    symbols: {
      previousExportCount: previousNames.size,
      currentExportCount: currentNames.size,
      removedSymbols,
      addedSymbols,
    },
    configTypes: {
      removedTypes,
      addedTypes,
      requiredFieldAdditions,
      optionalToRequired,
      removedRequiredFields,
    },
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
  `- Exported Symbols (base -> head): **${previousNames.size} -> ${currentNames.size}**`,
  '',
  '## Changed Public Candidates',
  ...(publicCandidates.length ? publicCandidates.map((v) => `- ${v}`) : ['- none']),
  '',
  '## Breaking Deltas',
  ...(breaking.length ? breaking.map((v) => `- ${v}`) : ['- none']),
  '',
  '## Additive Deltas',
  ...(additive.length ? additive.map((v) => `- ${v}`) : ['- none']),
  '',
].join('\n')

mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
mkdirSync(path.dirname(JSON_PATH), { recursive: true })
writeFileSync(REPORT_PATH, markdown)
writeFileSync(JSON_PATH, `${JSON.stringify(reportJson, null, 2)}\n`)

console.log(markdown)

if (breaking.length > 0) {
  process.exitCode = 2
}
