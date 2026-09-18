import assert from 'node:assert/strict'
import { basename, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { discover } from '../lib/discover.js'

const WORKSPACE = fileURLToPath(new URL('./fixtures/workspace', import.meta.url))
const SHARED = fileURLToPath(new URL('./fixtures/shared', import.meta.url))

const discovered = () => discover({ cwd: WORKSPACE, scanSubdirectories: 1 })

/** Forward-slashed, the way a display path is labelled. */
const slash = (value) => value.split('\\').join('/')

test('roots are the working directory plus one level of subdirectories', () => {
  const { roots } = discovered()
  assert.deepEqual(
    roots.map((root) => (root === WORKSPACE ? '.' : basename(root))),
    ['.', 'child-repo', 'not-a-repo'],
  )
})

test('scanSubdirectories 0 leaves only the working directory', () => {
  const { roots, skills } = discover({ cwd: WORKSPACE, scanSubdirectories: 0 })
  assert.deepEqual(roots, [WORKSPACE])
  assert.equal(skills.some((skill) => skill.name === 'child-skill'), false)
})

test('instructions group per root, always-on first within each root', () => {
  assert.deepEqual(
    discovered().instructions.map((entry) => entry.displayPath),
    [
      '.github/copilot-instructions.md',
      '.github/instructions/always.instructions.md',
      '.github/instructions/nested/deep.instructions.md',
      '.github/instructions/typescript.instructions.md',
      'child-repo/.github/copilot-instructions.md',
    ],
  )
})

test('copilot-instructions.md is plain Markdown, never parsed as frontmatter', () => {
  const copilot = discovered().instructions.find(
    (entry) => entry.displayPath === '.github/copilot-instructions.md',
  )
  assert.equal(copilot.applyTo, null)
  assert.match(copilot.content, /^# Workspace rules/)
})

test('applyTo parses into a glob list, and its absence means "always"', () => {
  const byPath = new Map(discovered().instructions.map((entry) => [entry.displayPath, entry]))
  assert.equal(byPath.get('.github/instructions/always.instructions.md').applyTo, null)
  assert.deepEqual(byPath.get('.github/instructions/typescript.instructions.md').applyTo, [
    '**/*.ts',
    '**/*.tsx',
  ])
  assert.deepEqual(byPath.get('.github/instructions/nested/deep.instructions.md').applyTo, [
    'src/**/*.ps1',
  ])
})

test('an instruction body excludes its frontmatter block', () => {
  const typescript = discovered().instructions.find((entry) =>
    entry.displayPath.endsWith('typescript.instructions.md'),
  )
  assert.equal(typescript.content.trim(), 'TypeScript rule: no implicit `any`.')
})

test('every root carries its own rootDir for applyTo matching', () => {
  const child = discovered().instructions.find((entry) =>
    entry.displayPath.startsWith('child-repo/'),
  )
  assert.equal(child.rootDir, fileURLToPath(new URL('./fixtures/workspace/child-repo', import.meta.url)))
})

test('skills are discovered across roots and sorted by name', () => {
  assert.deepEqual(
    discovered().skills.map((skill) => skill.name),
    ['child-skill', 'demo-skill', 'dir-named-skill', 'quiet-skill'],
  )
})

test('a block-scalar description keeps its line breaks', () => {
  const demo = discovered().skills.find((skill) => skill.name === 'demo-skill')
  assert.equal(demo.description, 'A demo skill whose description\nspans two lines.')
  assert.equal(demo.whenToUse, 'When the user asks for a demo.')
  assert.deepEqual(demo.invocation, { modelInvocable: true, userInvocable: true })
  assert.equal(basename(demo.dir), 'demo-skill')
  assert.equal(basename(demo.absolutePath), 'SKILL.md')
})

test('invocation flags map onto the registry policy', () => {
  const quiet = discovered().skills.find((skill) => skill.name === 'quiet-skill')
  assert.deepEqual(quiet.invocation, { modelInvocable: false, userInvocable: false })
})

test('a non-kebab directory name is slugged, with a warning', () => {
  const { skills, warnings } = discovered()
  assert.ok(skills.some((skill) => skill.name === 'dir-named-skill'))
  assert.ok(warnings.some((warning) => warning.includes('using directory name "dir-named-skill"')))
})

test('a skill without a description is skipped, with a warning', () => {
  const { skills, warnings } = discovered()
  assert.equal(skills.some((skill) => skill.name === 'no-description'), false)
  assert.ok(warnings.some((warning) => warning.includes('description is required')))
})

test('a non-boolean invocation flag drops the skill', () => {
  const { skills, warnings } = discovered()
  assert.equal(skills.some((skill) => skill.name === 'bad-bool'), false)
  assert.ok(warnings.some((warning) => warning.includes('"disable-model-invocation" is not a boolean')))
})

test('a configured path is scanned by the same rule as the working directory', () => {
  const { roots, instructions, skills } = discover({
    cwd: WORKSPACE,
    scanSubdirectories: 1,
    paths: [SHARED],
  })
  assert.deepEqual(roots, [WORKSPACE, join(WORKSPACE, 'child-repo'), join(WORKSPACE, 'not-a-repo'), SHARED, join(SHARED, 'child-repo')])
  assert.ok(instructions.some((entry) => entry.content.includes('keep the shared convention')))
  assert.ok(instructions.some((entry) => entry.content.includes('repository nested one level')))
  assert.ok(skills.some((skill) => skill.name === 'shared-skill'))
})

test('a configured path carries its own roots for applyTo matching', () => {
  const { instructions } = discover({ cwd: WORKSPACE, scanSubdirectories: 1, paths: [SHARED] })
  const scoped = instructions.find((entry) => entry.displayPath.endsWith('shared.instructions.md'))
  assert.deepEqual(scoped.applyTo, ['**/*.shared.ts'])
  assert.equal(scoped.rootDir, SHARED)
})

test('a file outside the working directory is labelled with its absolute path', () => {
  const { instructions } = discover({ cwd: WORKSPACE, scanSubdirectories: 1, paths: [SHARED] })
  const copilot = instructions.find((entry) => entry.content.includes('Shared rules'))
  assert.equal(copilot.displayPath, `${slash(SHARED)}/.github/copilot-instructions.md`)
})

test('a configured path may be relative to the working directory', () => {
  const { roots } = discover({ cwd: WORKSPACE, scanSubdirectories: 0, paths: ['../shared'] })
  assert.deepEqual(roots, [WORKSPACE, SHARED])
})

test('scanSubdirectories 0 applies to a configured path too', () => {
  const { roots, instructions } = discover({ cwd: WORKSPACE, scanSubdirectories: 0, paths: [SHARED] })
  assert.deepEqual(roots, [WORKSPACE, SHARED])
  assert.equal(instructions.some((entry) => entry.content.includes('Shared child rules')), false)
})

test('a configured path that does not exist contributes nothing', () => {
  const missing = join(WORKSPACE, 'no-such-folder')
  const { instructions, skills, warnings } = discover({
    cwd: WORKSPACE,
    scanSubdirectories: 1,
    paths: [missing],
  })
  assert.deepEqual(instructions, discovered().instructions)
  assert.deepEqual(skills, discovered().skills)
  assert.deepEqual(warnings, discovered().warnings)
})

test('a configured path already under the working directory is not scanned twice', () => {
  const { roots, instructions } = discover({
    cwd: WORKSPACE,
    scanSubdirectories: 1,
    paths: [join(WORKSPACE, 'child-repo')],
  })
  assert.deepEqual(roots, discovered().roots)
  assert.deepEqual(instructions, discovered().instructions)
})

test('paths that are not usable strings are ignored', () => {
  const { roots } = discover({ cwd: WORKSPACE, scanSubdirectories: 0, paths: ['', '   ', 42, null] })
  assert.deepEqual(roots, [WORKSPACE])
})

test('paths is optional and may be omitted entirely', () => {
  const { roots } = discover({ cwd: WORKSPACE, scanSubdirectories: 0 })
  assert.deepEqual(roots, [WORKSPACE])
})
