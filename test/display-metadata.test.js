/**
 * The manifest's display metadata: what the Plugin Manager puts on this
 * plugin's row and card **without activating it**.
 *
 * The host reader is `readPluginMeta` in `dsh-app-boot`, and it takes:
 *
 * - the icon from a top-level `icon` in `package.json` — a path relative to the
 *   manifest, SVG / PNG / JPEG / WebP, at most 256 KiB, still inside the package
 *   directory after realpath resolution; the bytes are handed to the page as a
 *   `data:` URL;
 * - the title and one-liner from `<package>/locale/en.json` and its siblings,
 *   each `{ "meta": { "title": …, "description": … } }`, reached as an exported
 *   subpath — which is why the manifest declares `./locale/*.json`.
 *
 * A missing or unusable icon keeps the panel's default artwork; missing text
 * falls back to the manifest's own `name` / `description`. `files` has to carry
 * both, or `npm pack` leaves them out of the tarball.
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

/** The extensions the host accepts for `icon`, and its raw byte ceiling. */
const ICON_TYPES = new Map([
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
])
const MAX_ICON_BYTES = 256 * 1024

/** One `const <language> = { … }` copy block from the browser half. */
function cardCopy(language) {
  const client = readFileSync(resolve(root, 'lib', 'client.js'), 'utf8')
  const marker = `const ${language} = {`
  const start = client.indexOf(marker)
  assert.notEqual(start, -1, `lib/client.js no longer declares ${JSON.stringify(marker)}`)
  const end = client.indexOf('\n    }', start)
  assert.notEqual(end, -1, `lib/client.js: the ${language} dictionary is unterminated`)
  const block = client.slice(start, end)
  const field = (name) => {
    const match = new RegExp(`${name}: '([^']*)'`).exec(block)
    assert.notEqual(match, null, `the ${language} dictionary has no ${name}`)
    return match[1]
  }
  return { title: field('title'), description: field('description') }
}

test('the manifest declares an icon the host reader accepts', () => {
  const icon = manifest.icon
  assert.equal(typeof icon, 'string', 'package.json has no icon')
  assert.notEqual(icon.trim(), '', 'the icon path is empty')
  assert.equal(
    isAbsolute(icon) || /^[A-Za-z][A-Za-z\d+.-]*:/u.test(icon),
    false,
    `the icon must be a relative file path: ${icon}`,
  )
  assert.equal(
    ICON_TYPES.has(extname(icon).toLowerCase()),
    true,
    `the icon must be SVG, PNG, JPEG or WebP: ${icon}`,
  )
  const file = resolve(root, icon)
  assert.equal(existsSync(file), true, `${icon} does not exist`)
  assert.equal(statSync(file).isFile(), true, `${icon} is not a regular file`)
  const local = relative(root, file)
  assert.equal(
    local === '..' || local.startsWith('..') || isAbsolute(local),
    false,
    `the icon must stay inside the package directory: ${icon}`,
  )
  assert.equal(statSync(file).size <= MAX_ICON_BYTES, true, `${icon} exceeds 256 KiB`)
})

test('the icon is a self-contained SVG the page can render from a data URL', () => {
  const svg = readFileSync(resolve(root, manifest.icon), 'utf8')
  // The page receives the bytes base64-encoded inside a `data:` URL, so this is
  // decoded as a standalone image document: every reference must be internal.
  assert.match(svg, /<svg[^>]*\sviewBox="/u, 'the icon has no viewBox')
  assert.match(svg, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/u, 'the icon has no SVG namespace')
  assert.equal(/<script/iu.test(svg), false, 'the icon must not carry script')
  assert.equal(/<image\b/iu.test(svg), false, 'the icon must not embed a raster image')
  assert.equal(
    /(?:href|src)\s*=\s*"(?!#)/u.test(svg),
    false,
    'the icon must not reference an external file',
  )
})

test('the packaged files carry the icon and the locale dictionaries', () => {
  // `npm pack` ships exactly `files` (plus package.json, README and LICENSE).
  assert.equal(manifest.files.includes('icon.svg'), true, 'files does not carry icon.svg')
  assert.equal(manifest.files.includes('locale/*.json'), true, 'files does not carry locale/*.json')
  assert.equal(
    manifest.exports['./locale/*.json'],
    './locale/*.json',
    'the host resolves <package>/locale/en.json, so that subpath has to be exported',
  )
  assert.equal(manifest.exports['./package.json'], './package.json')
})

test('each locale dictionary carries the title and one-liner the card shows', () => {
  for (const language of ['en', 'zh']) {
    const file = resolve(root, 'locale', `${language}.json`)
    assert.equal(existsSync(file), true, `locale/${language}.json is missing`)
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(typeof parsed.meta, 'object', `locale/${language}.json has no meta object`)
    for (const field of ['title', 'description']) {
      assert.equal(typeof parsed.meta[field], 'string', `locale/${language}.json has no meta.${field}`)
      assert.notEqual(parsed.meta[field].trim(), '', `locale/${language}.json meta.${field} is empty`)
    }
  }
})

test('the plugin page title and one-liner are the same text the card draws', () => {
  // Three places carry this copy: the locale dictionaries the Plugin Manager
  // reads, and the browser half's own two dictionaries. The card must not be
  // titled differently from the row that opens it.
  for (const language of ['en', 'zh']) {
    const dictionary = JSON.parse(readFileSync(resolve(root, 'locale', `${language}.json`), 'utf8'))
    const card = cardCopy(language)
    assert.equal(card.title, dictionary.meta.title, `the ${language} title drifted`)
    assert.equal(card.description, dictionary.meta.description, `the ${language} one-liner drifted`)
  }
})
