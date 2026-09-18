/**
 * Discover VSCode-style AI configuration under a working directory.
 *
 * Scans the working directory itself plus `scanSubdirectories` levels below it.
 * Every scanned directory is treated as a project root, and each root
 * contributes its own `.github/` — which is what makes a multi-repo folder such
 * as `D:\NEVSTOP-LAB` work: the folder itself and each repository directly
 * under it are all scanned.
 *
 * All IO is synchronous on purpose. `systemPrompt.context` renders through a
 * synchronous callback, so a synchronous reader keeps the plugin free of any
 * cache, invalidation state, or async plumbing.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, relative, resolve, sep } from 'node:path'
import { parseBoolean, parseFrontmatter } from './frontmatter.js'
import { parseApplyTo } from './glob.js'

const GITHUB_DIR = '.github'
const COPILOT_FILE = 'copilot-instructions.md'
const INSTRUCTION_SUFFIX = '.instructions.md'
const SKILL_FILE = 'SKILL.md'
const MAX_INSTRUCTION_DEPTH = 4
const DEFAULT_MAX_SOURCE_BYTES = 1024 * 1024
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Directory names never treated as a project root or walked into. */
const SKIPPED_DIRECTORY = (name) => name.startsWith('.') || name === 'node_modules'

/**
 * Scan for instructions and skills.
 *
 * @param options - discovery options.
 * @param options.cwd - the session working directory.
 * @param options.scanSubdirectories - how many levels below `cwd` to treat as roots.
 * @param options.instructionDirs - root-relative directories holding `*.instructions.md`.
 * @param options.skillDirs - root-relative directories holding `<name>/SKILL.md` bundles.
 * @param options.maxSourceBytes - skip a single source file larger than this.
 * @returns the discovered instructions, skills, roots and warnings.
 */
export function discover(options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd())
  const instructionDirs = options.instructionDirs ?? [`${GITHUB_DIR}/instructions`]
  const skillDirs = options.skillDirs ?? [`${GITHUB_DIR}/skills`]
  const maxSourceBytes = options.maxSourceBytes ?? DEFAULT_MAX_SOURCE_BYTES

  const warnings = []
  const instructions = []
  const skills = []
  const roots = collectRoots(cwd, options.scanSubdirectories ?? 1)

  for (const rootDir of roots) {
    // Grouped per root so the rendered order reads repository by repository,
    // with each repository's always-on rules before its scoped ones.
    const fromRoot = []

    const copilot = join(rootDir, GITHUB_DIR, COPILOT_FILE)
    const copilotText = readText(copilot, maxSourceBytes)
    // Copilot's repo-wide file is plain Markdown: a leading `---` there is a
    // horizontal rule, not frontmatter, so it is never parsed as such.
    if (copilotText !== null) {
      fromRoot.push(makeInstruction(cwd, rootDir, copilot, copilotText, null))
    }

    for (const instructionDir of instructionDirs) {
      const base = join(rootDir, ...splitRelative(instructionDir))
      // Sorted so the rendered order does not depend on the platform's readdir order.
      for (const file of walkInstructionFiles(base, MAX_INSTRUCTION_DEPTH).sort()) {
        const text = readText(file, maxSourceBytes)
        if (text === null) continue
        const { data, body } = parseFrontmatter(text)
        fromRoot.push(makeInstruction(cwd, rootDir, file, body, parseApplyTo(data.applyTo)))
      }
    }

    fromRoot.sort((left, right) => Number(left.applyTo !== null) - Number(right.applyTo !== null))
    instructions.push(...fromRoot)

    for (const skillDir of skillDirs) {
      const base = join(rootDir, ...splitRelative(skillDir))
      for (const bundle of listDirectories(base)) {
        const file = join(bundle, SKILL_FILE)
        const text = readText(file, maxSourceBytes)
        if (text === null) continue
        const skill = makeSkill(bundle, file, text, warnings)
        if (skill !== null) skills.push(skill)
      }
    }
  }

  skills.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))

  return { cwd, roots, instructions, skills, warnings }
}

/** The working directory plus `depth` levels of subdirectories below it. */
function collectRoots(cwd, depth) {
  const roots = [cwd]
  const walk = (dir, remaining) => {
    if (remaining <= 0) return
    for (const child of listDirectories(dir)) {
      roots.push(child)
      walk(child, remaining - 1)
    }
  }
  walk(cwd, depth)
  return roots
}

function walkInstructionFiles(dir, depth, found = []) {
  if (depth < 0) return found
  for (const entry of listEntries(dir)) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      walkInstructionFiles(full, depth - 1, found)
      continue
    }
    if (entry.name.endsWith(INSTRUCTION_SUFFIX)) found.push(full)
  }
  return found
}

function makeInstruction(cwd, rootDir, absolutePath, content, applyTo) {
  return {
    absolutePath,
    displayPath: toDisplayPath(cwd, absolutePath),
    rootDir,
    applyTo,
    content,
  }
}

/** VSCode matches `applyTo` against a path relative to the project root. */
function toDisplayPath(cwd, absolutePath) {
  return relative(cwd, absolutePath).split(sep).join('/')
}

function makeSkill(bundleDir, file, text, warnings) {
  const { data } = parseFrontmatter(text)
  const directoryName = basename(bundleDir)

  let skillName = typeof data.name === 'string' ? data.name.trim() : ''
  if (!KEBAB.test(skillName)) {
    const fallback = slug(directoryName)
    if (skillName !== '') warnings.push(`${file}: name "${skillName}" is not kebab-case`)
    if (!KEBAB.test(fallback)) {
      warnings.push(`${file}: skipped, no usable kebab-case name`)
      return null
    }
    warnings.push(`${file}: using directory name "${fallback}"`)
    skillName = fallback
  }

  const description = typeof data.description === 'string' ? data.description.trim() : ''
  if (description === '') {
    warnings.push(`${file}: skipped, description is required`)
    return null
  }

  const invocation = { modelInvocable: true, userInvocable: true }
  const flags = [
    ['disable-model-invocation', 'modelInvocable', (parsed) => !parsed],
    ['user-invocable', 'userInvocable', (parsed) => parsed],
  ]
  for (const [key, field, apply] of flags) {
    if (data[key] === undefined) continue
    const parsed = parseBoolean(data[key])
    if (parsed === undefined) {
      warnings.push(`${file}: skipped, "${key}" is not a boolean`)
      return null
    }
    invocation[field] = apply(parsed)
  }

  const whenToUse = typeof data.whenToUse === 'string' ? data.whenToUse.trim() : ''
  return {
    name: skillName,
    description,
    ...(whenToUse === '' ? {} : { whenToUse }),
    invocation,
    absolutePath: file,
    dir: bundleDir,
  }
}

function splitRelative(value) {
  return String(value).split('/').filter((part) => part !== '')
}

function listEntries(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

/** Immediate subdirectories, name-sorted, without dot-dirs or `node_modules`. */
function listDirectories(dir) {
  return listEntries(dir)
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && !SKIPPED_DIRECTORY(entry.name))
    .map((entry) => join(dir, entry.name))
    .sort()
}

function readText(file, maxBytes) {
  try {
    const info = statSync(file)
    if (!info.isFile() || info.size > maxBytes) return null
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

function slug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
