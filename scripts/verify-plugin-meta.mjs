#!/usr/bin/env node
/**
 * verify-plugin-meta.mjs — prove the installed DSH reads this plugin's display
 * metadata: the title and one-liner on its plugin row, and the icon next to them.
 *
 * The Plugin Manager renders those from the manifest **without activating the
 * plugin**, through `readPluginMeta` in `dsh-app-boot`. That reader resolves
 * `<package>/locale/en.json` and its siblings as exported subpaths, decodes the
 * `icon` file into a `data:` URL, and answers an `error` field instead when the
 * icon is unusable — while still returning the text. None of that is visible in
 * a checkout: the file can exist and be spelled wrongly in `exports` or `files`,
 * and the row silently falls back to the panel's default artwork.
 *
 * So this script calls the installed reader on this package and checks what a
 * row would receive. It needs a DSH installation, so it is NOT part of
 * `npm run check`; it skips (exit 0, with a note) when the reader cannot be
 * found, and fails loudly when it can. See docs/development.md §5.
 *
 * Usage:
 *   node scripts/verify-plugin-meta.mjs
 *   node scripts/verify-plugin-meta.mjs --dsh-app <resources/app dir>
 *   DSH_APP=<resources/app dir> node scripts/verify-plugin-meta.mjs
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const MANIFEST = new URL('../package.json', import.meta.url)
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))

function arg(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

/** The `resources/app` directory of a DSH Desktop installation, if there is one. */
function desktopAppDirectory() {
  const explicit = arg('dsh-app') ?? process.env.DSH_APP
  if (explicit !== undefined && explicit !== '') return explicit
  const localAppData = process.env.LOCALAPPDATA
  if (localAppData === undefined || localAppData === '') return null
  return join(localAppData, 'Programs', 'DSH Desktop', 'resources', 'app')
}

const app = desktopAppDirectory()
const candidates = []
if (app !== null) {
  candidates.push(pathToFileURL(join(app, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js')).href)
}

let boot = null
let from = null
for (const candidate of candidates) {
  try {
    boot = await import(candidate)
    from = candidate
    break
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND' && error?.code !== 'ERR_UNSUPPORTED_DIR_IMPORT') {
      throw new Error(`cannot load ${candidate}: ${error.message}`, { cause: error })
    }
  }
}
if (boot === null || typeof boot.readPluginMeta !== 'function') {
  console.log('verify-plugin-meta: skipped — the DSH display-metadata reader is not resolvable.')
  console.log(`  tried: ${candidates.length === 0 ? '(no DSH app directory)' : candidates.join(', ')}`)
  console.log('  pass --dsh-app <resources/app>.')
  process.exit(0)
}

const checks = []
const check = (name, run) => {
  try {
    checks.push({ name, ok: true, detail: run() })
  } catch (error) {
    checks.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) })
  }
}
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

/** One language's title and description, as the row renders them. */
const text = (value, language) => {
  assert(value !== null && typeof value === 'object', `the reader answered ${JSON.stringify(value)}`)
  assert(typeof value[language] === 'string', `no ${language} text`)
  assert(value[language].trim() !== '', `the ${language} text is empty`)
  return value[language]
}

const meta = boot.readPluginMeta(manifest.name, MANIFEST.href)

check('the installed reader resolves this package without an error', () => {
  assert(meta !== undefined, 'the reader answered nothing for this package name')
  assert(meta.error === undefined, meta.error)
  return 'no diagnostic'
})

check('the row title and one-liner come from the locale dictionaries', () => {
  for (const language of ['en', 'zh']) {
    const file = JSON.parse(readFileSync(new URL(`../locale/${language}.json`, import.meta.url), 'utf8'))
    assert(text(meta.title, language) === file.meta.title, `the ${language} title is not the dictionary's`)
    assert(
      text(meta.description, language) === file.meta.description,
      `the ${language} one-liner is not the dictionary's`,
    )
  }
  return `${meta.title.en} / ${meta.title.zh}`
})

check('the icon decodes into a data URL the page can render', () => {
  assert(typeof meta.icon === 'string', 'the row would fall back to the default artwork')
  assert(meta.icon.startsWith('data:image/svg+xml;base64,'), `the icon is ${meta.icon.slice(0, 40)}`)
  const bytes = Buffer.from(meta.icon.slice('data:image/svg+xml;base64,'.length), 'base64')
  assert(bytes.length > 0, 'the decoded icon is empty')
  assert(bytes.toString('utf8').trimStart().startsWith('<svg'), 'the decoded icon is not an SVG document')
  assert(bytes.length <= 256 * 1024, 'the decoded icon exceeds 256 KiB')
  return `${bytes.length} bytes, ${manifest.icon}`
})

let failed = 0
console.log(`verify-plugin-meta: reader from ${from}`)
for (const entry of checks) {
  if (entry.ok !== true) failed += 1
  console.log(`  ${entry.ok === true ? 'ok  ' : 'FAIL'} ${entry.name}`)
  console.log(`       ${entry.detail}`)
}
if (failed > 0) {
  console.error(`verify-plugin-meta: ${failed} of ${checks.length} checks failed`)
  process.exit(1)
}
console.log(`verify-plugin-meta: all ${checks.length} checks passed`)
