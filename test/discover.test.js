import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { discover, resolveConfiguredPath } from '../lib/discover.js'

const WORKSPACE = fileURLToPath(new URL('./fixtures/workspace', import.meta.url))
const SHARED = fileURLToPath(new URL('./fixtures/shared', import.meta.url))

const discovered = () => discover({ cwd: WORKSPACE, scanSubdirectories: 1 })

/** Forward-slashed, the way a display path is labelled. */
const slash = (value) => value.split('\\').join('/')

/** A throwaway home directory holding the one configuration directory the tests name. */
function withHome(run) {
  const home = mkdtempSync(join(tmpdir(), 'vscode-ai-config-home-'))
  try {
    return run(home)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

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

test('a configured path IS the configuration directory, with no .github under it', () => {
  const { roots, pathDirs, instructions, skills } = discover({
    cwd: WORKSPACE,
    scanSubdirectories: 1,
    paths: [SHARED],
  })
  // The cwd walk still reports project roots; the configured path is its own shape.
  assert.deepEqual(roots, [WORKSPACE, join(WORKSPACE, 'child-repo'), join(WORKSPACE, 'not-a-repo')])
  assert.deepEqual(pathDirs, [SHARED])
  assert.ok(instructions.some((entry) => entry.content.includes('keep the shared convention')))
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
  assert.equal(copilot.displayPath, `${slash(SHARED)}/copilot-instructions.md`)
})

test('a configured path may be relative to the working directory', () => {
  const { roots, pathDirs } = discover({ cwd: WORKSPACE, scanSubdirectories: 0, paths: ['../shared'] })
  assert.deepEqual(roots, [WORKSPACE])
  assert.deepEqual(pathDirs, [SHARED])
})

test('scanSubdirectories applies to the cwd walk only, never to a configured path', () => {
  // A configured path names ONE configuration directory. Its subdirectories are
  // content — `instructions/`, `skills/` — not further configuration roots.
  const { roots, instructions, skills } = discover({
    cwd: WORKSPACE,
    scanSubdirectories: 0,
    paths: [SHARED],
  })
  assert.deepEqual(roots, [WORKSPACE])
  assert.equal(instructions.some((entry) => entry.content.includes('NESTED-RULE')), false)
  // `sub-dir/copilot-instructions.md` is the decisive one: a `.github`-only
  // fixture would stay invisible even if the path's children were walked as
  // configuration directories.
  assert.equal(instructions.some((entry) => entry.content.includes('NESTED-DIR-RULE')), false)
  assert.equal(skills.some((skill) => skill.name === 'legacy-skill'), false)
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

test('a configured path already read as a project root s .github is not scanned twice', () => {
  const { pathDirs, instructions } = discover({
    cwd: WORKSPACE,
    scanSubdirectories: 1,
    paths: [join(WORKSPACE, '.github')],
  })
  assert.deepEqual(pathDirs, [])
  assert.deepEqual(instructions, discovered().instructions)
})

test('a configured path naming a project root is read as a configuration directory', () => {
  // The path is not a project root any more: it is asked for as the directory
  // that holds `copilot-instructions.md` / `instructions/` / `skills/` itself.
  // `child-repo` has none of those at its top level, so it contributes nothing —
  // and its `.github/copilot-instructions.md` is NOT re-read through it.
  const { roots, pathDirs, instructions } = discover({
    cwd: WORKSPACE,
    scanSubdirectories: 1,
    paths: [join(WORKSPACE, 'child-repo')],
  })
  assert.deepEqual(roots, discovered().roots)
  assert.deepEqual(pathDirs, [join(WORKSPACE, 'child-repo')])
  assert.deepEqual(instructions, discovered().instructions)
})

test('re-listing a directory does not turn its children into configuration roots', () => {
  // The rule that replaced "a second visit gets a fresh depth budget": a
  // configured path is ONE configuration directory, so nothing below it is
  // reached, however the path was named.
  const root = mkdtempSync(join(tmpdir(), 'vscode-ai-config-'))
  try {
    const child = join(root, 'child')
    const grandchild = join(child, 'grandchild')
    mkdirSync(join(grandchild, '.github'), { recursive: true })
    writeFileSync(join(grandchild, '.github', 'copilot-instructions.md'), 'GRANDCHILD-RULE')

    const { roots, pathDirs, instructions } = discover({ cwd: root, scanSubdirectories: 1, paths: [child] })
    assert.deepEqual(roots, [root, child])
    assert.deepEqual(pathDirs, [child])
    assert.equal(instructions.some((entry) => entry.content.includes('GRANDCHILD-RULE')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a configured path deeper than the cwd budget is still scanned', () => {
  // The other half of the rule: naming it is the request, so the visit budget is
  // what limits the cwd walk, not the configured path.
  const root = mkdtempSync(join(tmpdir(), 'vscode-ai-config-'))
  try {
    const deep = join(root, 'a', 'b')
    mkdirSync(deep, { recursive: true })
    writeFileSync(join(deep, 'copilot-instructions.md'), 'DEEP-RULE')

    const { roots, pathDirs, instructions } = discover({ cwd: root, scanSubdirectories: 0, paths: [deep] })
    assert.deepEqual(roots, [root])
    assert.deepEqual(pathDirs, [deep])
    assert.ok(instructions.some((entry) => entry.content.includes('DEEP-RULE')))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('paths that are not usable strings are ignored', () => {
  const { pathDirs } = discover({ cwd: WORKSPACE, scanSubdirectories: 0, paths: ['', '   ', 42, null] })
  assert.deepEqual(pathDirs, [])
})

test('a leading ~ in a configured path is the user s home directory', () => {
  withHome((home) => {
    mkdirSync(join(home, '.copilot', 'skills', 'home-skill'), { recursive: true })
    writeFileSync(join(home, '.copilot', 'copilot-instructions.md'), 'HOME-RULE')
    writeFileSync(
      join(home, '.copilot', 'skills', 'home-skill', 'SKILL.md'),
      '---\nname: home-skill\ndescription: home\n---\nbody',
    )

    const { pathDirs, instructions, skills } = discover({
      cwd: WORKSPACE,
      scanSubdirectories: 0,
      paths: ['~/.copilot'],
      homeDir: home,
    })
    assert.deepEqual(pathDirs, [join(home, '.copilot')])
    assert.ok(instructions.some((entry) => entry.content.includes('HOME-RULE')))
    assert.ok(skills.some((skill) => skill.name === 'home-skill'))
    // It is outside the working directory, so it is labelled with its own path.
    const copilot = instructions.find((entry) => entry.content.includes('HOME-RULE'))
    assert.equal(copilot.displayPath, `${slash(join(home, '.copilot'))}/copilot-instructions.md`)
    assert.equal(copilot.rootDir, join(home, '.copilot'))
  })
})

test('a bare ~ is the home directory, and ~name is an ordinary relative path', () => {
  withHome((home) => {
    const resolveWith = (value) =>
      discover({ cwd: WORKSPACE, scanSubdirectories: 0, paths: [value], homeDir: home }).pathDirs

    assert.deepEqual(resolveWith('~'), [home])
    // `~name` is not another user's home on this platform, so it stays relative.
    assert.deepEqual(resolveWith('~home/x'), [join(WORKSPACE, '~home', 'x')])
    // Only a LEADING `~` means the home directory.
    assert.deepEqual(resolveWith('sub/~/x'), [join(WORKSPACE, 'sub', '~', 'x')])
    // An absolute entry is placed as it is: the cwd anchor does not apply to it.
    const absolute = join(tmpdir(), 'vscode-ai-config-absolute')
    assert.deepEqual(resolveWith(absolute), [absolute])
  })
})

test('a Windows-spelled home path resolves like its forward-slash twin', { skip: process.platform !== 'win32' }, () => {
  withHome((home) => {
    const resolveWith = (value) =>
      discover({ cwd: WORKSPACE, scanSubdirectories: 0, paths: [value], homeDir: home }).pathDirs
    assert.deepEqual(resolveWith('~\\.copilot'), [join(home, '.copilot')])
    assert.deepEqual(resolveWith('~\\.copilot'), resolveWith('~/.copilot'))
  })
})

test('without an explicit home, ~ is the platform home directory', () => {
  const { pathDirs } = discover({ cwd: WORKSPACE, scanSubdirectories: 0, paths: ['~/.copilot'] })
  assert.deepEqual(pathDirs, [join(homedir(), '.copilot')])
})

test('a home-relative entry is placed without a session cwd, a relative one is not', () => {
  // A session's first observation can arrive before its cwd does. `~` carries
  // its own anchor, so it still resolves; a relative entry cannot be placed then
  // and must be refused rather than guessed at against the process cwd.
  const home = resolve(tmpdir(), 'vscode-ai-config-home')
  assert.equal(resolveConfiguredPath(null, '~/.copilot', home), join(home, '.copilot'))
  assert.equal(resolveConfiguredPath(null, join(home, 'shared'), home), join(home, 'shared'))
  assert.equal(resolveConfiguredPath(null, 'relative-dir', home), null)

  const cwd = join(home, 'workspace')
  assert.equal(resolveConfiguredPath(cwd, 'relative-dir', home), join(cwd, 'relative-dir'))
})

test('paths is optional and may be omitted entirely', () => {
  const { roots } = discover({ cwd: WORKSPACE, scanSubdirectories: 0 })
  assert.deepEqual(roots, [WORKSPACE])
})

test('a .github tree under a configured path is never read', () => {
  // The decisive negative of the configured-path rule: the path IS the
  // `.github`-equivalent directory, so a `.github` *inside* it is content that
  // nothing looks at — neither its copilot file, its scoped instructions nor
  // its skills.
  const { instructions, skills } = discover({
    cwd: WORKSPACE,
    scanSubdirectories: 1,
    paths: [SHARED],
  })
  const fromShared = instructions.filter((entry) => entry.displayPath.startsWith(slash(SHARED)))
  assert.deepEqual(fromShared.map((entry) => entry.displayPath), [
    `${slash(SHARED)}/copilot-instructions.md`,
    `${slash(SHARED)}/instructions/shared.instructions.md`,
  ])
  assert.equal(instructions.some((entry) => entry.content.includes('LEGACY-RULE')), false)
  assert.equal(instructions.some((entry) => entry.content.includes('LEGACY-SCOPED-RULE')), false)
  assert.equal(skills.some((skill) => skill.name === 'legacy-skill'), false)
  assert.equal(skills.some((skill) => skill.absolutePath.startsWith(join(SHARED, '.github'))), false)
})

test('a configured path resolves instructionDirs and skillDirs without the .github segment', () => {
  const { instructions, skills, warnings } = discover({
    cwd: WORKSPACE,
    scanSubdirectories: 0,
    paths: [SHARED],
  })
  assert.ok(instructions.some((entry) => entry.displayPath.endsWith('instructions/shared.instructions.md')))
  assert.ok(skills.some((skill) => skill.name === 'shared-skill'))
  assert.equal(warnings.some((warning) => warning.includes(SHARED)), false)

  // A directory that does not start with `.github` is joined as it is.
  const custom = discover({
    cwd: WORKSPACE,
    scanSubdirectories: 0,
    paths: [SHARED],
    instructionDirs: ['instructions'],
    skillDirs: ['skills'],
  })
  assert.ok(custom.instructions.some((entry) => entry.displayPath.endsWith('instructions/shared.instructions.md')))
  assert.ok(custom.skills.some((skill) => skill.name === 'shared-skill'))
})

test('AGENTS.md is never discovered, neither under the cwd nor under a configured path', () => {
  // AGENTS.md belongs to the DSH core, which reads it along the
  // project-root-to-cwd ancestor chain. This plugin contributes `.github`-style
  // configuration only, so an AGENTS.md anywhere must stay invisible here.
  const root = mkdtempSync(join(tmpdir(), 'vscode-ai-config-'))
  const shared = mkdtempSync(join(tmpdir(), 'vscode-ai-config-'))
  try {
    writeFileSync(join(root, 'AGENTS.md'), 'AGENTS-MARKER: core-owned, never this plugin s.')
    mkdirSync(join(root, '.github'), { recursive: true })
    writeFileSync(join(root, '.github', 'copilot-instructions.md'), 'WORKSPACE-RULE')
    writeFileSync(join(shared, 'AGENTS.md'), 'SHARED-AGENTS-MARKER: never read either.')
    writeFileSync(join(shared, 'copilot-instructions.md'), 'SHARED-RULE')

    const { instructions } = discover({ cwd: root, scanSubdirectories: 1, paths: [shared] })
    assert.ok(instructions.some((entry) => entry.content.includes('WORKSPACE-RULE')))
    assert.ok(instructions.some((entry) => entry.content.includes('SHARED-RULE')))
    assert.equal(instructions.some((entry) => entry.content.includes('AGENTS-MARKER')), false)
    assert.equal(instructions.some((entry) => entry.displayPath.endsWith('AGENTS.md')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(shared, { recursive: true, force: true })
  }
})

test('two units resolving to the same source still inject it once', () => {
  // `paths: ['.']` with custom directory names makes both units land on the same
  // directories: the project root's `instructions/` and the configured path's
  // `instructions/` are one and the same. Every source must still appear once —
  // in the rendered instructions and in the skill catalog.
  const root = mkdtempSync(join(tmpdir(), 'vscode-ai-config-'))
  try {
    mkdirSync(join(root, 'instructions'), { recursive: true })
    mkdirSync(join(root, 'skills', 'top-skill'), { recursive: true })
    writeFileSync(join(root, 'instructions', 'top.instructions.md'), 'TOP-RULE')
    writeFileSync(
      join(root, 'skills', 'top-skill', 'SKILL.md'),
      '---\nname: top-skill\ndescription: top\n---\nbody',
    )

    const { instructions, skills } = discover({
      cwd: root,
      scanSubdirectories: 1,
      paths: ['.'],
      instructionDirs: ['instructions'],
      skillDirs: ['skills'],
    })
    assert.deepEqual(instructions.map((entry) => entry.content), ['TOP-RULE'])
    assert.deepEqual(skills.map((skill) => skill.name), ['top-skill'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('no instructionDirs spelling lets a configured path reach its own .github tree', () => {
  // The strip empties out for these spellings, so the base becomes the
  // configuration directory itself. Its `.github` is content, not configuration:
  // hidden directories are not walked there.
  const root = mkdtempSync(join(tmpdir(), 'vscode-ai-config-'))
  try {
    const cwd = join(root, 'cwd')
    mkdirSync(cwd, { recursive: true })
    mkdirSync(join(root, '.github', 'instructions'), { recursive: true })
    writeFileSync(join(root, '.github', 'instructions', 'legacy.instructions.md'), 'LEGACY-DEGENERATE')
    mkdirSync(join(root, 'instructions'), { recursive: true })
    writeFileSync(join(root, 'instructions', 'ok.instructions.md'), 'OK-DEGENERATE')
    // A real tree for the `x/.github/y` spelling, so that leg can fail without
    // the refusal (an assertion that nothing was read needs something to read).
    mkdirSync(join(root, 'x', '.github', 'y'), { recursive: true })
    writeFileSync(join(root, 'x', '.github', 'y', 'evil.instructions.md'), 'EVIL-DEGENERATE')

    for (const value of ['.', '.github', './.github', 'x/.github/y', 'x/.GITHUB/y', '', '/']) {
      const { instructions } = discover({
        cwd,
        scanSubdirectories: 0,
        paths: [root],
        instructionDirs: [value],
      })
      assert.equal(
        instructions.some(
          (entry) =>
            entry.content.includes('LEGACY-DEGENERATE') || entry.content.includes('EVIL-DEGENERATE'),
        ),
        false,
        `instructionDirs: ${JSON.stringify(value)} reached the .github tree`,
      )
    }

    const dot = discover({ cwd, scanSubdirectories: 0, paths: [root], instructionDirs: ['.'] })
    assert.ok(dot.instructions.some((entry) => entry.content.includes('OK-DEGENERATE')))

    // A leading `.` segment means "this directory": `./.github/instructions` is
    // the documented spelling of `<path>/instructions`, not a spelling that
    // resolves to nothing.
    const dotted = discover({
      cwd,
      scanSubdirectories: 0,
      paths: [root],
      instructionDirs: ['./.github/instructions'],
    })
    assert.ok(dotted.instructions.some((entry) => entry.content.includes('OK-DEGENERATE')))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a Windows-style directory spelling resolves like its forward-slash twin', { skip: process.platform !== 'win32' }, () => {
  const { instructions, skills } = discover({
    cwd: WORKSPACE,
    scanSubdirectories: 0,
    paths: [SHARED],
    instructionDirs: ['.github\\instructions'],
    skillDirs: ['.github\\skills'],
  })
  assert.ok(instructions.some((entry) => entry.content.includes('Shared scoped rule.')))
  assert.ok(skills.some((skill) => skill.name === 'shared-skill'))
  assert.equal(instructions.some((entry) => entry.content.includes('LEGACY-SCOPED-RULE')), false)
  assert.equal(skills.some((skill) => skill.name === 'legacy-skill'), false)
})
