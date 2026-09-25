#!/usr/bin/env node
/**
 * verify-settings-schema.mjs — prove the settings chain against the REAL
 * `@deepseek-ai/schemastery` and the REAL `@deepseek-ai/dsh-settings` that a DSH
 * installation ships.
 *
 * The offline suite (`test/settings.test.js`) checks the schema's *shape* with a
 * recording stand-in, because a bare `@deepseek-ai/schemastery` import cannot
 * resolve in a bare checkout. That leaves the parts the card actually depends on
 * unchecked, and both of them fail silently:
 *
 *   1. the browser rebuilds the form from `schema.toJSON()`, and publishes no
 *      value at all when the rebuild fails;
 *   2. `dsh-settings` projects the form from the schema's **volatile** fields
 *      alone and writes a revision-fenced patch of them, so a field marked (or
 *      missed) wrongly yields an empty page or a mangled profile patch.
 *
 * So this script does what the service and the browser do, in order, against the
 * installed packages:
 *
 *   1. resolve the composition entry through the schema (defaults, user layer);
 *   2. reject values the page must never accept;
 *   3. serialize with `toJSON()` and rebuild from that envelope;
 *   4. run the Host's own `SettingsForms.describe()` over a fake configuration
 *      editor, and check the descriptor the browser mirror would receive;
 *   5. run the Host's own `SettingsForms.update()` and check the patch it writes
 *      keeps the composition-only fields;
 *   6. confirm index.js, lib/client.js and cordis.patch.yml spell the same
 *      entry id — the one coupling no compiler checks.
 *
 * It needs a DSH installation, so it is NOT part of `npm run check`; it skips
 * (exit 0, with a note) when the packages cannot be found, and fails loudly when
 * they can. See docs/development.md §3.
 *
 * Usage:
 *   node scripts/verify-settings-schema.mjs
 *   node scripts/verify-settings-schema.mjs --dsh-app <resources/app dir>
 *   node scripts/verify-settings-schema.mjs --schemastery <specifier-or-path>
 *   DSH_SCHEMASTERY=<specifier-or-path> node scripts/verify-settings-schema.mjs
 */

import { readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { SETTINGS_DEFAULTS, SETTINGS_ENTRY_ID, normalizeSettings } from '../index.js'
import { settingsSchema } from '../lib/settings.js'

/** The composition defaults, taken from the plugin itself so the two cannot drift. */
const DEFAULTS = SETTINGS_DEFAULTS
/** The row the composition file composes, i.e. the schema's `base` layer. */
const ROW = { maxBytes: DEFAULTS.maxBytes, scanSubdirectories: DEFAULTS.scanSubdirectories, paths: DEFAULTS.paths }

const ENTRY_ID_PATTERN = /^[a-z][a-z0-9-]*$/
const SCHEMASTERY = '@deepseek-ai/schemastery'
const SETTINGS = '@deepseek-ai/dsh-settings'

function arg(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

/**
 * A `--schemastery` value as something `import()` can take.
 *
 * A relative path is a path, not a package: `import('./x.mjs')` written here
 * would resolve against THIS file's directory, so it is turned into a file URL
 * rooted at the caller's working directory. Anything that is neither absolute
 * nor explicitly relative (`./`, `../`) is left alone as a package specifier.
 *
 * @param value - the raw argument.
 * @returns a file URL for a path, or the specifier unchanged.
 */
function toSpecifier(value) {
  if (isAbsolute(value)) return pathToFileURL(value).href
  if (value.startsWith('./') || value.startsWith('../') || value === '.' || value === '..') {
    return pathToFileURL(resolve(process.cwd(), value)).href
  }
  return value
}

/**
 * The `resources/app` directory of a DSH Desktop installation, if there is one.
 *
 * The packages a plugin's settings chain talks to live in ITS `node_modules`,
 * which a bare checkout cannot reach — and running this script from a profile
 * directory is the other supported way in.
 *
 * @returns an absolute directory, or null.
 */
function desktopAppDirectory() {
  const explicit = arg('dsh-app') ?? process.env.DSH_APP
  if (explicit !== undefined && explicit !== '') return explicit
  const localAppData = process.env.LOCALAPPDATA
  if (localAppData === undefined || localAppData === '') return null
  return join(localAppData, 'Programs', 'DSH Desktop', 'resources', 'app')
}

/**
 * Load one package, preferring the plain specifier and falling back to a DSH
 * Desktop installation.
 *
 * Only a candidate that is genuinely ABSENT is skipped. A package that is
 * present but broken — a syntax error, a missing transitive module — throws,
 * because reporting "skipped, exit 0" there would be a green light over a real
 * failure.
 *
 * @param packageName - the package to load.
 * @param fallback - `(appDirectory) => specifier`, the installation-relative entry.
 * @returns `{ module, from }`, or `{ module: null, tried }`.
 */
async function loadPackage(packageName, fallback) {
  const candidates = []
  const explicit = arg(packageName.split('/').pop())
  if (packageName === SCHEMASTERY && explicit !== undefined && explicit !== '') {
    candidates.push(toSpecifier(explicit))
  } else if (packageName === SCHEMASTERY && process.env.DSH_SCHEMASTERY) {
    candidates.push(toSpecifier(process.env.DSH_SCHEMASTERY))
  } else {
    candidates.push(packageName)
  }
  const app = desktopAppDirectory()
  if (app !== null) candidates.push(fallback(app))

  for (const candidate of candidates) {
    try {
      return { module: await import(candidate), from: candidate }
    } catch (error) {
      if (error?.code !== 'ERR_MODULE_NOT_FOUND' && error?.code !== 'ERR_UNSUPPORTED_DIR_IMPORT') {
        throw new Error(`cannot load ${candidate}: ${error.message}`, { cause: error })
      }
      // Absent rather than broken: try the next one; the report names what was tried.
    }
  }
  return { module: null, tried: candidates }
}

const appDirectory = desktopAppDirectory()
const schemastery = await loadPackage(SCHEMASTERY, (app) =>
  pathToFileURL(join(app, 'node_modules', ...SCHEMASTERY.split('/'), 'lib', 'index.mjs')).href,
)
if (schemastery.module === null) {
  console.log(`verify-settings-schema: skipped — ${SCHEMASTERY} not resolvable.`)
  console.log(`  tried: ${schemastery.tried.join(', ')}`)
  console.log('  run this inside a DSH profile, or pass --schemastery <path>.')
  process.exit(0)
}
// A dual build answers the namespace object under `require` and the constructor
// under `import`; `index.js` accepts both, and so does this script.
const z = schemastery.module.default ?? schemastery.module
/** The client's `rehydrate(serialized)` is `new Schema(serialized)` on its own copy. */
const Schema = z

const settings = await loadPackage(
  SETTINGS,
  (app) => pathToFileURL(join(app, 'node_modules', ...SETTINGS.split('/'), 'lib', 'index.js')).href,
)

const checks = []
/** Settlements of the checks whose subject is async, awaited before the report. */
const pending = []
const check = (name, run) => {
  const slot = checks.length
  const settle = (detail) => {
    checks[slot] = { name, ok: true, detail }
  }
  const fail = (error) => {
    checks[slot] = { name, ok: false, detail: error instanceof Error ? error.message : String(error) }
  }
  // Reserved up front so an awaited check keeps its place in the report.
  checks.push({ name, ok: false, detail: 'not run' })
  try {
    const detail = run()
    if (detail !== null && typeof detail?.then === 'function') {
      pending.push(detail.then(settle, fail))
      return
    }
    settle(detail)
  } catch (error) {
    fail(error)
  }
}
const skip = (name, detail) => checks.push({ name, ok: true, skipped: true, detail })
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const schema = settingsSchema(z, DEFAULTS)

/** Read the current value of a resolved Config field, live reference included. */
const live = (field) =>
  field !== null && typeof field === 'object' && Symbol.for('cosmokit.volatile.write') in field
    ? field.get()
    : field

//#region the schema and the envelope the browser rebuilds
check('the schema resolves an empty section to the composition defaults', () => {
  const resolved = normalizeSettings(schema({}))
  assert(JSON.stringify(resolved) === JSON.stringify(DEFAULTS), JSON.stringify(resolved))
  return JSON.stringify(resolved)
})

check('a user layer lands on top of the composition base', () => {
  const resolved = normalizeSettings(schema({ ...ROW, paths: ['~/shared'] }))
  assert(resolved.paths.length === 1 && resolved.paths[0] === '~/shared', JSON.stringify(resolved.paths))
  assert(resolved.maxBytes === DEFAULTS.maxBytes, 'the base layer must survive the user layer')
  return JSON.stringify(resolved.paths)
})

check('a non-array paths is rejected, so the page cannot store one', () => {
  try {
    schema({ paths: '~/shared' })
  } catch (error) {
    return error.message
  }
  throw new Error('a string was accepted for paths')
})

check('a non-number maxBytes is rejected', () => {
  try {
    schema({ maxBytes: 'lots' })
  } catch (error) {
    return error.message
  }
  throw new Error('a string was accepted for maxBytes')
})

check('defaults are cloned per resolve, so a consumer cannot mutate the schema', () => {
  const first = normalizeSettings(schema({}))
  first.paths.push('mutated')
  const second = normalizeSettings(schema({}))
  assert(second.paths.length === DEFAULTS.paths.length, JSON.stringify(second.paths))
  return `the second resolve is still ${JSON.stringify(second.paths)}`
})

check('paths is the one volatile field, so it is the one the page can edit', () => {
  assert(schema.dict.paths.meta.volatile === true, 'paths is not volatile: the entry would have no form')
  const others = Object.entries(schema.dict)
    .filter(([field]) => field !== 'paths')
    .filter(([, node]) => node.meta.volatile === true)
    .map(([field]) => field)
  assert(others.length === 0, `${others.join(', ')} would be claimed by the GUI`)
  return 'paths volatile, composition knobs untouched'
})

check('toJSON() is the { uid, refs } envelope the browser rebuilds from', () => {
  const serialized = schema.toJSON()
  assert(serialized !== null && typeof serialized === 'object', 'toJSON() did not return an object')
  assert(typeof serialized.uid === 'number', 'the envelope has no numeric uid')
  assert(serialized.refs !== null && typeof serialized.refs === 'object', 'the envelope has no refs')
  return `${JSON.stringify(serialized).length} bytes`
})

check('a rebuild from that envelope resolves and validates exactly the same', () => {
  const rebuilt = Schema(schema.toJSON())
  assert(
    JSON.stringify(normalizeSettings(rebuilt({}))) === JSON.stringify(DEFAULTS),
    'the rebuilt schema resolves differently',
  )
  assert(rebuilt({ paths: ['~/x'] }).paths !== undefined, 'the rebuilt schema rejected a valid value')
  return 'rebuilt, resolved and validated'
})
//#endregion

//#region the host seam: the real SettingsForms, over a fake configuration editor
/**
 * Drive the installed `SettingsForms` the way the profile does, with a
 * configuration editor standing in for the profile patch document.
 *
 * The class is instantiated through its prototype rather than through its
 * constructor: the constructor reaches for `configEditor`, `profileContext` and
 * the whole boot-time Loader, while `describe()` and `write()` only need the
 * three things set below — which is enough to run the REAL projection and write
 * paths rather than a copy of them.
 */
function settingsForms(entryId, configSchema, row) {
  const entry = {
    id: `include:${entryId}`,
    options: { id: entryId, config: row },
    inherited: row,
    override: undefined,
    fiber: {
      uid: 'verify-uid',
      runtime: { Config: configSchema },
      state: 2,
      config: configSchema(row),
      ctx: {},
    },
  }
  const editor = {
    written: undefined,
    configuration: () => [{ entry, inherited: row, override: undefined }],
    entries: () => [entry],
    async edit(target, change) {
      editor.written = change(target.options.config, row)
    },
  }
  const forms = Object.create(settings.module.default.prototype)
  forms.revisions = new Map()
  forms.presentations = new Map()
  forms.closed = true
  forms.scheduled = false
  forms.ownerContext = {
    configEditor: editor,
    emit: () => {},
    logger: { error: () => {} },
    fiber: { state: 2 },
  }
  return { forms, editor }
}

let servable = null
if (settings.module === null) {
  skip(
    'the installed SettingsForms serves this entry (dsh-settings not resolvable here)',
    `tried: ${settings.tried.join(', ')}`,
  )
} else {
  check('the installed SettingsForms serves this entry, with only paths editable', () => {
    const { forms } = settingsForms(SETTINGS_ENTRY_ID, schema, ROW)
    const descriptors = forms.describe()
    assert(descriptors.length === 1, `${descriptors.length} descriptors for this entry, expected 1`)
    const descriptor = descriptors[0]
    assert(descriptor.ns === SETTINGS_ENTRY_ID, `the descriptor is keyed by ${descriptor.ns}`)
    assert(
      JSON.stringify(Object.keys(descriptor.value ?? {})) === '["paths"]',
      `the form projects ${JSON.stringify(Object.keys(descriptor.value ?? {}))}, expected only paths`,
    )
    assert(
      JSON.stringify(descriptor.value.paths) === JSON.stringify(DEFAULTS.paths),
      `the form value is ${JSON.stringify(descriptor.value.paths)}`,
    )
    assert(typeof descriptor.revision === 'number', 'the descriptor carries no revision to fence writes with')
    servable = descriptor
    return `ns=${descriptor.ns} value=${JSON.stringify(descriptor.value)} revision=${descriptor.revision}`
  })

  check('the form the Host describes is one the browser can rebuild and validate', () => {
    assert(servable !== null, 'no descriptor to rebuild')
    const rebuilt = Schema(servable.schema)
    const value = rebuilt(servable.value)
    assert(
      JSON.stringify(value.paths) === JSON.stringify(DEFAULTS.paths),
      `the rebuilt form resolved ${JSON.stringify(value.paths)}`,
    )
    return `${JSON.stringify(servable.value).length} bytes of value, rebuilt`
  })

  check('a committed write keeps the composition-only fields and applies the new paths', async () => {
    assert(servable !== null, 'no descriptor to write against')
    const { forms, editor } = settingsForms(SETTINGS_ENTRY_ID, schema, ROW)
    forms.describe()
    await forms.update(SETTINGS_ENTRY_ID, { paths: ['~/shared'] })
    assert(editor.written !== undefined, 'the write never reached the profile patch')
    assert(
      JSON.stringify(editor.written.paths) === '["~/shared"]',
      `paths became ${JSON.stringify(editor.written.paths)}`,
    )
    assert(editor.written.maxBytes === ROW.maxBytes, 'maxBytes was dropped from the entry config')
    assert(
      editor.written.scanSubdirectories === ROW.scanSubdirectories,
      'scanSubdirectories was dropped from the entry config',
    )
    assert(
      normalizeSettings(schema(editor.written)).paths[0] === '~/shared',
      'the plugin does not see the committed value',
    )
    return JSON.stringify(editor.written)
  })
}
//#endregion

//#region the one coupling no compiler checks: the entry id
check('the entry id is a legal settings namespace', () => {
  assert(ENTRY_ID_PATTERN.test(SETTINGS_ENTRY_ID), `"${SETTINGS_ENTRY_ID}" is not legal`)
  return SETTINGS_ENTRY_ID
})

check('index.js, lib/client.js and cordis.patch.yml spell the same entry id', () => {
  const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  const clientId = /const ENTRY_ID = '([^']+)'/.exec(client)
  assert(clientId !== null, 'lib/client.js no longer declares ENTRY_ID the expected way')
  assert(
    clientId[1] === SETTINGS_ENTRY_ID,
    `lib/client.js reads "${clientId[1]}", index.js exports "${SETTINGS_ENTRY_ID}"`,
  )
  const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  const patchId = /^\s*- id: (\S+)\s*$/m.exec(patch)
  assert(patchId !== null, 'cordis.patch.yml no longer inserts a row the expected way')
  assert(
    patchId[1] === SETTINGS_ENTRY_ID,
    `cordis.patch.yml inserts "${patchId[1]}", index.js exports "${SETTINGS_ENTRY_ID}"`,
  )
  return `${SETTINGS_ENTRY_ID} in all three`
})
//#endregion

await Promise.all(pending)

console.log(`verify-settings-schema: schemastery from ${schemastery.from}`)
if (settings.module !== null) console.log(`verify-settings-schema: dsh-settings from ${settings.from}`)
if (appDirectory !== null) console.log(`verify-settings-schema: DSH app ${appDirectory}`)
let skipped = 0
for (const entry of checks) {
  if (entry.skipped === true) skipped += 1
  console.log(`  ${entry.skipped === true ? 'skip' : entry.ok ? 'ok  ' : 'FAIL'} ${entry.name}`)
  console.log(`       ${entry.detail}`)
}
const failed = checks.filter((entry) => entry.ok !== true)
if (failed.length > 0) {
  console.error(`verify-settings-schema: ${failed.length} of ${checks.length} checks failed`)
  process.exit(1)
}
console.log(
  `verify-settings-schema: all ${checks.length - skipped} checks passed` +
    (skipped > 0 ? ` (${skipped} skipped)` : ''),
)
