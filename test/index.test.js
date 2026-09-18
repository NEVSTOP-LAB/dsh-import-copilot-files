/**
 * Drives the real plugin object against a fake Cordis context.
 *
 * This is the fast loop that does not need a DSH session: it exercises the
 * pre-step waterfall, the skill provider and the observation listener exactly as
 * the runtime does, using the fixtures as the workspace.
 */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import plugin from '../src/index.js'

const WORKSPACE = fileURLToPath(new URL('../fixtures/workspace', import.meta.url))

const agentFor = (id, cwd = WORKSPACE) => ({ id, session: { header: { cwd } } })

const textOf = (message) => message.content.map((part) => part.text ?? '').join('')

/** A minimal stand-in for the host context this row is composed into. */
function mount(cwd = WORKSPACE, config = {}) {
  const listeners = new Map()
  const agent = agentFor('session-a', cwd)
  let invalidations = 0
  let provider = null

  const ctx = {
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

  const observe = (path, who = agent) => {
    for (const listener of listeners.get('fs/observed') ?? []) {
      listener({ displayPath: path }, { kind: 'present' }, { agent: who })
    }
  }

  /** Run the pre-step waterfall once, exactly as the agent loop composes it. */
  const inject = async (who = agent, claimed = []) => {
    const handlers = listeners.get('agent/pre-step') ?? []
    const payload = { agent: who, messages: claimed, turn: 1, step: 2, signal: undefined }
    const base = { kind: 'accept', messages: [...claimed] }
    let index = -1
    const next = async () => {
      index += 1
      return index < handlers.length ? handlers[index](payload, next) : base
    }
    return next()
  }

  /** Whatever this step would newly inject, as text. */
  const render = async (who = agent) => {
    const decision = await inject(who)
    return decision.messages.map(textOf).join('\n\n')
  }

  return {
    agent,
    inject,
    render,
    list: (options = { cwd }) => provider.list(options),
    get: (candidate) => provider.get(candidate),
    observe,
    observeWithoutActor(path) {
      for (const listener of listeners.get('fs/observed') ?? []) {
        listener({ displayPath: path }, { kind: 'present' }, undefined)
      }
    },
    invalidations: () => invalidations,
  }
}

test('the plugin declares only the services it consumes', () => {
  assert.deepEqual(plugin.inject, ['skills'])
  assert.equal(plugin.name, 'import-vscode-ai-files')
})

test('the injection is a user message the client labels as an instruction form', async () => {
  const decision = await mount().inject()
  assert.equal(decision.messages.length, 1)
  const message = decision.messages[0]
  assert.equal(message.role, 'user')
  assert.equal(typeof message.id, 'string')
  assert.equal(message.content[0].type, 'text')
  assert.equal(message.source.kind, 'plugin')
  assert.equal(message.source.plugin, 'import-vscode-ai-files')
  assert.equal(message.source.form, 'instructions')
  assert.ok(Object.isFrozen(message), 'the message must be frozen like a created message')
})

test('the injection lands after the messages this step already claimed', async () => {
  const session = mount()
  const claimed = [{ id: 'user-1', role: 'user', content: [{ type: 'text', text: 'hi' }] }]
  const decision = await session.inject(session.agent, claimed)
  assert.equal(decision.messages.length, 2)
  assert.equal(decision.messages[0].id, 'user-1')
  assert.equal(decision.messages[1].source.form, 'instructions')
})

test('renders the always-on instructions for the session cwd', async () => {
  const rendered = await mount().render()
  assert.match(rendered, /Instructions from: \.github\/copilot-instructions\.md/)
  assert.match(rendered, /Instructions from: child-repo\/\.github\/copilot-instructions\.md/)
  assert.match(rendered, /Always-on rule: never commit generated files\./)
})

test('an unchanged rendering is not injected a second time', async () => {
  const session = mount()
  assert.notEqual(await session.render(), '')
  assert.equal(await session.render(), '')
})

test('applyTo instructions stay out until a matching file is observed', async () => {
  const session = mount()
  assert.doesNotMatch(await session.render(), /TypeScript rule/)
  session.observe(join(WORKSPACE, 'src', 'a.ts'))
  const rendered = await session.render()
  assert.match(rendered, /Instructions from: \.github\/instructions\/typescript\.instructions\.md/)
  assert.match(rendered, /Applies to: \*\*\/\*\.ts, \*\*\/\*\.tsx/)
  assert.match(rendered, /TypeScript rule: no implicit `any`\./)
})

test('an observation that matches nothing injects nothing new', async () => {
  const session = mount()
  await session.render()
  session.observe(join(WORKSPACE, 'src', 'a.py'))
  assert.equal(await session.render(), '')
})

test('a nested instruction matches against its own root', async () => {
  const session = mount()
  await session.render()
  session.observe(join(WORKSPACE, 'src', 'deep', 'build.ps1'))
  assert.match(await session.render(), /PowerShell scripts under `src\/`/)
})

test('an observation outside the workspace never activates a pattern', async () => {
  const session = mount()
  await session.render()
  session.observe('C:\\elsewhere\\src\\a.ts')
  assert.equal(await session.render(), '')
})

test('an observation without an agent is dropped', async () => {
  const session = mount()
  await session.render()
  session.observeWithoutActor(join(WORKSPACE, 'src', 'a.ts'))
  assert.equal(await session.render(), '')
})

test('touched paths never leak between sessions', async () => {
  const session = mount()
  const first = agentFor('session-a')
  const second = agentFor('session-b')

  await session.render(first)
  await session.render(second)
  session.observe(join(WORKSPACE, 'src', 'a.ts'), first)

  assert.match(await session.render(first), /TypeScript rule/)
  assert.equal(await session.render(second), '')
})

test('one session reads its own cwd, not another session s', async () => {
  const session = mount()
  const elsewhere = agentFor('session-other', join(WORKSPACE, 'not-a-repo'))
  assert.match(await session.render(), /Workspace rules/)
  assert.equal(await session.render(elsewhere), '')
})

test('a session without a cwd injects nothing', async () => {
  assert.equal(await mount(WORKSPACE).render({ id: 'session-a', session: { header: {} } }), '')
})

test('a file that disappears produces a removal notice', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vscode-ai-config-'))
  try {
    mkdirSync(join(root, '.github', 'instructions'), { recursive: true })
    const file = join(root, '.github', 'instructions', 'temporary.instructions.md')
    writeFileSync(file, 'MARKER-ONE: a temporary rule.')

    const session = mount(root)
    assert.match(await session.render(), /MARKER-ONE/)

    rmSync(file)
    const rendered = await session.render()
    assert.match(rendered, /Instructions removed:/)
    assert.match(rendered, /temporary\.instructions\.md/)
    assert.doesNotMatch(rendered, /MARKER-ONE/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
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

test('a change under a .github tree invalidates the skill catalog', async () => {
  const session = mount()
  await session.render()
  session.observe(join(WORKSPACE, '.github', 'skills', 'new-skill', 'SKILL.md'))
  assert.equal(session.invalidations(), 1)
})

test('an observed file outside .github does not invalidate the catalog', async () => {
  const session = mount()
  await session.render()
  session.observe(join(WORKSPACE, 'src', 'a.ts'))
  assert.equal(session.invalidations(), 0)
})

test('a .github change outside this session s cwd still invalidates the catalog', async () => {
  // The provider serves every workspace, so a skill edited in another one must
  // not stay stale here.
  const session = mount()
  await session.render()
  session.observe('D:\\other-workspace\\.github\\skills\\x\\SKILL.md')
  assert.equal(session.invalidations(), 1)
})

test('a tight budget truncates and says what it dropped', async () => {
  const rendered = await mount(WORKSPACE, { maxBytes: 460 }).render()
  assert.match(rendered, /\[truncated\]|omitted by the 460-byte budget/)
  assert.match(rendered, /Instructions from: \.github\/copilot-instructions\.md/)
})

test('a render never exceeds the configured budget', async () => {
  // Walks the range where the truncation and omission paths take over.
  for (const maxBytes of [300, 400, 460, 520, 700, 1000, 4096]) {
    const rendered = await mount(WORKSPACE, { maxBytes }).render()
    assert.ok(rendered.length <= maxBytes, `maxBytes=${maxBytes} produced ${rendered.length} characters`)
  }
})

test('a budget too small for even one block renders nothing', async () => {
  assert.equal(await mount(WORKSPACE, { maxBytes: 200 }).render(), '')
})
