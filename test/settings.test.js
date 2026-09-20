/**
 * The settings seam: namespace wiring and the schema handed to the service.
 *
 * The real `@deepseek-ai/schemastery` only exists inside a DSH profile, so the
 * loader is injected here. That pins the two things this plugin owns — the
 * namespace name the browser card is keyed by, and the hooks contract — while
 * the schema's own shape is checked against a recording stand-in below.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import plugin, {
  SETTINGS_DEFAULTS,
  SETTINGS_NAMESPACE,
  attachSettings,
  normalizeSettings,
} from '../index.js'
import { settingsSchema } from '../lib/settings.js'

/** A schemastery stand-in that records what the schema asked for. */
function recordingZ() {
  const calls = []
  const leaf = (kind) => {
    const node = { kind, defaults: [] }
    node.default = (value) => {
      node.defaults.push(value)
      return node
    }
    calls.push(node)
    return node
  }
  const z = {
    object(dict) {
      const node = { kind: 'object', dict }
      calls.push(node)
      return node
    },
    number: () => leaf('number'),
    string: () => leaf('string'),
    array: (inner) => {
      const node = { kind: 'array', inner, defaults: [] }
      node.default = (value) => {
        node.defaults.push(value)
        return node
      }
      calls.push(node)
      return node
    },
  }
  return { z, calls }
}

/** A context whose `inject` behaves like the loader's: it runs the callback at once. */
function fakeCtx({ withInject = true } = {}) {
  const effects = []
  const installed = []
  const errors = []
  const ctx = {
    settings: {
      installSection(owner, ns, schema, entry, hooks) {
        installed.push({ owner, ns, schema, entry, hooks })
      },
    },
    effect(callback, label) {
      effects.push({ dispose: callback(), label })
      return () => {}
    },
  }
  if (withInject) {
    ctx.inject = (services, callback) => {
      assert.deepEqual(services, ['settings'])
      callback(ctx)
    }
  }
  return { ctx, installed, effects, errors }
}

const flush = () => new Promise((resolve) => setImmediate(resolve))

test('the namespace is the name the browser card is keyed by', () => {
  assert.equal(SETTINGS_NAMESPACE, 'import-vscode-ai-files')
  assert.equal(plugin.name, 'import-vscode-ai-files')
})

test('the plugin keeps its static service list to the one it cannot work without', () => {
  assert.deepEqual(plugin.inject, ['skills'])
})

test('settings is an optional service, wired through ctx.inject', async () => {
  const { ctx, installed } = fakeCtx()
  let source = () => ({ paths: ['from-composition'] })
  attachSettings(ctx, {
    entry: { paths: ['from-composition'] },
    onSource: (next) => {
      source = next
    },
    loadSchema: async () => 'SCHEMA',
  })
  await flush()

  assert.equal(installed.length, 1)
  const call = installed[0]
  assert.equal(call.ns, SETTINGS_NAMESPACE)
  assert.equal(call.schema, 'SCHEMA')
  assert.deepEqual(call.entry, { paths: ['from-composition'] })

  // `setSource` hands over a getter, and the plugin reads through it.
  call.hooks.setSource(() => ({ paths: ['from-settings'] }))
  assert.deepEqual(source().paths, ['from-settings'])

  // Losing the provider must fall back to the composition entry.
  call.hooks.setSource(() => ({ paths: ['from-composition'] }))
  assert.deepEqual(source().paths, ['from-composition'])
  assert.equal(typeof call.hooks.onChange, 'function')
  assert.doesNotThrow(() => call.hooks.onChange())
})

test('a context with no inject still mounts the plugin', () => {
  const { ctx, installed } = fakeCtx({ withInject: false })
  assert.doesNotThrow(() => attachSettings(ctx, { entry: {}, onSource: () => {} }))
  assert.equal(installed.length, 0)
})

test('a schema that cannot be loaded is reported and changes nothing', async () => {
  const { ctx, installed } = fakeCtx()
  const reported = []
  const original = console.error
  console.error = (...args) => reported.push(args)
  try {
    attachSettings(ctx, {
      entry: {},
      onSource: () => {
        throw new Error('onSource must not be called')
      },
      loadSchema: async () => {
        throw new Error('schemastery is not installed')
      },
    })
    await flush()
  } finally {
    console.error = original
  }
  assert.equal(installed.length, 0)
  assert.equal(reported.length, 1)
  assert.match(String(reported[0][0]), /settings namespace not registered/)
})

test('a disposed mount does not register its namespace late', async () => {
  const { ctx, installed, effects } = fakeCtx()
  let resolveSchema = null
  attachSettings(ctx, {
    entry: {},
    onSource: () => {},
    loadSchema: () =>
      new Promise((resolve) => {
        resolveSchema = resolve
      }),
  })
  await flush()
  for (const effect of effects) effect.dispose()
  resolveSchema('SCHEMA')
  await flush()
  assert.equal(installed.length, 0)
})

test('the schema covers exactly the row config, with the composition defaults', () => {
  const { z, calls } = recordingZ()
  const schema = settingsSchema(z, SETTINGS_DEFAULTS)
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
  assert.equal(calls.length > 0, true)
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
})
