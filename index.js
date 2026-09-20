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
 * A fourth, optional seam publishes the settings namespace behind
 * `lib/client.js`'s card, which is how the extra `paths` are edited in the GUI's
 * Plugins page. It is optional twice over: no settings provider means the plugin
 * simply runs on its composition config, and an unresolvable schemastery means
 * only the card is missing. `attachSettings` covers both.
 *
 * Everything a session owns — cwd, the touched-path set, and the last injected
 * rendering — is keyed by session id, because one host instance serves every
 * session in the process.
 *
 * The injected message is built here rather than with `createUserMessage` from
 * `@deepseek-ai/dsh-llm`: a plugin installed into a profile cannot reach the
 * harness's own `node_modules`, so the four-field shape is reproduced literally.
 * That shape, the pre-step decision contract, and the settings namespace being
 * the browser card's slot key are the three internal things this plugin depends
 * on — doc/design.md §3.2 and §3.8 cover them, and CONTRIBUTING §4 is the
 * upgrade checklist.
 */

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { discover, isPortableAbsolute, resolveConfiguredPath } from './lib/discover.js'
import { matchesAny } from './lib/glob.js'
import { parseFrontmatter } from './lib/frontmatter.js'

export const PLUGIN_NAME = 'import-vscode-ai-files'

const PROVIDER_NAME = 'import-vscode-ai-files'
/**
 * The runtime settings namespace. It is also the key the browser half registers
 * its card under in `settings.plugin.item`, so the two must stay identical.
 */
export const SETTINGS_NAMESPACE = 'import-vscode-ai-files'
/** A provider label; not one of the built-in project roots. */
const SKILL_SOURCE = 'project-vscode'
/** Between the built-in `project-dsh` (100) and `project-agents` (200) roots. */
const SKILL_RANK = 150

const DEFAULT_MAX_BYTES = 65536
const DEFAULT_SCAN_SUBDIRECTORIES = 1
const DEFAULT_INSTRUCTION_DIRS = ['.github/instructions']
const DEFAULT_SKILL_DIRS = ['.github/skills']
/**
 * The configured paths this plugin starts from: the per-user Copilot home,
 * `[user]\.copilot`, which holds the same layout as a project's `.github`. A
 * leading `~` is the user's home directory, so the entry is the same text on
 * every machine and every deployment.
 */
const DEFAULT_PATHS = ['~/.copilot']
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
   * @param config.instructionDirs - `*.instructions.md` directories, relative to a configuration directory.
   * @param config.skillDirs - `<name>/SKILL.md` directories, relative to a configuration directory.
   * @param config.paths - configured paths that ARE the `.github`-equivalent directory.
   * @param options - internal seam; production callers pass nothing.
   * @param options.loadSchema - replaces the lazy `@deepseek-ai/schemastery` load.
   * @param options.homeDir - replaces `os.homedir()` as what `~` resolves to.
   */
  apply(ctx, config, options) {
    // The composition entry is both the settings namespace's `base` layer and
    // the value this plugin runs on when no settings provider is mounted, so it
    // is held as a thunk: `setSource` swaps the thunk, never a snapshot.
    let readSettings = () => config
    const settings = () => normalizeSettings(readSettings())
    // Resolved once: `~` in `paths` means the same directory for the life of the
    // row, in discovery and in the invalidation check that must agree with it.
    const home = options?.homeDir ?? homedir()

    /**
     * Per-session state, keyed by session id:
     * `{ cwd, touched, injectedText, injectedPaths }`.
     */
    const sessions = new Map()
    let invalidateCatalog = null
    const loggedWarnings = new Set()

    attachSettings(ctx, {
      entry: config,
      onSource: (next) => {
        readSettings = next
      },
      // A committed change can add or remove skills, and nothing it did touched
      // the filesystem — so no `fs/observed` signal will arrive to refresh the
      // catalog. `paths` is exactly that kind of change.
      onChange: () => invalidateCatalog?.(),
      loadSchema: options?.loadSchema,
    })

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
        const current = settings()
        const rendered = renderInstructions(session, current, home)
        const text = withRemovals(rendered, session, current.maxBytes)
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
          const found = discover({ cwd, homeDir: home, ...settings() })
          reportWarnings(found.warnings, loggedWarnings)
          return found.skills.map(toCandidate)
        },

        async get(candidate) {
          const file = typeof candidate?.locator === 'string' ? candidate.locator : null
          if (file === null) return undefined
          // Read on every load: the body has no cache to invalidate.
          let source
          try {
            source = readFileSync(file, 'utf8')
          } catch (error) {
            if (error?.code === 'ENOENT') return undefined
            throw error
          }
          const { body } = parseFrontmatter(source)
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
      const absolute = isPortableAbsolute(display)
        ? display
        : session.cwd === null
          ? null
          : resolve(session.cwd, display)
      if (absolute === null) return
      if (session.touched.size < TOUCHED_LIMIT) session.touched.add(absolute)
      // One provider serves every workspace, so its catalog must be invalidated
      // by a configuration change anywhere — not only under this session's own
      // cwd. Binding this to `session.cwd` left a skill edited in workspace B
      // stale for a session sitting in workspace A.
      //
      // A `.github` segment is only one of the two shapes a configuration
      // directory has: a configured path IS such a directory, so a skill edited
      // under it carries no `.github` at all and would otherwise never refresh
      // the catalog.
      if (touchesConfigDir(absolute, settings(), session.cwd, home)) invalidateCatalog?.()
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
 * Register this plugin's runtime settings namespace, tolerating its absence.
 *
 * Two things are deliberately optional:
 *
 * - **The `settings` service.** `ctx.inject` runs the callback only once the
 *   service is up, and `installSection` hands back `() => entry` when the
 *   service goes away, so a deployment with no settings provider keeps running
 *   on the composition config alone.
 * - **`@deepseek-ai/schemastery`.** The schema has to be a real schemastery
 *   schema: the browser rebuilds it from `schema.toJSON()` to render the card,
 *   and a hand-written envelope is not rebuildable. Loading it lazily keeps this
 *   package's load-time imports at zero — a clone with no `node_modules` still
 *   runs `npm test` — and a profile that cannot resolve the package loses the
 *   card rather than the whole plugin.
 *
 * @param ctx - the host context the row was composed into.
 * @param options.entry - the composition config, used as the `base` layer.
 * @param options.onSource - receives the live settings getter.
 * @param options.onChange - called after every committed settings change.
 * @param options.loadSchema - schema loader; tests replace it.
 */
export function attachSettings(
  ctx,
  { entry, onSource, onChange, loadSchema = defaultSchemaLoader },
) {
  // A context outside the real loader (a test double) simply has no settings.
  if (typeof ctx.inject !== 'function') return

  let disposed = false
  ctx.effect?.(() => () => {
    disposed = true
  }, `${PROVIDER_NAME}: settings load guard`)

  ctx.inject(['settings'], (settingsCtx) => {
    Promise.resolve()
      .then(() => loadSchema())
      .then((schema) => {
        if (disposed) return
        settingsCtx.settings.installSection(ctx, SETTINGS_NAMESPACE, schema, entry, {
          setSource: (current) => onSource(current),
          onChange: () => onChange?.(),
        })
      })
      .catch((error) => {
        console.error(`[${PROVIDER_NAME}] settings namespace not registered:`, error)
      })
  })
}

/** The defaults the composition entry and the schema both start from. */
export const SETTINGS_DEFAULTS = {
  maxBytes: DEFAULT_MAX_BYTES,
  scanSubdirectories: DEFAULT_SCAN_SUBDIRECTORIES,
  instructionDirs: DEFAULT_INSTRUCTION_DIRS,
  skillDirs: DEFAULT_SKILL_DIRS,
  paths: DEFAULT_PATHS,
}

/** The one place a DSH package is imported, and only when settings exist. */
function defaultSchemaLoader() {
  return Promise.all([import('@deepseek-ai/schemastery'), import('./lib/settings.js')]).then(
    ([schemastery, settings]) => settings.settingsSchema(schemastery.default, SETTINGS_DEFAULTS),
  )
}

/** What this plugin runs on, whether it came from the composition or from settings. */
export function normalizeSettings(config) {
  return {
    maxBytes: nonNegative(config?.maxBytes, DEFAULT_MAX_BYTES),
    scanSubdirectories: nonNegative(config?.scanSubdirectories, DEFAULT_SCAN_SUBDIRECTORIES),
    instructionDirs: stringList(config?.instructionDirs, DEFAULT_INSTRUCTION_DIRS),
    skillDirs: stringList(config?.skillDirs, DEFAULT_SKILL_DIRS),
    paths: stringList(config?.paths, DEFAULT_PATHS),
  }
}

/**
 * What to inject this step, or `null` when the session already has it.
 *
 * A changed rendering produces a new message — the previous one stays in history,
 * so paths that disappeared get an explicit removal notice rather than being
 * silently dropped.
 */
function withRemovals(rendered, session, maxBytes) {
  const removed = [...session.injectedPaths].filter((path) => !rendered.paths.has(path))
  if (removed.length === 0 && rendered.text === session.injectedText) return null
  if (removed.length === 0 && rendered.text === '') return null

  const parts = []
  if (removed.length > 0) {
    parts.push(`Instructions removed:\n${removed.map((path) => `- ${sanitize(path)}`).join('\n')}`)
  }
  if (rendered.text !== '') parts.push(rendered.text)
  return truncateUtf8(parts.join('\n\n'), maxBytes)
}

function renderInstructions(session, settings, home) {
  if (session.cwd === null) return { text: '', paths: new Set() }
  let found
  try {
    found = discover({ cwd: session.cwd, homeDir: home, ...settings })
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
  const budget = maxBytes - utf8ByteLength(INTRO) - 2 - NOTICE_RESERVE

  const kept = []
  let used = 0
  let dropped = 0

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    const block = renderBlock(entry)
    if (used + utf8ByteLength(block) + 2 <= budget) {
      kept.push(block)
      paths.add(entry.displayPath)
      used += utf8ByteLength(block) + 2
      continue
    }
    const remaining = budget - used - 2
    if (remaining >= MIN_TRUNCATED_BLOCK + utf8ByteLength(TRUNCATED_SUFFIX)) {
      kept.push(`${truncateUtf8(block, remaining - utf8ByteLength(TRUNCATED_SUFFIX))}${TRUNCATED_SUFFIX}`)
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
      ? `Instructions from: ${sanitize(entry.displayPath)}`
      : `Instructions from: ${sanitize(entry.displayPath)}\nApplies to: ${entry.applyTo.map(sanitize).join(', ')}`
  return `${heading}\n\n${sanitize(entry.content).trim()}`
}

/** Repository-controlled text must not be able to close the harness frame. */
function sanitize(content) {
  return content.replaceAll('</system-reminder>', '<\\/system-reminder>')
}

function utf8ByteLength(value) {
  return Buffer.byteLength(value, 'utf8')
}

function truncateUtf8(value, maxBytes) {
  if (maxBytes <= 0) return ''
  if (utf8ByteLength(value) <= maxBytes) return value
  const bytes = Buffer.from(value, 'utf8').subarray(0, maxBytes)
  let end = bytes.length
  while (end > 0 && (bytes[end - 1] & 0xc0) === 0x80) end -= 1
  return bytes.subarray(0, end).toString('utf8')
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

/** A configured path list: drop anything that is not a usable path string. */
function stringList(value, fallback = []) {
  if (!Array.isArray(value)) return fallback
  return value.filter((entry) => typeof entry === 'string' && entry.trim() !== '')
}

function normalize(value) {
  return value.replace(/\\/g, '/')
}

/**
 * Whether an observed file lies inside a configuration directory: a `.github`
 * tree, or one of the configured `paths` — which IS such a directory itself and
 * so has no `.github` segment to be recognised by.
 *
 * A configured path is resolved exactly as discovery resolves it, `~` included.
 * A session with no cwd yet cannot place a relative entry, so that entry is
 * skipped rather than guessed at against the process cwd.
 */
function touchesConfigDir(absolute, current, cwd, home) {
  const observed = comparable(normalize(absolute))
  if (observed.includes(GITHUB_SEGMENT)) return true

  for (const entry of current.paths) {
    const dir = resolveConfiguredPath(cwd, entry, home)
    if (dir === null) continue
    const base = comparable(normalize(dir)).replace(/\/+$/, '')
    if (base === '') continue
    if (observed === base || observed.startsWith(`${base}/`)) return true
  }
  return false
}

/** Compare paths the way the platform's filesystem does. */
function comparable(value) {
  return process.platform === 'win32' ? value.toLowerCase() : value
}
