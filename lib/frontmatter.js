/**
 * Minimal YAML frontmatter reader for VSCode instruction and skill files.
 *
 * Covers the subset those files actually use: `key: value`, quoted scalars,
 * inline `[a, b]` lists, `- item` lists, and `|` / `>` block scalars. It is not
 * a YAML parser and does not try to be — nested maps are not modelled.
 *
 * Dependency-free for the same reason as glob.js: a locally authored preset
 * cannot reach the harness's `node_modules`.
 */

const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/
const KEY_VALUE = /^([A-Za-z0-9_][A-Za-z0-9_.-]*)[ \t]*:[ \t]*(.*)$/
const LIST_ITEM = /^[ \t]*-[ \t]+(.*)$/
const BLOCK_SCALAR = /^[|>][+-]?[ \t]*$/

const TRUE_VALUES = new Set(['true', 'yes', 'on', '1'])
const FALSE_VALUES = new Set(['false', 'no', 'off', '0'])

/**
 * Split a Markdown document into its frontmatter data and its body.
 * @param text - the whole file.
 * @returns `data` (parsed keys) and `body` (everything after the frontmatter).
 */
export function parseFrontmatter(text) {
  const source = text.replace(/^\uFEFF/, '')
  const match = FRONTMATTER.exec(source)
  if (match === null) return { data: {}, body: source }
  return { data: parseBlock(match[1]), body: source.slice(match[0].length) }
}

/**
 * Parse a YAML boolean with the same strictness the skill registry applies to
 * `disable-model-invocation` and `user-invocable`.
 * @param value - the frontmatter value.
 * @returns the boolean, or `undefined` when the spelling is not recognised.
 */
export function parseBoolean(value) {
  if (typeof value === 'boolean') return value
  const text = String(value).trim().toLowerCase()
  if (TRUE_VALUES.has(text)) return true
  if (FALSE_VALUES.has(text)) return false
  return undefined
}

function parseBlock(block) {
  const data = {}
  const lines = block.split(/\r?\n/)
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    index += 1
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue

    const entry = KEY_VALUE.exec(line)
    if (entry === null) continue
    const key = entry[1]
    const raw = entry[2]

    if (raw === '') {
      const items = []
      while (index < lines.length) {
        const item = LIST_ITEM.exec(lines[index])
        if (item === null) break
        items.push(unquote(stripComment(item[1]).trim()))
        index += 1
      }
      data[key] = items.length > 0 ? items : ''
      continue
    }

    if (BLOCK_SCALAR.test(raw)) {
      const folded = raw.startsWith('>')
      const collected = []
      while (index < lines.length) {
        const next = lines[index]
        if (next.trim() !== '' && !/^[ \t]/.test(next)) break
        collected.push(next.replace(/^[ \t]+/, ''))
        index += 1
      }
      while (collected.length > 0 && collected[collected.length - 1] === '') collected.pop()
      data[key] = folded ? collected.join(' ').trim() : collected.join('\n')
      continue
    }

    data[key] = parseScalar(raw)
  }

  return data
}

function parseScalar(raw) {
  const text = stripComment(raw).trim()
  if (text.startsWith('[') && text.endsWith(']')) {
    return text
      .slice(1, -1)
      .split(',')
      .map((part) => unquote(part.trim()))
      .filter((part) => part !== '')
  }
  return unquote(text)
}

/** Drop a trailing `# comment`, ignoring `#` inside quotes. */
function stripComment(value) {
  let quote = null
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (quote !== null) {
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '#' && (index === 0 || value[index - 1] === ' ' || value[index - 1] === '\t')) {
      return value.slice(0, index)
    }
  }
  return value
}

function unquote(value) {
  if (value.length < 2) return value
  const quote = value[0]
  if ((quote === '"' || quote === "'") && value[value.length - 1] === quote) {
    return value.slice(1, -1)
  }
  return value
}
