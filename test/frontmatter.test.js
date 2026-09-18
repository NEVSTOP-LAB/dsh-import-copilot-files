import assert from 'node:assert/strict'
import test from 'node:test'
import { parseBoolean, parseFrontmatter } from '../lib/frontmatter.js'

test('parseFrontmatter splits data from body', () => {
  const { data, body } = parseFrontmatter('---\napplyTo: "**/*.ts"\n---\n\nBody text.\n')
  assert.equal(data.applyTo, '**/*.ts')
  assert.equal(body.trim(), 'Body text.')
})

test('parseFrontmatter returns the whole file when there is no block', () => {
  const { data, body } = parseFrontmatter('# Title\n\n---\n\nAfter a rule.\n')
  assert.deepEqual(data, {})
  assert.match(body, /^# Title/)
})

test('parseFrontmatter reads a | block scalar', () => {
  const { data } = parseFrontmatter('---\ndescription: |\n  first line\n  second line\nname: x\n---\n')
  assert.equal(data.description, 'first line\nsecond line')
  assert.equal(data.name, 'x')
})

test('parseFrontmatter reads a > folded block scalar', () => {
  const { data } = parseFrontmatter('---\ndescription: >\n  one\n  two\n---\n')
  assert.equal(data.description, 'one two')
})

test('parseFrontmatter reads inline and dashed lists', () => {
  assert.deepEqual(parseFrontmatter('---\napplyTo: [a.ts, b.ts]\n---\n').data.applyTo, ['a.ts', 'b.ts'])
  assert.deepEqual(parseFrontmatter('---\ntags:\n  - one\n  - two\n---\n').data.tags, ['one', 'two'])
})

test('parseFrontmatter strips comments but not hashes inside quotes', () => {
  assert.equal(parseFrontmatter('---\ndescription: hello # trailing\n---\n').data.description, 'hello')
  assert.equal(parseFrontmatter('---\ndescription: "a # b"\n---\n').data.description, 'a # b')
})

test('parseFrontmatter unquotes scalars', () => {
  assert.equal(parseFrontmatter("---\nname: 'demo-skill'\n---\n").data.name, 'demo-skill')
})

test('parseBoolean accepts the documented spellings', () => {
  for (const value of ['true', 'TRUE', 'yes', 'on', '1']) assert.equal(parseBoolean(value), true)
  for (const value of ['false', 'no', 'off', '0']) assert.equal(parseBoolean(value), false)
  assert.equal(parseBoolean(true), true)
})

test('parseBoolean rejects anything else', () => {
  assert.equal(parseBoolean('maybe'), undefined)
  assert.equal(parseBoolean(''), undefined)
})
