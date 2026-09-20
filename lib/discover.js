/**
 * Discover VSCode-style AI configuration for a session.
 *
 * The unit of scanning is a **configuration directory** — one laid out like
 * `.github`, holding `copilot-instructions.md`, `instructions/` and `skills/`.
 * Two things produce one:
 *
 * - The session cwd plus `scanSubdirectories` levels below it. Each of those
 *   directories is a *project root*, and its configuration directory is
 *   `<root>/.github`. That is what makes a multi-repo folder such as
 *   `D:\NEVSTOP-LAB` work: the folder itself and each repository directly under
 *   it contribute their own `.github`.
 * - Every entry in `paths`, which **is** the configuration directory itself —
 *   the `.github`-equivalent, with no `.github` segment under it. So
 *   `paths: [D:\shared-ai]` reads `D:\shared-ai/copilot-instructions.md`,
 *   `D:\shared-ai/instructions/**` and `D:\shared-ai/skills/<name>/SKILL.md`.
 *   `instructionDirs` / `skillDirs` are therefore resolved against such a path
 *   with a leading `.github/` segment dropped; an entry that does not start
 *   with `.github` is joined unchanged in both kinds.
 *
 * `scanSubdirectories` belongs to the workspace walk only: a configured path
 * names one configuration directory, and its subdirectories are content rather
 * than further configuration roots.
 *
 * A configured path is resolved by `resolveConfiguredPath`: against the session
 * cwd, or from the user's home directory when it starts with `~`.
 *
 * `AGENTS.md` is deliberately absent. It belongs to the DSH core
 * (`dsh-agent-instructions`), which reads it along the project-root-to-cwd
 * ancestor chain — so it stays a current-working-directory concept, and nothing
 * reached through `paths` or through a subdirectory root contributes one.
 *
 * All IO is synchronous on purpose. `systemPrompt.context` renders through a
 * synchronous callback, so a synchronous reader keeps the plugin free of any
 * cache, invalidation state, or async plumbing.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { parseBoolean, parseFrontmatter } from './frontmatter.js'
import { parseApplyTo } from './glob.js'

const GITHUB_DIR = '.github'
const COPILOT_FILE = 'copilot-instructions.md'
const INSTRUCTION_SUFFIX = '.instructions.md'
const SKILL_FILE = 'SKILL.md'
const MAX_INSTRUCTION_DEPTH = 4
const DEFAULT_MAX_SOURCE_BYTES = 1024 * 1024
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
/**
 * `instructionDirs` / `skillDirs` are written with the platform's own spelling:
 * Windows configurations use `\`, and both are accepted there so
 * `.github\instructions` means the same as `.github/instructions`.
 */
const SEPARATORS = process.platform === 'win32' ? /[\\/]+/ : /\/+/
/** A leading `~`, alone or before a separator, is the user's home directory. */
const TILDE = process.platform === 'win32' ? /^~(?=$|[\\/])/ : /^~(?=$|\/)/

/** Directory names never treated as a project root or walked into. */
const SKIPPED_DIRECTORY = (name) => name.startsWith('.') || name === 'node_modules'

/**
 * Scan for instructions and skills.
 *
 * @param options - discovery options.
 * @param options.cwd - the session working directory.
 * @param options.scanSubdirectories - how many levels below `cwd` to treat as roots.
 * @param options.instructionDirs - `*.instructions.md` directories, relative to a configuration directory.
 * @param options.skillDirs - `<name>/SKILL.md` directories, relative to a configuration directory.
 * @param options.paths - configured paths that ARE configuration directories.
 * @param options.homeDir - the home directory a leading `~` in `paths` names.
 * @param options.maxSourceBytes - skip a single source file larger than this.
 * @returns the discovered instructions, skills, roots, configured paths and warnings.
 */
export function discover(options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd())
  const instructionDirs = options.instructionDirs ?? [`${GITHUB_DIR}/instructions`]
  const skillDirs = options.skillDirs ?? [`${GITHUB_DIR}/skills`]
  const maxSourceBytes = options.maxSourceBytes ?? DEFAULT_MAX_SOURCE_BYTES
  const home = options.homeDir ?? homedir()

  const warnings = []
  const instructions = []
  const skills = []
  const { roots, pathDirs, units } = collectUnits(
    cwd,
    options.scanSubdirectories ?? 1,
    options.paths,
    home,
  )
  // Two units can resolve to the same source file — for instance a `paths` entry
  // that repeats a project root while `instructionDirs` does not start with
  // `.github`, which makes both bases the same directory. The same file must
  // never be injected, or listed, twice.
  const seenFiles = new Set()
  const fileKey = (file) => (process.platform === 'win32' ? file.toLowerCase() : file)

  for (const unit of units) {
    // Grouped per configuration directory so the rendered order reads
    // repository by repository, with each one's always-on rules before its
    // scoped ones.
    const fromRoot = []

    const copilot = join(unit.configDir, COPILOT_FILE)
    const copilotText = readText(copilot, maxSourceBytes)
    // Copilot's repo-wide file is plain Markdown: a leading `---` there is a
    // horizontal rule, not frontmatter, so it is never parsed as such.
    if (copilotText !== null && !seenFiles.has(fileKey(copilot))) {
      seenFiles.add(fileKey(copilot))
      fromRoot.push(makeInstruction(cwd, unit.rootDir, copilot, copilotText, null))
    }

    for (const instructionDir of instructionDirs) {
      const base = configSubdirectory(unit, instructionDir)
      if (base === null) continue
      // Sorted so the rendered order does not depend on the platform's readdir order.
      for (const file of walkInstructionFiles(base, MAX_INSTRUCTION_DEPTH, unit.kind === 'config').sort()) {
        if (seenFiles.has(fileKey(file))) continue
        const text = readText(file, maxSourceBytes)
        if (text === null) continue
        seenFiles.add(fileKey(file))
        const { data, body } = parseFrontmatter(text)
        fromRoot.push(makeInstruction(cwd, unit.rootDir, file, body, parseApplyTo(data.applyTo)))
      }
    }

    fromRoot.sort((left, right) => Number(left.applyTo !== null) - Number(right.applyTo !== null))
    instructions.push(...fromRoot)

    for (const skillDir of skillDirs) {
      const base = configSubdirectory(unit, skillDir)
      if (base === null) continue
      for (const bundle of listDirectories(base)) {
        const file = join(bundle, SKILL_FILE)
        if (seenFiles.has(fileKey(file))) continue
        const text = readText(file, maxSourceBytes)
        if (text === null) continue
        seenFiles.add(fileKey(file))
        const skill = makeSkill(bundle, file, text, warnings)
        if (skill !== null) skills.push(skill)
      }
    }
  }

  skills.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))

  return { cwd, roots, pathDirs, instructions, skills, warnings }
}

/**
 * The configuration directories to scan, in order: the cwd walk first, then the
 * configured paths.
 *
 * A unit carries the configuration directory plus `rootDir`, the directory its
 * files' `applyTo` patterns are matched against — a project root for the cwd
 * walk, and the configured path itself for a `paths` entry, which has no
 * separate project root to anchor against.
 *
 * A configuration directory is never scanned twice: the cwd walk already reaches
 * the `.github` of every project root under it, so a `paths` entry naming one of
 * those — or naming another entry again — contributes nothing instead of
 * injecting the same file a second time. A path deeper than the cwd budget is
 * still scanned when it is named, because naming it is the request. A path that
 * does not exist on this machine contributes nothing: discovery is a read of
 * whatever is there, never an error.
 */
function collectUnits(cwd, depth, paths, home) {
  const roots = []
  const pathDirs = []
  const units = []
  const seenRoots = new Set()
  const seenConfigDirs = new Set()
  const key = (dir) => (process.platform === 'win32' ? dir.toLowerCase() : dir)

  const walk = (dir, remaining) => {
    if (seenRoots.has(key(dir))) return
    seenRoots.add(key(dir))
    roots.push(dir)

    const configDir = join(dir, GITHUB_DIR)
    if (!seenConfigDirs.has(key(configDir))) {
      seenConfigDirs.add(key(configDir))
      units.push({ kind: 'project', configDir, rootDir: dir })
    }

    if (remaining <= 0) return
    for (const child of listDirectories(dir)) walk(child, remaining - 1)
  }

  walk(cwd, depth)
  for (const value of Array.isArray(paths) ? paths : []) {
    const dir = resolveConfiguredPath(cwd, value, home)
    if (dir === null) continue
    if (seenConfigDirs.has(key(dir))) continue
    seenConfigDirs.add(key(dir))
    pathDirs.push(dir)
    units.push({ kind: 'config', configDir: dir, rootDir: dir })
  }
  return { roots, pathDirs, units }
}

/**
 * Where a relative directory — an `instructionDirs` / `skillDirs` entry —
 * resolves inside one configuration directory, or `null` when the entry could
 * only reach a `.github` tree a configured path must never read.
 *
 * Under a project root the entry is used as it is, so `.github/instructions`
 * means `<root>/.github/instructions`. A configured path already IS the
 * `.github`-equivalent directory, so a leading `.` segment (which means "this
 * directory") and then a leading `.github` segment are dropped: both
 * `.github/instructions` and `./.github/instructions` mean `<path>/instructions`.
 * An entry that does not start with `.github` is joined unchanged in both kinds.
 *
 * A configured path is the `.github`-equivalent directory, so nothing under a
 * `.github` *inside* it may be reached — whatever spelling the entry used. An
 * entry that leaves a `.github` segment anywhere is refused rather than walked,
 * and the walk itself skips hidden directories (see `walkInstructionFiles`), so
 * the degenerate spellings (`''`, `'.'`, `'/'`, `'.github'`, `'./.github'`) all
 * resolve to the configuration directory and still cannot reach its `.github`.
 */
function configSubdirectory(unit, name) {
  const parts = splitRelative(name)
  if (unit.kind === 'project') return join(unit.rootDir, ...parts)

  // Windows does not distinguish `.GITHUB` from `.github`, so neither may the
  // refusal below.
  const fold = (part) =>
    typeof part === 'string' && process.platform === 'win32' ? part.toLowerCase() : part
  const trimmed = fold(parts[0]) === '.' ? parts.slice(1) : parts
  const relative = fold(trimmed[0]) === GITHUB_DIR ? trimmed.slice(1) : trimmed
  if (relative.some((part) => fold(part) === GITHUB_DIR)) return null
  return join(unit.configDir, ...relative)
}

/** An absolute path in either platform's spelling, whatever this platform is. */
export function isPortableAbsolute(value) {
  return isAbsolute(value) || /^(?:[A-Za-z]:[\\/]|\\\\)/.test(value)
}

/**
 * A configured `paths` entry as an absolute directory, or `null` when it cannot
 * be placed.
 *
 * A leading `~` — on its own, or before a separator — is the user's home
 * directory, so `~/.copilot` means `<home>/.copilot` on every platform and
 * `~\x` reads the same on Windows. `~name` is a literal relative path rather
 * than another user's home, and environment variables and wildcards are not
 * expanded. Every other entry resolves against `cwd`, which an absolute entry
 * ignores.
 *
 * `cwd` is `null` for the one caller that can observe a file before its session
 * has a working directory. A relative entry cannot be placed then and is
 * refused rather than resolved against the process cwd — which would mark the
 * wrong directory as a configuration directory — while an absolute or `~` entry
 * is still placed.
 *
 * @param cwd - the session working directory, or `null` when it has none yet.
 * @param value - one entry of the configured path list.
 * @param home - what a leading `~` resolves to.
 * @returns the absolute directory, or `null` when the entry is unusable.
 */
export function resolveConfiguredPath(cwd, value, home = homedir()) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  if (TILDE.test(trimmed)) {
    const rest = trimmed
      .slice(1)
      .split(SEPARATORS)
      .filter((part) => part !== '')
    return resolve(home, ...rest)
  }
  if (cwd === null || cwd === undefined) return isPortableAbsolute(trimmed) ? resolve(trimmed) : null
  return resolve(cwd, trimmed)
}

/**
 * `*.instructions.md` files under `dir`, to `depth` levels.
 *
 * `skipHidden` is set for a configured path, where hidden directories are
 * content the scan must not descend into: a `.github` under a configuration
 * directory is never read. Under a project root the same entry is left alone,
 * because there `.github/instructions` IS the documented location.
 */
function walkInstructionFiles(dir, depth, skipHidden = false, found = []) {
  if (depth < 0) return found
  for (const entry of listEntries(dir)) {
    if (skipHidden && SKIPPED_DIRECTORY(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      walkInstructionFiles(full, depth - 1, skipHidden, found)
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

/**
 * VSCode matches `applyTo` against a path relative to the project root; this is
 * the label the injected block is headed with.
 *
 * A file under the working directory stays relative, which is what makes the
 * common case readable. A file reached through a configured extra root is not
 * under it, and `../../..` chains say less than the path itself, so those are
 * labelled with their absolute path — forward-slashed, so the label does not
 * depend on the platform.
 */
function toDisplayPath(cwd, absolutePath) {
  const relativePath = relative(cwd, absolutePath)
  if (relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))) {
    return relativePath.split(sep).join('/')
  }
  return normalize(absolutePath)
}

function normalize(value) {
  return value.split(sep).join('/')
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
  return String(value)
    .split(SEPARATORS)
    .filter((part) => part !== '')
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
