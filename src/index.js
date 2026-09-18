/**
 * Cordis plugin: load VSCode/Copilot AI configuration into DSH sessions.
 *
 * Host plane. The plugin publishes no service, so it may sit loose in the host
 * composition; registering there puts its contributions in the *global* layer,
 * which is what "every session sees the workspace's own configuration" means.
 *
 * Three seams, and nothing else:
 *
 * - `ctx.systemPrompt.context` renders the instructions. Its callback receives
 *   `{ agent, scope, signal }`, so `agent.session.header.cwd` is read
 *   **synchronously** on every assembly — no event bookkeeping, no cache.
 * - `ctx.skills.registerProvider` answers the skill catalog. `list({ cwd })` is
 *   called by the real consumer with the session working directory, and `get()`
 *   re-reads the file so a body edit needs no invalidation.
 * - `fs/observed` supplies the one piece of session state VSCode's `applyTo`
 *   needs: which files a session has actually looked at. Its `actor` is the
 *   `ToolExecution`, which carries `.agent`, so observations are attributed to
 *   the session that made them and never leak across sessions.
 *
 * Everything a session owns — cwd and the touched-path set — is keyed by
 * session id, because one host instance serves every session in the process.
 */

import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { discover } from './discover.js'
import { matchesAny } from './glob.js'
import { parseFrontmatter } from './frontmatter.js'

export const PLUGIN_NAME = 'import-vscode-ai-files'

const CONTEXT_NAME = 'vscode-ai-instructions'
/** Sorts after the ambient `sandbox:policy` and `approval:policy` contexts. */
const CONTEXT_ORDER = 900
const PROVIDER_NAME = 'import-vscode-ai-files'
/** A provider label; not one of the built-in project roots. */
const SKILL_SOURCE = 'project-vscode'
/** Between the built-in `project-dsh` (100) and `project-agents` (200) roots. */
const SKILL_RANK = 150

const DEFAULT_MAX_BYTES = 65536
const TOUCHED_LIMIT = 2048
const SESSION_LIMIT = 64
const MIN_TRUNCATED_BLOCK = 128
const MAX_LOGGED_WARNINGS = 200
const GITHUB_SEGMENT = '/.github/'

const INTRO =
  'The following workspace instructions come from VSCode-style configuration (.github). ' +
  'Use them as guidance when applicable; more specific instructions take precedence over broader ones.'

export default {
  name: PLUGIN_NAME,
  inject: ['skills', 'systemPrompt'],

  /**
   * @param ctx - the host context this row was composed into.
   * @param config - optional row configuration.
   * @param config.maxBytes - rendered-instructions budget.
   * @param config.scanSubdirectories - levels below `cwd` treated as project roots.
   * @param config.instructionDirs - root-relative `*.instructions.md` directories.
   * @param config.skillDirs - root-relative `<name>/SKILL.md` directories.
   */
  apply(ctx, config) {
    const settings = {
      maxBytes: nonNegative(config?.maxBytes, DEFAULT_MAX_BYTES),
      scanSubdirectories: nonNegative(config?.scanSubdirectories, 1),
      instructionDirs: config?.instructionDirs ?? ['.github/instructions'],
      skillDirs: config?.skillDirs ?? ['.github/skills'],
    }

    /** Per-session state: `{ cwd, touched }`, keyed by session id. */
    const sessions = new Map()
    let invalidateCatalog = null
    const loggedWarnings = new Set()

    const sessionFor = (id, cwd) => {
      let session = sessions.get(id)
      if (session === undefined) {
        // Sessions come and go; drop the oldest rather than growing forever.
        if (sessions.size >= SESSION_LIMIT) sessions.delete(sessions.keys().next().value)
        session = { cwd: null, touched: new Set() }
        sessions.set(id, session)
      }
      if (typeof cwd === 'string' && cwd !== '') session.cwd = cwd
      return session
    }

    ctx.systemPrompt.context({
      name: CONTEXT_NAME,
      order: CONTEXT_ORDER,
      text: (context) => {
        const agent = context?.agent
        if (agent?.id === undefined) return ''
        const session = sessionFor(String(agent.id), agent.session?.header?.cwd)
        return renderInstructions(session, settings)
      },
    })

    ctx.skills.registerProvider((control) => {
      invalidateCatalog = control.invalidate
      return {
        name: PROVIDER_NAME,

        async list(options) {
          const cwd = nonEmptyString(options?.cwd)
          if (cwd === null) return []
          const found = discover({ cwd, ...settings })
          reportWarnings(found.warnings, loggedWarnings)
          return found.skills.map(toCandidate)
        },

        async get(candidate) {
          const file = typeof candidate?.locator === 'string' ? candidate.locator : null
          if (file === null) return undefined
          // Read on every load: the body has no cache to invalidate.
          const { body } = parseFrontmatter(readFileSync(file, 'utf8'))
          return { ...describe(candidate, dirname(file)), path: file, content: body.trim() }
        },
      }
    })

    ctx.on('fs/observed', (target, _observation, actor) => {
      const display = target?.displayPath
      if (typeof display !== 'string' || display === '') return
      // Attributed to the executing session; an unattributed observation is
      // nobody's and is dropped rather than guessed at.
      const agent = actor?.agent
      if (agent?.id === undefined) return
      const session = sessionFor(String(agent.id), agent.session?.header?.cwd)
      const absolute = isAbsolute(display)
        ? display
        : session.cwd === null
          ? null
          : resolve(session.cwd, display)
      if (absolute === null) return
      if (session.touched.size < TOUCHED_LIMIT) session.touched.add(absolute)
      if (session.cwd !== null && absolute.startsWith(session.cwd) && normalize(absolute).includes(GITHUB_SEGMENT)) {
        invalidateCatalog?.()
      }
    })
  },
}

function renderInstructions(session, settings) {
  if (session.cwd === null) return ''
  let found
  try {
    found = discover({ cwd: session.cwd, ...settings })
  } catch (error) {
    console.error(`[${PROVIDER_NAME}] discovery failed:`, error)
    return ''
  }
  const selected = found.instructions.filter(
    (entry) => entry.applyTo === null || matchesTouched(entry, session.touched),
  )
  return compose(selected, settings.maxBytes)
}

/** An `applyTo` entry applies when any observed file matches, root-relative. */
function matchesTouched(entry, touched) {
  for (const absolute of touched) {
    const path = relative(entry.rootDir, absolute)
    if (path === '' || path.startsWith('..') || isAbsolute(path)) continue
    if (matchesAny(path, entry.applyTo)) return true
  }
  return false
}

function compose(entries, maxBytes) {
  if (entries.length === 0) return ''
  const budget = maxBytes - INTRO.length - 2
  const blocks = entries.map(renderBlock)

  const kept = []
  let used = 0
  let dropped = 0

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]
    if (used + block.length + 2 <= budget) {
      kept.push(block)
      used += block.length + 2
      continue
    }
    const remaining = budget - used - 2
    if (remaining >= MIN_TRUNCATED_BLOCK) {
      kept.push(`${block.slice(0, remaining)}\n\n[truncated]`)
      dropped = blocks.length - index - 1
    } else {
      dropped = blocks.length - index
    }
    break
  }

  if (kept.length === 0) return ''
  const notice = dropped > 0 ? `\n\n[${dropped} instruction file(s) omitted by the ${maxBytes}-byte budget]` : ''
  return `${INTRO}\n\n${kept.join('\n\n')}${notice}`
}

function renderBlock(entry) {
  const heading =
    entry.applyTo === null
      ? `Instructions from: ${entry.displayPath}`
      : `Instructions from: ${entry.displayPath}\nApplies to: ${entry.applyTo.join(', ')}`
  return `${heading}\n\n${sanitize(entry.content).trim()}`
}

/** Repository-controlled text must not be able to close the harness frame. */
function sanitize(content) {
  return content.replaceAll('</system-reminder>', '<\\/system-reminder>')
}

function describe(skill, directory) {
  const summary = {
    name: skill.name,
    description: skill.description,
    invocation: skill.invocation,
    source: SKILL_SOURCE,
    provider: PROVIDER_NAME,
    resourceBase: { kind: 'directory', path: directory },
  }
  if (skill.whenToUse !== undefined) summary.whenToUse = skill.whenToUse
  return summary
}

function toCandidate(skill) {
  return {
    ...describe(skill, skill.dir),
    rank: SKILL_RANK,
    locator: skill.absolutePath,
    path: skill.absolutePath,
  }
}

/** A malformed file is skipped by discovery; surface why, once per message. */
function reportWarnings(warnings, logged) {
  for (const warning of warnings) {
    if (logged.has(warning)) continue
    if (logged.size >= MAX_LOGGED_WARNINGS) logged.clear()
    logged.add(warning)
    console.error(`[${PROVIDER_NAME}] ${warning}`)
  }
}

function nonEmptyString(value) {
  return typeof value === 'string' && value !== '' ? value : null
}

function nonNegative(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

function normalize(value) {
  return value.replace(/\\/g, '/')
}
