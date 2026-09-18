import assert from 'node:assert/strict'
import test from 'node:test'
import { globToRegExp, matchesAny, parseApplyTo } from '../src/glob.js'

test('globToRegExp treats ** as any depth', () => {
  assert.equal(globToRegExp('**/*.ts').test('a.ts'), true)
  assert.equal(globToRegExp('**/*.ts').test('src/deep/a.ts'), true)
  assert.equal(globToRegExp('**/*.ts').test('a.tsx'), false)
})

test('globToRegExp keeps * inside one segment', () => {
  assert.equal(globToRegExp('src/*.ts').test('src/a.ts'), true)
  assert.equal(globToRegExp('src/*.ts').test('src/deep/a.ts'), false)
})

test('globToRegExp is anchored at both ends', () => {
  assert.equal(globToRegExp('*.ts').test('a.ts'), true)
  assert.equal(globToRegExp('*.ts').test('a.ts.bak'), false)
})

test('globToRegExp supports braces, classes and ?', () => {
  assert.equal(matchesAny('a.ts', parseApplyTo('**/*.{ts,tsx}')), true)
  assert.equal(matchesAny('a.tsx', parseApplyTo('**/*.{ts,tsx}')), true)
  assert.equal(matchesAny('a.js', parseApplyTo('**/*.{ts,tsx}')), false)
  assert.equal(matchesAny('a1.ts', parseApplyTo('a[0-9].ts')), true)
  assert.equal(matchesAny('ab.ts', parseApplyTo('a?.ts')), true)
  assert.equal(matchesAny('abc.ts', parseApplyTo('a?.ts')), false)
})

test('globToRegExp escapes literal dots', () => {
  assert.equal(matchesAny('a.instructions.md', parseApplyTo('*.instructions.md')), true)
  assert.equal(matchesAny('axinstructions.md', parseApplyTo('*.instructions.md')), false)
})

test('parseApplyTo splits a comma-separated list', () => {
  assert.deepEqual(parseApplyTo('**/*.ts, **/*.tsx'), ['**/*.ts', '**/*.tsx'])
  assert.deepEqual(parseApplyTo(' **/*.ts ,, **/*.ps1 '), ['**/*.ts', '**/*.ps1'])
})

test('parseApplyTo keeps a brace alternation in one pattern', () => {
  assert.deepEqual(parseApplyTo('**/*.{ts,tsx}, **/*.ps1'), ['**/*.{ts,tsx}', '**/*.ps1'])
})

test('parseApplyTo reports "always" as null', () => {
  assert.equal(parseApplyTo(undefined), null)
  assert.equal(parseApplyTo(null), null)
  assert.equal(parseApplyTo('   '), null)
})

test('matchesAny accepts Windows separators', () => {
  assert.equal(matchesAny('src\\deep\\a.ts', parseApplyTo('**/*.ts')), true)
})
