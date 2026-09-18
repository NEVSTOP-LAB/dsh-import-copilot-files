/**
 * Minimal glob → RegExp for VSCode `applyTo` patterns.
 *
 * Supported: `**` (any depth), `*` (within one segment), `?`, `{a,b}`,
 * `[abc]` / `[!abc]`. Patterns are matched against a root-relative POSIX path.
 *
 * Deliberately dependency-free: a locally authored agent preset lives under the
 * user's home, where Node's upward `node_modules` walk never reaches the
 * harness's own dependencies, so nothing here may import a third-party package.
 *
 * Matching follows minimatch's default (no `matchBase`): `*.ts` matches only a
 * top-level `.ts`, while `**\/*.ts` matches at any depth — the same rule VSCode
 * documents for `applyTo`.
 */

const REGEXP_CACHE = new Map()

/** Characters that carry meaning in a RegExp and must be escaped when literal. */
const REGEXP_SPECIAL = new Set(['.', '+', '^', '$', '(', ')', '|', '\\', '[', ']', '{', '}'])

/**
 * Compile one glob into an anchored, case-insensitive RegExp.
 * @param pattern - one glob, already trimmed.
 * @returns the compiled pattern; results are cached per pattern string.
 */
export function globToRegExp(pattern) {
  let compiled = REGEXP_CACHE.get(pattern)
  if (compiled === undefined) {
    compiled = new RegExp(`^${translate(pattern)}$`, 'i')
    REGEXP_CACHE.set(pattern, compiled)
  }
  return compiled
}

/** Translate a glob body into a RegExp source fragment (no anchors). */
function translate(pattern) {
  let out = ''
  let index = 0
  while (index < pattern.length) {
    const char = pattern[index]

    if (char === '*') {
      if (pattern[index + 1] === '*') {
        index += 2
        // `**/` also matches zero directories, so `**/a.ts` matches `a.ts`.
        if (pattern[index] === '/') {
          index += 1
          out += '(?:[^/]*/)*'
        } else {
          out += '.*'
        }
      } else {
        index += 1
        out += '[^/]*'
      }
      continue
    }

    if (char === '?') {
      index += 1
      out += '[^/]'
      continue
    }

    if (char === '{') {
      const end = pattern.indexOf('}', index + 1)
      if (end > index) {
        const alternatives = pattern.slice(index + 1, end).split(',')
        out += `(?:${alternatives.map(translate).join('|')})`
        index = end + 1
        continue
      }
    }

    if (char === '[') {
      const end = pattern.indexOf(']', index + 1)
      if (end > index) {
        let body = pattern.slice(index + 1, end)
        if (body.startsWith('!')) body = `^${body.slice(1)}`
        out += `[${body}]`
        index = end + 1
        continue
      }
    }

    out += REGEXP_SPECIAL.has(char) ? `\\${char}` : char
    index += 1
  }
  return out
}

/**
 * Read a VSCode `applyTo` value.
 * VSCode writes a comma-separated list of globs; absent or empty means "always",
 * which callers represent as `null`.
 * @param raw - the frontmatter value, whatever type it parsed as.
 * @returns the glob list, or `null` for "always applies".
 */
export function parseApplyTo(raw) {
  if (raw === undefined || raw === null) return null
  const text = String(raw).trim()
  if (text === '') return null
  const patterns = splitPatterns(text)
    .map((part) => part.trim())
    .filter((part) => part !== '')
  return patterns.length === 0 ? null : patterns
}

/**
 * Split on the commas that separate patterns, not on the ones inside `{a,b}`.
 * A naive `split(',')` turns `**\/*.{ts,tsx}` into two broken halves, which is
 * the single most common `applyTo` spelling in the wild.
 */
function splitPatterns(text) {
  const parts = []
  let depth = 0
  let start = 0
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '{' || char === '[') depth += 1
    else if (char === '}' || char === ']') depth = Math.max(0, depth - 1)
    else if (char === ',' && depth === 0) {
      parts.push(text.slice(start, index))
      start = index + 1
    }
  }
  parts.push(text.slice(start))
  return parts
}

/**
 * Match one root-relative path against a glob list.
 * @param relativePath - path relative to the instruction's own project root.
 * @param patterns - the parsed `applyTo` list, or `null` for "always".
 * @returns whether the path is covered.
 */
export function matchesAny(relativePath, patterns) {
  if (patterns === null || patterns.length === 0) return true
  const path = relativePath.replace(/\\/g, '/')
  return patterns.some((pattern) => globToRegExp(pattern).test(path))
}
