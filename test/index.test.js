/**
 * Drives the real plugin object against a fake Cordis context.
 *
 * This is the fast loop that does not need a DSH session: it exercises the two
 * registration seams and the observation listener exactly as the runtime does,
 * using the fixtures as the workspace.
 */

import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import plugin from '../src/index.js'

const WORKSPACE = fileURLToPath(new URL('../fixtures/workspace', import.meta.url))

const agentFor = (id, cwd = WORKSPACE) => ({ id, session: { header: { cwd } } })

/** A minimal stand-in for the host context this row is composed into. */
function mount(cwd = WORKSPACE, config = {}) {
  const listeners = new Map()
  const agent = agentFor('session-a', cwd)
  let invalidations = 0
  let contextSpec = null
  let provider = null

  const ctx = {
    systemPrompt: {
      context(spec) {
        contextSpec = spec
        return () => {}
      },
    },
    skills: {
      registerProvider(create) {
        provider = create({ invalidate: () => { invalidations += 1 } })
        return () => {}
      },
    },
    on(name, listener) {
      listeners.set(name, [...(listeners.get(name) ?? []), listener])
      return () => {}
    },
  }

  plugin.apply(ctx, config)

  const emit = (path, actor) => {
    for (const listener of listeners.get('fs/observed') ?? []) {
      listener({ displayPath: path }, { kind: 'present' }, actor)
    }
  }

  return {
    agent,
    contextName: () => contextSpec.name,
    render: (who = agent) => contextSpec.text({ agent: who }),
    renderWithoutAgent: () => contextSpec.text({}),
    list: (options = { cwd }) => provider.list(options),
    get: (candidate) => provider.get(candidate),
    observe: (path, who = agent) => emit(path, { agent: who }),
    observeWithoutActor: (path) => emit(path, undefined),
    invalidations: () => invalidations,
  }
}

test('the plugin declares only the services it consumes', () => {
  assert.deepEqual(plugin.inject, ['skills', 'systemPrompt'])
  assert.equal(plugin.name, 'import-vscode-ai-files')
})

test('renders the always-on instructions for the session cwd', () => {
  const rendered = mount().render()
  assert.match(rendered, /Instructions from: \.github\/copilot-instructions\.md/)
  assert.match(rendered, /Instructions from: child-repo\/\.github\/copilot-instructions\.md/)
  assert.match(rendered, /Always-on rule: never commit generated files\./)
})

test('applyTo instructions stay out until a matching file is observed', () => {
  const session = mount()
  assert.doesNotMatch(session.render(), /TypeScript rule/)
  session.observe(join(WORKSPACE, 'src', 'a.ts'))
  const rendered = session.render()
  assert.match(rendered, /Instructions from: \.github\/instructions\/typescript\.instructions\.md/)
  assert.match(rendered, /Applies to: \*\*\/\*\.ts, \*\*\/\*\.tsx/)
  assert.match(rendered, /TypeScript rule: no implicit `any`\./)
})

test('an observation that matches nothing leaves applyTo instructions out', () => {
  const session = mount()
  session.observe(join(WORKSPACE, 'src', 'a.py'))
  assert.doesNotMatch(session.render(), /TypeScript rule/)
})

test('a nested instruction matches against its own root', () => {
  const session = mount()
  session.observe(join(WORKSPACE, 'src', 'deep', 'build.ps1'))
  assert.match(session.render(), /PowerShell scripts under `src\/`/)
})

test('an observation outside the workspace never activates a pattern', () => {
  const session = mount()
  session.observe('C:\\elsewhere\\src\\a.ts')
  assert.doesNotMatch(session.render(), /TypeScript rule/)
})

test('an observation without an agent is dropped', () => {
  const session = mount()
  session.observe(join(WORKSPACE, 'src', 'a.ts'), null)
  assert.doesNotMatch(session.render(), /TypeScript rule/)
})

test('an observation with no actor at all is dropped', () => {
  const session = mount()
  session.observeWithoutActor(join(WORKSPACE, 'src', 'a.ts'))
  assert.doesNotMatch(session.render(), /TypeScript rule/)
})

test('touched paths never leak between sessions', () => {
  const session = mount()
  const first = agentFor('session-a')
  const second = agentFor('session-b')

  session.render(first)
  session.render(second)
  session.observe(join(WORKSPACE, 'src', 'a.ts'), first)

  assert.match(session.render(first), /TypeScript rule/)
  assert.doesNotMatch(session.render(second), /TypeScript rule/)
})

test('one session reads its own cwd, not another session s', () => {
  const session = mount()
  const other = agentFor('session-other', join(WORKSPACE, 'not-a-repo'))
  assert.match(session.render(), /Workspace rules/)
  assert.equal(session.render(other), '')
})

test('no agent in the assembly context renders nothing', () => {
  assert.equal(mount().renderWithoutAgent(), '')
})

test('the provider lists every discovered skill for the given cwd', async () => {
  const candidateNames = (await mount().list({ cwd: WORKSPACE })).map((skill) => skill.name)
  assert.deepEqual(candidateNames, ['child-skill', 'demo-skill', 'dir-named-skill', 'quiet-skill'])
})

test('a candidate carries the locator, rank and resource base the registry needs', async () => {
  const candidates = await mount().list({ cwd: WORKSPACE })
  const candidate = candidates.find((skill) => skill.name === 'demo-skill')
  assert.equal(candidate.provider, 'import-vscode-ai-files')
  assert.equal(candidate.source, 'project-vscode')
  assert.equal(candidate.rank, 150)
  assert.deepEqual(candidate.resourceBase, {
    kind: 'directory',
    path: join(WORKSPACE, '.github', 'skills', 'demo-skill'),
  })
  assert.equal(candidate.locator, join(WORKSPACE, '.github', 'skills', 'demo-skill', 'SKILL.md'))
})

test('a skill lookup without a cwd answers nothing', async () => {
  assert.deepEqual(await mount().list({}), [])
})

test('get re-reads the body from disk, with frontmatter stripped', async () => {
  const session = mount()
  const candidate = (await session.list({ cwd: WORKSPACE })).find((skill) => skill.name === 'demo-skill')
  const definition = await session.get(candidate)
  assert.equal(definition.content, '# Demo skill\n\nFollow these steps.')
  assert.equal(definition.name, 'demo-skill')
  assert.deepEqual(definition.resourceBase, {
    kind: 'directory',
    path: join(WORKSPACE, '.github', 'skills', 'demo-skill'),
  })
})

test('get without a locator answers undefined instead of throwing', async () => {
  assert.equal(await mount().get({}), undefined)
})

test('a change under a .github tree invalidates the skill catalog', () => {
  const session = mount()
  session.render()
  session.observe(join(WORKSPACE, '.github', 'skills', 'new-skill', 'SKILL.md'))
  assert.equal(session.invalidations(), 1)
})

test('an observed file outside .github does not invalidate the catalog', () => {
  const session = mount()
  session.render()
  session.observe(join(WORKSPACE, 'src', 'a.ts'))
  assert.equal(session.invalidations(), 0)
})

test('a tight budget truncates and says what it dropped', () => {
  const rendered = mount(WORKSPACE, { maxBytes: 460 }).render()
  assert.match(rendered, /\[truncated\]|omitted by the 460-byte budget/)
  assert.match(rendered, /Instructions from: \.github\/copilot-instructions\.md/)
})

test('a render never exceeds the configured budget', () => {
  // Walks the range where the truncation and omission paths take over.
  for (const maxBytes of [300, 400, 460, 520, 700, 1000, 4096]) {
    const rendered = mount(WORKSPACE, { maxBytes }).render()
    assert.ok(
      rendered.length <= maxBytes,
      `maxBytes=${maxBytes} produced ${rendered.length} characters`,
    )
  }
})

test('a budget too small for even one block renders nothing', () => {
  assert.equal(mount(WORKSPACE, { maxBytes: 200 }).render(), '')
})

test('an observation that matches no applyTo pattern activates nothing extra', () => {
  const session = mount()
  session.observe(join(WORKSPACE, 'notes.md'))
  const rendered = session.render()
  assert.match(rendered, /Always-on rule/)
  assert.doesNotMatch(rendered, /TypeScript rule/)
  assert.doesNotMatch(rendered, /PowerShell scripts under `src\/`/)
})
