/**
 * Cordis plugin: load VSCode/Copilot AI configuration into DSH sessions.
 *
 * Host plane. The plugin publishes no service, so it may sit loose in the host
 * composition; registering there puts its contributions in the *global* layer,
 * which is what "every session sees the workspace's own configuration" means.
 *
 * Three seams:
 *
 * - `agent/pre-step` folds the instructions into the step's message batch as a
 *   user-role message carrying `source.form = 'instructions'`. That is what makes
 *   the injection a first-class, individually labelled row in the client, instead
 *   of an anonymous line inside the system-prompt snapshot.
 * - `ctx.skills.registerProvider` answers the skill catalog. `list({ cwd })` is
 *   called by the real consumer with the session working directory, and `get()`
 *   re-reads the file so a body edit needs no invalidation.
 * - `fs/observed` supplies the one piece of session state VSCode's `applyTo`
 *   needs: which files a session has actually looked at. Its `actor` is the
 *   `ToolExecution`, which carries `.agent`, so observations are attributed to
 *   the session that made them and never leak across sessions.
 *
 * Everything a session owns — cwd, the touched-path set, and the last injected
 * rendering — is keyed by session id, because one host instance serves every
 * session in the process.
 *
 * The injected message is built here rather than with `createUserMessage` from
 * `@deepseek-ai/dsh-llm`: a profile-local plugin cannot reach the harness's own
 * `node_modules`, so the four-field shape is reproduced literally. See the
 * README's upgrade checklist — that shape and the pre-step decision contract are
 * the two internal things this plugin depends on.
 */

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { discover } from './discover.js'
import { matchesAny } from './glob.js'
import { parseFrontmatter } from './frontmatter.js'

export const PLUGIN_NAME = 'import-vscode-ai-files'

const PROVIDER_NAME = 'import-vscode-ai-files'
/** A provider label; not one of the built-in project roots. */
const SKILL_SOURCE = 'project-vscode'
/** Between the built-in `project-dsh` (100) and `project-agents` (200) roots. */
const SKILL_RANK = 150

const DEFAULT_MAX_BYTES = 65536
const TOUCHED_LIMIT = 2048
const SESSION_LIMIT = 64
const MIN_TRUNCATED_BLOCK = 128
/** Headroom for the "N files omitted" notice, so a render never exceeds the budget. */
const NOTICE_RESERVE = 128
const TRUNCATED_SUFFIX = '\n\n[truncated]'
const MAX_LOGGED_WARNINGS = 200
const GITHUB_SEGMENT = '/.github/'

const INTRO =
  'The following workspace instructions come from VSCode-style configuration (.github). ' +
  'Use them as guidance when applicable; more specific instructions take precedence over broader ones.'

export default {
  name: PLUGIN_NAME,
  inject: ['skills'],

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

    /**
     * Per-session state, keyed by session id:
     * `{ cwd, touched, injectedText, injectedPaths }`.
     */
    const sessions = new Map()
    let invalidateCatalog = null
    const loggedWarnings = new Set()

    const sessionFor = (id, cwd) => {
      let session = sessions.get(id)
      if (session === undefined) {
        // Sessions come and go; drop the oldest rather than growing forever.
        if (sessions.size >= SESSION_LIMIT) sessions.delete(sessions.keys().next().value)
        session = { cwd: null, touched: new Set(), injectedText: '', injectedPaths: new Set() }
        sessions.set(id, session)
      }
      if (typeof cwd === 'string' && cwd !== '') session.cwd = cwd
      return session
    }

    // ---- instructions: a labelled injection that enters the step's batch ----
    ctx.on('agent/pre-step', async (payload, next) => {
      const decision = await next()
      try {
        if (decision?.kind === 'reject') return decision
        if (!Array.isArray(decision?.messages)) return decision
        // Nothing has been claimed yet, so there is no batch to attach to.
        if (payload.step === 1 && decision.messages.length === 0) return decision

        const session = sessionFor(String(payload.agent.id), payload.agent.session?.header?.cwd)
        const rendered = renderInstructions(session, settings)
        const text = withRemovals(rendered, session)
        if (text === null) return decision

        // Append rather than splice after the claimed messages.
        //
        // Every injection listener splices at that same index, so whichever one
        // runs LAST wins the earlier slot. This row is composed on the HOST plane
        // and therefore registers before any preset mount registers
        // `dsh-agent-instructions`, which made the `.github` rules land ahead of
        // AGENTS.md. Appending makes the order independent of registration order:
        // AGENTS.md first, then this.
        const entered = [...decision.messages, injectionMessage(text)]
        session.injectedText = rendered.text
        session.injectedPaths = rendered.paths
        return { ...decision, messages: entered }
      } catch (error) {
        // A changed internal shape must not break the turn.
        console.error(`[${PROVIDER_NAME}] pre-step injection failed:`, error)
        return decision
      }
    })

    // ---- skills: one provider, scanned fresh on every catalog read ----
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

    // ---- observations: touched files for `applyTo`, plus catalog invalidation ----
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
      // One provider serves every workspace, so its catalog must be invalidated
      // by a `.github` change anywhere — not only under this session's own cwd.
      // Binding this to `session.cwd` left a skill edited in workspace B stale
      // for a session sitting in workspace A.
      if (normalize(absolute).includes(GITHUB_SEGMENT)) invalidateCatalog?.()
    })
  },
}

/**
 * Build the user-role injection message.
 *
 * Mirrors `createUserMessage` from `@deepseek-ai/dsh-llm`, which a profile-local
 * plugin cannot import. `source.form = 'instructions'` is what the client uses to
 * present this as an instruction injection rather than an opaque context row.
 */
function injectionMessage(text) {
  return deepFreeze({
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: PLUGIN_NAME, form: 'instructions' },
  })
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) deepFreeze(value[key])
    Object.freeze(value)
  }
  return value
}

/**
 * What to inject this step, or `null` when the session already has it.
 *
 * A changed rendering produces a new message — the previous one stays in history,
 * so paths that disappeared get an explicit removal notice rather than being
 * silently dropped.
 */
function withRemovals(rendered, session) {
  const removed = [...session.injectedPaths].filter((path) => !rendered.paths.has(path))
  if (removed.length === 0 && rendered.text === session.injectedText) return null
  if (removed.length === 0 && rendered.text === '') return null

  const parts = []
  if (removed.length > 0) {
    parts.push(`Instructions removed:\n${removed.map((path) => `- ${path}`).join('\n')}`)
  }
  if (rendered.text !== '') parts.push(rendered.text)
  return parts.join('\n\n')
}

function renderInstructions(session, settings) {
  if (session.cwd === null) return { text: '', paths: new Set() }
  let found
  try {
    found = discover({ cwd: session.cwd, ...settings })
  } catch (error) {
    console.error(`[${PROVIDER_NAME}] discovery failed:`, error)
    return { text: '', paths: new Set() }
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

/** Compose the entries that fit the budget, and report which ones made it. */
function compose(entries, maxBytes) {
  const paths = new Set()
  if (entries.length === 0) return { text: '', paths }
  // The notice is appended after the blocks, so its headroom comes off the top:
  // without that reserve the render can exceed the configured budget.
  const budget = maxBytes - INTRO.length - 2 - NOTICE_RESERVE

  const kept = []
  let used = 0
  let dropped = 0

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    const block = renderBlock(entry)
    if (used + block.length + 2 <= budget) {
      kept.push(block)
      paths.add(entry.displayPath)
      used += block.length + 2
      continue
    }
    const remaining = budget - used - 2
    if (remaining >= MIN_TRUNCATED_BLOCK + TRUNCATED_SUFFIX.length) {
      kept.push(`${block.slice(0, remaining - TRUNCATED_SUFFIX.length)}${TRUNCATED_SUFFIX}`)
      paths.add(entry.displayPath)
      dropped = entries.length - index - 1
    } else {
      dropped = entries.length - index
    }
    break
  }

  if (kept.length === 0) return { text: '', paths }
  const notice = dropped > 0 ? `\n\n[${dropped} instruction file(s) omitted by the ${maxBytes}-byte budget]` : ''
  return { text: `${INTRO}\n\n${kept.join('\n\n')}${notice}`, paths }
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
