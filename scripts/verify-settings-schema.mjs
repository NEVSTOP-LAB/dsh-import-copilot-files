#!/usr/bin/env node
/**
 * verify-settings-schema.mjs — prove the settings chain against the REAL
 * `@deepseek-ai/schemastery` that a DSH installation ships.
 *
 * The offline suite (`test/settings.test.js`) checks the schema's *shape* with a
 * recording stand-in, because a bare `@deepseek-ai/schemastery` import cannot
 * resolve in a bare checkout. That leaves the one assumption the card depends on
 * unchecked: that the schema the host registers is one the browser can REBUILD.
 * The client decodes a namespace by `new Schema(serialized)` over the `toJSON()`
 * envelope, and when that fails it publishes no value at all — silently. So this
 * script does what the service and the browser do, in order:
 *
 *   1. resolve the composition entry through the schema (defaults, user layer);
 *   2. reject values the card must never accept;
 *   3. serialize with `toJSON()` and rebuild from that envelope;
 *   4. confirm the two halves spell the same namespace.
 *
 * It needs a DSH installation, so it is NOT part of `npm run check`; it skips
 * (exit 0, with a note) when schemastery cannot be found, and fails loudly when
 * it can. See CONTRIBUTING §4.2.
 *
 * Usage:
 *   node scripts/verify-settings-schema.mjs
 *   node scripts/verify-settings-schema.mjs --schemastery <specifier-or-path>
 *   DSH_SCHEMASTERY=<specifier-or-path> node scripts/verify-settings-schema.mjs
 */

import { readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { SETTINGS_NAMESPACE } from '../index.js'
import { settingsSchema } from '../lib/settings.js'

/** The composition defaults the schema is built from; mirrors index.js. */
const DEFAULTS = {
  maxBytes: 65536,
  scanSubdirectories: 1,
  instructionDirs: ['.github/instructions'],
  skillDirs: ['.github/skills'],
  paths: [],
}

const NAMESPACE_PATTERN = /^[a-z][a-z0-9-]*$/
const PACKAGE = '@deepseek-ai/schemastery'

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
 * Where to load schemastery from: an explicit argument first, then the
 * environment, then a plain `import`, then the DSH Desktop install.
 *
 * Only a candidate that is genuinely ABSENT is skipped. A package that is
 * present but broken — a syntax error, a missing transitive module — throws,
 * because reporting "skipped, exit 0" there would be a green light over a real
 * failure.
 *
 * @returns `{ module, from }`, or `{ module: null, tried }` when nothing was found.
 */
async function resolveSchemastery() {
  const explicit = arg('schemastery') ?? process.env.DSH_SCHEMASTERY
  const candidates = []
  if (explicit !== undefined && explicit !== '') {
    candidates.push(toSpecifier(explicit))
  } else {
    candidates.push(PACKAGE)
    const localAppData = process.env.LOCALAPPDATA
    if (localAppData !== undefined && localAppData !== '') {
      candidates.push(
        pathToFileURL(
          join(
            localAppData,
            'Programs',
            'DSH Desktop',
            'resources',
            'app',
            'node_modules',
            ...PACKAGE.split('/'),
            'lib',
            'index.mjs',
          ),
        ).href,
      )
    }
  }
  for (const candidate of candidates) {
    try {
      return { module: await import(candidate), from: candidate }
    } catch (error) {
      if (error?.code !== 'ERR_MODULE_NOT_FOUND') {
        throw new Error(`cannot load ${candidate}: ${error.message}`, { cause: error })
      }
      // Absent rather than broken: try the next one; the report names what was tried.
    }
  }
  return { module: null, tried: candidates }
}

const { module, from, tried } = await resolveSchemastery()
if (module === null) {
  console.log(`verify-settings-schema: skipped — ${PACKAGE} not resolvable.`)
  console.log(`  tried: ${tried.join(', ')}`)
  console.log('  run this inside a DSH profile, or pass --schemastery <path>.')
  process.exit(0)
}

const z = module.default
/**
 * The client's `rehydrate(serialized)` is `new Schema(serialized)` on its own
 * vendored copy of the constructor this package default-exports.
 */
const Schema = z

const checks = []
const check = (name, run) => {
  try {
    const detail = run()
    checks.push({ name, ok: true, detail })
  } catch (error) {
    checks.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) })
  }
}
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const schema = settingsSchema(z, DEFAULTS)

check('the schema resolves an empty section to the composition defaults', () => {
  const resolved = schema({})
  assert(JSON.stringify(resolved) === JSON.stringify(DEFAULTS), JSON.stringify(resolved))
  return JSON.stringify(resolved)
})

check('a user layer lands on top of the composition base', () => {
  const resolved = schema({ ...DEFAULTS, paths: ['D:\\shared'] })
  assert(resolved.paths.length === 1 && resolved.paths[0] === 'D:\\shared', JSON.stringify(resolved.paths))
  assert(resolved.maxBytes === DEFAULTS.maxBytes, 'the base layer must survive the user layer')
  return JSON.stringify(resolved)
})

check('a non-array paths is rejected, so the card cannot store one', () => {
  try {
    schema({ paths: 'D:\\shared' })
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
  const first = schema({})
  first.paths.push('mutated')
  const second = schema({})
  assert(second.paths.length === 0, JSON.stringify(second.paths))
  return 'the second resolve is still empty'
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
    JSON.stringify(rebuilt({})) === JSON.stringify(schema({})),
    'the rebuilt schema resolves differently',
  )
  assert(rebuilt({ paths: ['D:\\x'] }).paths[0] === 'D:\\x', 'the rebuilt schema rejected a valid value')
  return 'rebuilt, resolved and validated'
})

check('the namespace is a legal settings namespace', () => {
  assert(NAMESPACE_PATTERN.test(SETTINGS_NAMESPACE), `"${SETTINGS_NAMESPACE}" is not legal`)
  return SETTINGS_NAMESPACE
})

check('both halves spell the same namespace, which is the card s slot key', () => {
  // The one coupling no compiler checks: the host registers the namespace, and
  // the browser card claims `settings.plugin.item` under it. A mismatch renders
  // no card and reports nothing.
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  const match = /const NAMESPACE = '([^']+)'/.exec(source)
  assert(match !== null, 'lib/client.js no longer declares NAMESPACE the expected way')
  assert(
    match[1] === SETTINGS_NAMESPACE,
    `lib/client.js uses "${match[1]}", index.js registers "${SETTINGS_NAMESPACE}"`,
  )
  return `${SETTINGS_NAMESPACE} (index.js) === ${match[1]} (lib/client.js)`
})

console.log(`verify-settings-schema: schemastery from ${from}`)
for (const entry of checks) {
  console.log(`  ${entry.ok ? 'ok  ' : 'FAIL'} ${entry.name}`)
  console.log(`       ${entry.detail}`)
}
const failed = checks.filter((entry) => !entry.ok)
if (failed.length > 0) {
  console.error(`verify-settings-schema: ${failed.length} of ${checks.length} checks failed`)
  process.exit(1)
}
console.log(`verify-settings-schema: all ${checks.length} checks passed`)
