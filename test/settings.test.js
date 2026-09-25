/**
 * The settings seam: the `Config` schema that IS this plugin's settings
 * document, and the volatile references a committed change arrives through.
 *
 * The real `@deepseek-ai/schemastery` only exists inside a DSH profile, so the
 * schema's shape is checked against a recording stand-in here, and
 * `scripts/verify-settings-schema.mjs` re-runs the whole chain against the real
 * package when a DSH installation is present.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import plugin, {
  SETTINGS_DEFAULTS,
  SETTINGS_ENTRY_ID,
  configSchemaFor,
  normalizeSettings,
} from '../index.js'

/** The protocol `createVolatile` writes; reproduced to build a live field. */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/**
 * A schemastery stand-in that records what the schema asked for.
 *
 * `meta.volatile` is the shape `dsh-settings` actually reads (`volatileForm`,
 * `isVolatilePath`), so the stand-in mirrors that rather than inventing one.
 */
function recordingZ() {
  const calls = []
  const leaf = (kind) => {
    const node = { kind, meta: {}, defaults: [] }
    node.default = (value) => {
      node.defaults.push(value)
      return node
    }
    node.volatile = () => {
      node.meta.volatile = true
      calls.push({ kind: 'volatile', field: node })
      return node
    }
    calls.push(node)
    return node
  }
  const z = {
    object(dict) {
      const node = { kind: 'object', dict, meta: {} }
      calls.push(node)
      return node
    },
    number: () => leaf('number'),
    string: () => leaf('string'),
    array: (inner) => {
      const node = { kind: 'array', inner, meta: {}, defaults: [] }
      node.default = (value) => {
        node.defaults.push(value)
        return node
      }
      node.volatile = () => {
        node.meta.volatile = true
        calls.push({ kind: 'volatile', field: node })
        return node
      }
      calls.push(node)
      return node
    },
  }
  return { z, calls }
}

/** One live Config field, exactly as `z…volatile()` resolves one. */
function volatileField(value) {
  return Object.freeze({ get: () => value, [VOLATILE_WRITE]: () => {} })
}

test('the entry id is the settings namespace the browser card is keyed by', () => {
  assert.equal(SETTINGS_ENTRY_ID, 'dsh-import-copilot-files')
  // The plugin's own id — the GUI's `source.plugin` label — is a different
  // string and must stay that way: the entry id names the Loader row.
  assert.equal(plugin.name, 'import-copilot-files')
})

test('the plugin keeps its static service list to the one it cannot work without', () => {
  // A name in this list that no client or host provides parks the fiber for
  // ever, which the client boot reports as a failed plugin. The settings seam is
  // a schema now, not a service, so nothing about it belongs here.
  assert.deepEqual(plugin.inject, ['skills'])
})

test('the schema covers exactly the row config, with the composition defaults', () => {
  const { z } = recordingZ()
  const schema = configSchemaFor(z)
  assert.equal(schema.kind, 'object')
  assert.deepEqual(
    Object.keys(schema.dict),
    ['maxBytes', 'scanSubdirectories', 'instructionDirs', 'skillDirs', 'paths'],
  )
  assert.deepEqual(schema.dict.maxBytes.defaults, [65536])
  assert.deepEqual(schema.dict.scanSubdirectories.defaults, [1])
  assert.deepEqual(schema.dict.instructionDirs.defaults, [['.github/instructions']])
  assert.deepEqual(schema.dict.skillDirs.defaults, [['.github/skills']])
  assert.deepEqual(schema.dict.paths.defaults, [['~/.copilot']])
  assert.deepEqual(schema.dict.paths.kind, 'array')
  assert.deepEqual(schema.dict.paths.inner.kind, 'string')
})

test('paths is the only volatile field, because it is the only editable one', () => {
  // `dsh-settings` projects the form from the volatile fields alone: mark one
  // more and the GUI starts claiming a composition-only knob, mark none and the
  // entry has no form at all, so the browser card never registers.
  const { z, calls } = recordingZ()
  const schema = configSchemaFor(z)
  assert.equal(schema.dict.paths.meta.volatile, true)
  for (const field of ['maxBytes', 'scanSubdirectories', 'instructionDirs', 'skillDirs']) {
    assert.notEqual(schema.dict[field].meta.volatile, true, `${field} must stay composition-only`)
  }
  assert.equal(calls.filter((call) => call.kind === 'volatile').length, 1)
})

test('Config is a real schema when schemastery resolves, and absent when it does not', () => {
  // Either branch is a supported deployment: without the package the entry has
  // no form and the GUI card is simply missing, while the plugin itself runs on
  // its composition config. What must never happen is a THROW from this getter:
  // Cordis reads it while composing the row, so an exception there takes the
  // whole entry down.
  const reported = []
  const original = console.error
  console.error = (...args) => reported.push(args)
  let schema
  try {
    schema = plugin.Config
  } finally {
    console.error = original
  }
  if (schema === undefined) {
    assert.equal(reported.length, 1, 'an unresolvable schemastery must be reported once')
    assert.match(String(reported[0][0]), /not resolvable/)
  } else {
    assert.equal(typeof schema.toJSON, 'function', 'Config must be rebuildable by the browser')
    assert.equal(reported.length, 0)
  }
  // Memoized: a second read answers the same thing without a second report.
  assert.equal(plugin.Config, schema)
})

test('the composition defaults start at the user-level .copilot directory', () => {
  assert.deepEqual(SETTINGS_DEFAULTS, {
    maxBytes: 65536,
    scanSubdirectories: 1,
    instructionDirs: ['.github/instructions'],
    skillDirs: ['.github/skills'],
    paths: ['~/.copilot'],
  })
})

test('normalizeSettings reads through a live field, so a commit is visible at once', () => {
  // A volatile field resolves to a reference, not to a value: reading it once
  // and caching the result is exactly the bug that would freeze `paths` at
  // whatever the composition said.
  const config = {
    maxBytes: 131072,
    scanSubdirectories: 0,
    instructionDirs: volatileField(['.github/instructions']),
    skillDirs: volatileField(['.github/skills']),
    paths: volatileField(['D:\\shared']),
  }
  assert.equal(normalizeSettings(config).maxBytes, 131072)
  assert.deepEqual(normalizeSettings(config).paths, ['D:\\shared'])
  // The reference itself is what changes; the config object is never rebuilt.
  config.paths = volatileField(['D:\\other'])
  assert.deepEqual(normalizeSettings(config).paths, ['D:\\other'])
})

test('normalizeSettings fills the documented defaults and drops unusable paths', () => {
  assert.deepEqual(normalizeSettings(undefined), {
    maxBytes: 65536,
    scanSubdirectories: 1,
    instructionDirs: ['.github/instructions'],
    skillDirs: ['.github/skills'],
    paths: ['~/.copilot'],
  })
  assert.deepEqual(normalizeSettings({ paths: ['D:\\shared', '', '  ', 42, null] }).paths, [
    'D:\\shared',
  ])
  // An empty list is a value, not an absence: it is how a user opts out of the
  // default entry in the card.
  assert.deepEqual(normalizeSettings({ paths: [] }).paths, [])
  assert.deepEqual(normalizeSettings({ instructionDirs: [] }).instructionDirs, [])
  assert.deepEqual(normalizeSettings({ skillDirs: 'nope' }).skillDirs, ['.github/skills'])
  assert.equal(normalizeSettings({ maxBytes: -1 }).maxBytes, 65536)
  assert.equal(normalizeSettings({ scanSubdirectories: 3 }).scanSubdirectories, 3)
  // A plain value and a live field are both acceptable, so a deployment whose
  // schema never resolved still reads its composition config.
  assert.deepEqual(normalizeSettings({ paths: ['plain'] }).paths, ['plain'])
})

test('normalizeSettings returns an isolated paths array for defaults', () => {
  const first = normalizeSettings(undefined)
  first.paths.push('mutated')
  assert.deepEqual(normalizeSettings(undefined).paths, ['~/.copilot'])
})
