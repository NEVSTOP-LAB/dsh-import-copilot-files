/**
 * The browser half, driven the way the shell drives it.
 *
 * `lib/client.js` is a lazy-CJS bundle: running the file only registers a
 * factory, and the factory runs on first materialization. This test reproduces
 * both steps — run the file against a fake `window.__ModuleLoader__`, take the
 * factory, call it with a React stand-in — so the card's wiring and its staged
 * save are pinned without a browser.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const SOURCE = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const NAMESPACE = 'import-vscode-ai-files'

/** Run the bundle and materialize its factory, as the client module system does. */
function loadBundle(React) {
  const registered = []
  const window = { __ModuleLoader__: { load: (registration) => registered.push(registration) } }
  new Function('window', SOURCE)(window)
  assert.equal(registered.length, 1, 'the bundle registers exactly one factory')
  const module = registered[0].factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected require(${name})`)
  })
  return { registration: registered[0], module }
}

/**
 * A React stand-in with just enough state to re-render through the card's
 * staged edits: `reset()` starts a render pass, `useState` cells persist.
 */
function makeReact(readSnapshot) {
  let cursor = 0
  const cells = []
  return {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useCallback: (fn) => fn,
    useEffect: () => {},
    useSyncExternalStore: () => readSnapshot(),
    useState(initial) {
      const at = cursor
      cursor += 1
      if (!(at in cells)) cells[at] = typeof initial === 'function' ? initial() : initial
      const set = (next) => {
        cells[at] = typeof next === 'function' ? next(cells[at]) : next
      }
      return [cells[at], set]
    },
    reset() {
      cursor = 0
    },
  }
}

/** Every node in the element tree, rendering function components as it goes. */
function nodes(tree, found = []) {
  if (tree === null || tree === undefined || typeof tree !== 'object') return found
  if (Array.isArray(tree)) {
    for (const child of tree) nodes(child, found)
    return found
  }
  found.push(tree)
  if (typeof tree.type === 'function') return nodes(tree.type(tree.props), found)
  for (const child of tree.children ?? []) nodes(child, found)
  return found
}

const textOf = (node) => (node.children ?? []).filter((part) => typeof part === 'string').join('')
const byText = (tree, tag, text) =>
  nodes(tree).find((node) => node.type === tag && textOf(node) === text)

/** The settings scope face the card consumes. */
function fakeScope(paths, { writable = true, status = 'ready', overridden = true } = {}) {
  let value = { paths: [...paths] }
  // The raw user layer: a field present here is an override of the deployment.
  let user = overridden ? { paths: [...paths] } : {}
  let revision = 3
  const listeners = new Set()
  const notify = () => {
    for (const listener of listeners) listener()
  }
  return {
    calls: [],
    getSnapshot: () => ({ status, value, revision, writable, user, mode: 'host' }),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async mutate(ops, expectedRevision) {
      this.calls.push({ ops, expectedRevision })
      for (const op of ops) {
        if (op.op === 'set' && op.path[0] === 'paths') {
          value = { ...value, paths: op.value }
          user = { ...user, paths: op.value }
        }
      }
      revision += 1
      notify()
    },
    async unset(field) {
      this.calls.push({ ops: [{ op: 'unset', path: [field] }], expectedRevision: undefined })
      const next = { ...user }
      delete next[field]
      user = next
      value = { ...value, [field]: [] }
      revision += 1
      notify()
    },
  }
}

/** The browser plugin context: services the fiber injects, recorded. */
function fakeCtx(scope, picker) {
  const dictionaries = []
  const binds = []
  const injections = []
  const registrations = []
  const effects = []
  return {
    dictionaries,
    binds,
    injections,
    registrations,
    effects,
    ctx: {
      effect(callback, label) {
        effects.push({ dispose: callback(), label })
      },
      locale: {
        register(ns, dicts) {
          dictionaries.push({ ns, dicts })
          return () => {}
        },
      },
      settingsScope: {
        bind(spec) {
          binds.push(spec)
          return scope
        },
      },
      slots: {
        inject(key, callback) {
          injections.push({ key, dispose: callback() })
        },
        register(options, component) {
          registrations.push({ options, component })
          return () => {}
        },
      },
      get: (name) => (name === 'uiWorkspace' ? picker : undefined),
    },
  }
}

test('the bundle registers the package id the shell looks up', () => {
  const { registration } = loadBundle({})
  assert.equal(registration.id, 'dsh-import-vscode-ai-files')
  assert.equal(typeof registration.factory, 'function')
})

test('the card is registered under the settings namespace the host serves', () => {
  const scope = fakeScope([])
  const { ctx, dictionaries, binds, injections, registrations } = fakeCtx(scope)
  const { module } = loadBundle({})
  module.apply(ctx)

  assert.deepEqual(module.inject, ['slots', 'locale', 'settingsScope'])
  assert.deepEqual(dictionaries.map((entry) => entry.ns), [NAMESPACE])
  assert.ok(dictionaries[0].dicts.zh.title.length > 0)
  assert.ok(dictionaries[0].dicts.en.title.length > 0)
  assert.deepEqual(binds, [{ namespace: NAMESPACE }])
  assert.deepEqual(injections.map((entry) => entry.key), ['settings.plugin.item'])

  assert.equal(registrations.length, 1)
  const { options, component } = registrations[0]
  assert.equal(options.name, 'settings.plugin.item')
  assert.equal(options.key, NAMESPACE)
  assert.equal(options.locale, NAMESPACE)
  assert.equal(typeof component, 'function')

  const props = options.inject()
  assert.equal(props.scope, scope)
  assert.equal(props.browse, undefined, 'no picker service means no Browse button')
})

test('an available folder picker becomes a Browse action', async () => {
  const scope = fakeScope([])
  const picked = []
  const { ctx, registrations } = fakeCtx(scope, {
    pickDirectory: async () => {
      picked.push('called')
      return 'D:\\shared'
    },
  })
  const { module } = loadBundle({})
  module.apply(ctx)
  const props = registrations[0].options.inject()
  assert.equal(typeof props.browse, 'function')
  assert.equal(await props.browse(), 'D:\\shared')
  assert.deepEqual(picked, ['called'])
})

test('a namespace the host has not answered renders nothing', () => {
  const scope = fakeScope([], { status: 'loading' })
  const React = makeReact(() => scope.getSnapshot())
  const { module } = loadBundle(React)
  const { ctx, registrations } = fakeCtx(scope)
  module.apply(ctx)
  const props = { t: (key) => key, ...registrations[0].options.inject() }
  assert.equal(registrations[0].component(props), null)
})

test('the card shows the stored paths and stages an edit', () => {
  const scope = fakeScope(['D:\\one'])
  const React = makeReact(() => scope.getSnapshot())
  const { module } = loadBundle(React)
  const { ctx, registrations } = fakeCtx(scope)
  module.apply(ctx)
  const props = { t: (key) => key, ...registrations[0].options.inject() }

  React.reset()
  let tree = registrations[0].component(props)
  const input = nodes(tree).find((node) => node.type === 'input')
  assert.equal(input.props.value, 'D:\\one')

  // Add a row, then type into it.
  React.reset()
  byText(tree, 'button', 'add').props.onClick()
  React.reset()
  tree = registrations[0].component(props)
  const inputs = nodes(tree).filter((node) => node.type === 'input')
  assert.equal(inputs.length, 2)
  inputs[1].props.onChange({ target: { value: ' D:\\two ' } })

  React.reset()
  tree = registrations[0].component(props)
  assert.ok(byText(tree, 'span', 'unsaved'), 'a staged edit is marked')
  const save = byText(tree, 'button', 'save')
  assert.equal(save.props.disabled, false)
})

test('saving submits the parsed list with the revision the draft started from', async () => {
  const scope = fakeScope(['D:\\one'])
  const React = makeReact(() => scope.getSnapshot())
  const { module } = loadBundle(React)
  const { ctx, registrations } = fakeCtx(scope)
  module.apply(ctx)
  const props = { t: (key) => key, ...registrations[0].options.inject() }

  React.reset()
  let tree = registrations[0].component(props)
  React.reset()
  byText(tree, 'button', 'add').props.onClick()
  React.reset()
  tree = registrations[0].component(props)
  const inputs = nodes(tree).filter((node) => node.type === 'input')
  inputs[0].props.onChange({ target: { value: ' D:\\one ' } })
  React.reset()
  tree = registrations[0].component(props)
  const inputsAgain = nodes(tree).filter((node) => node.type === 'input')
  inputsAgain[1].props.onChange({ target: { value: '' } })

  React.reset()
  tree = registrations[0].component(props)
  byText(tree, 'button', 'save').props.onClick()
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(scope.calls.length, 1)
  assert.deepEqual(scope.calls[0].ops, [{ op: 'set', path: ['paths'], value: ['D:\\one'] }])
  assert.equal(scope.calls[0].expectedRevision, 3)
})

test('a read-only deployment says so and cannot be edited', () => {
  const scope = fakeScope(['D:\\one'], { writable: false })
  const React = makeReact(() => scope.getSnapshot())
  const { module } = loadBundle(React)
  const { ctx, registrations } = fakeCtx(scope)
  module.apply(ctx)
  const props = { t: (key) => key, ...registrations[0].options.inject() }

  React.reset()
  const tree = registrations[0].component(props)
  assert.ok(nodes(tree).some((node) => textOf(node) === 'readOnly'))
  assert.equal(nodes(tree).find((node) => node.type === 'input').props.disabled, true)
  assert.equal(byText(tree, 'button', 'add').props.disabled, true)
})

test('reset clears the user override so the field inherits the deployment again', async () => {
  // Discard only forgets a draft; the stored override is what makes the value
  // differ from the composition config, and clearing it is a write of its own.
  const scope = fakeScope(['D:\\one'])
  const React = makeReact(() => scope.getSnapshot())
  const { module } = loadBundle(React)
  const { ctx, registrations } = fakeCtx(scope)
  module.apply(ctx)
  const props = { t: (key) => key, ...registrations[0].options.inject() }

  React.reset()
  const tree = registrations[0].component(props)
  const reset = byText(tree, 'button', 'reset')
  assert.ok(reset, 'an overridden field offers a reset')
  assert.equal(reset.props.disabled, false)
  reset.props.onClick()
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(scope.calls[0].ops, [{ op: 'unset', path: ['paths'] }])
  assert.equal(Object.hasOwn(scope.getSnapshot().user, 'paths'), false)
})

test('a field the user never overrode offers no reset', () => {
  const scope = fakeScope(['D:\\one'], { overridden: false })
  const React = makeReact(() => scope.getSnapshot())
  const { module } = loadBundle(React)
  const { ctx, registrations } = fakeCtx(scope)
  module.apply(ctx)
  const props = { t: (key) => key, ...registrations[0].options.inject() }

  React.reset()
  const tree = registrations[0].component(props)
  assert.equal(byText(tree, 'button', 'reset'), undefined)
  assert.ok(byText(tree, 'button', 'save'), 'the card itself is still there')
})

test('the paths field is text in, trimmed and non-empty entries out', () => {
  const { module } = loadBundle({})
  assert.deepEqual(module.parsePaths('D:\\one\n\n  D:\\two  \n   '), ['D:\\one', 'D:\\two'])
  assert.deepEqual(module.parsePaths(''), [])
})

test('the card stylesheet is installed once and removed on teardown', () => {
  const appended = []
  const previous = globalThis.document
  globalThis.document = {
    querySelector: () => null,
    createElement: () => ({ dataset: {}, textContent: '', remove: () => appended.push('removed') }),
    head: { appendChild: (tag) => appended.push(tag) },
  }
  try {
    const scope = fakeScope([])
    const { ctx, effects } = fakeCtx(scope)
    const { module } = loadBundle({})
    module.apply(ctx)
    assert.equal(appended.filter((entry) => entry !== 'removed').length, 1)
    assert.equal(appended[0].dataset.plugin, 'dsh-import-vscode-ai-files')
    for (const effect of effects) effect.dispose()
    assert.deepEqual(appended.filter((entry) => entry === 'removed').length, 1)
  } finally {
    if (previous === undefined) delete globalThis.document
    else globalThis.document = previous
  }
})
