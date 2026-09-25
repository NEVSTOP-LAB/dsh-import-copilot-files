/**
 * The browser half, driven the way the shell drives it.
 *
 * `lib/client.js` is a lazy-CJS bundle: running the file only registers a
 * factory, and the factory runs on first materialization. This test reproduces
 * both steps — run the file against a fake `window.__ModuleLoader__`, take the
 * factory, call it with a React stand-in — so the page's wiring and its staged
 * save are pinned without a browser.
 *
 * The page is one cell of the Plugins page's `plugins.item` list: the same
 * registration answers `view: 'summary'` for the card's one-liner and
 * `view: 'page'` for the body, which is why every rendering test names the view
 * it is asking for.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const SOURCE = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const ENTRY_ID = 'dsh-import-copilot-files'
const LOCALE_NS = 'import-copilot-files'
const BROWSE = 'dsh-icf-action'

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
 * A React stand-in with just enough state to re-render through the page's
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
const byClass = (tree, tag, className) =>
  nodes(tree).find((node) => node.type === tag && node.props?.className === className)

/** The settings form face the page consumes (a `ConfigFormController`'s shape). */
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
  const formReads = []
  const watched = []
  const injections = []
  const registrations = []
  const effects = []
  return {
    dictionaries,
    formReads,
    watched,
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
        bind: () => (key) => key,
      },
      configForms: {
        get(entryId) {
          formReads.push(entryId)
          return scope
        },
        whileServed(namespaces, register) {
          watched.push(namespaces)
          return register(new Set(namespaces))
        },
      },
      slots: {
        inject(key, callback) {
          // The real service answers with a disposer, and the page's effect
          // returns it.
          const dispose = callback()
          injections.push({ key, dispose })
          return () => {
            dispose?.()
          }
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

/** Run one page with a fake form, the way the plugins page renders it. */
function mountPage(scope, picker, React) {
  const { module } = loadBundle(React)
  const { ctx, registrations } = fakeCtx(scope, picker)
  module.apply(ctx)
  const injected = registrations[0].options.inject()
  return {
    props: { view: 'page', t: (key) => key, ...injected },
    component: registrations[0].component,
  }
}

test('the bundle registers the package id the shell looks up', () => {
  const { registration } = loadBundle({})
  assert.equal(registration.id, 'dsh-import-copilot-files')
  assert.equal(typeof registration.factory, 'function')
})

test('the page is registered on the entry id the host serves', () => {
  const scope = fakeScope([])
  const { ctx, dictionaries, formReads, watched, injections, registrations } = fakeCtx(scope)
  const { module } = loadBundle({})
  module.apply(ctx)

  // The static inject list must name services the client actually provides: a
  // name no service ever answers parks this fiber, and the client boot then
  // reports the whole plugin as failed — which is what put DSH into recovery.
  assert.deepEqual(module.inject, ['slots', 'locale', 'configForms'])
  assert.deepEqual(module.ENTRY_ID, ENTRY_ID)
  assert.deepEqual(formReads, [ENTRY_ID])
  assert.deepEqual(watched, [[ENTRY_ID]])
  assert.deepEqual(dictionaries.map((entry) => entry.ns), [LOCALE_NS])
  // The card's title is what the plugins page shows for this plugin, so it is
  // pinned here rather than merely checked for being non-empty.
  assert.equal(dictionaries[0].dicts.zh.title, '导入 Copilot 文件')
  assert.equal(dictionaries[0].dicts.en.title, 'Import Copilot Files')
  // A configured row is a configuration directory, not a project root.
  assert.doesNotMatch(dictionaries[0].dicts.zh.intro, /项目根/)
  assert.doesNotMatch(dictionaries[0].dicts.en.intro, /project root/i)
  // The hint is where the one path form the field interprets is documented:
  // discovery expands a leading `~`, so the field must say so.
  assert.match(dictionaries[0].dicts.zh.intro, /以 ~ 开头/)
  assert.match(dictionaries[0].dicts.en.intro, /leading ~/)
  assert.deepEqual(injections.map((entry) => entry.key), ['plugins.item'])

  assert.equal(registrations.length, 1)
  const { options, component } = registrations[0]
  assert.equal(options.name, 'plugins.item')
  // The cell id is the entry id, so the page's own form lookup for this card
  // addresses the same namespace this page reads.
  assert.equal(options.id, ENTRY_ID)
  assert.equal(options.locale, LOCALE_NS)
  assert.equal(options.label(), 'title')
  assert.equal(typeof component, 'function')

  const props = options.inject()
  assert.equal(props.scope, scope)
  assert.equal(props.browse, undefined, 'no picker service means no Browse button')
})

test('the client half names no seam that was renamed out of the harness', () => {
  // The regression this file exists for: dsh 0.1.7 renamed `settingsScope` to
  // `configForms` and replaced `settings.plugin.item` with the plugin page's
  // `plugins.item`. A stale name here is invisible to every other check — the
  // fiber simply never activates.
  assert.doesNotMatch(SOURCE, /settingsScope/)
  assert.doesNotMatch(SOURCE, /settings\.plugin\.item/)
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

test('the desktop chooser bridge answers before the picker service', async () => {
  // DSH Desktop composes the browse picker backend, whose `pick` verb refuses;
  // the shell's own Windows chooser is the route that works there.
  const scope = fakeScope([])
  const calls = []
  const { ctx, registrations } = fakeCtx(scope, {
    pickDirectory: async () => {
      calls.push('service')
      return 'D:\\service'
    },
  })
  const previous = globalThis.__DSH_DESKTOP_PICK_DIRECTORY__
  globalThis.__DSH_DESKTOP_PICK_DIRECTORY__ = async () => {
    calls.push('bridge')
    return 'D:\\desktop'
  }
  try {
    const { module } = loadBundle({})
    module.apply(ctx)
    const props = registrations[0].options.inject()
    assert.equal(await props.browse(), 'D:\\desktop')
    assert.deepEqual(calls, ['bridge'])
  } finally {
    if (previous === undefined) delete globalThis.__DSH_DESKTOP_PICK_DIRECTORY__
    else globalThis.__DSH_DESKTOP_PICK_DIRECTORY__ = previous
  }
})

test('a cancelled pick answers null rather than a path', async () => {
  const scope = fakeScope([])
  const previous = globalThis.__DSH_DESKTOP_PICK_DIRECTORY__
  globalThis.__DSH_DESKTOP_PICK_DIRECTORY__ = async () => null
  try {
    const { ctx, registrations } = fakeCtx(scope)
    const { module } = loadBundle({})
    module.apply(ctx)
    assert.equal(await registrations[0].options.inject().browse(), null)
  } finally {
    if (previous === undefined) delete globalThis.__DSH_DESKTOP_PICK_DIRECTORY__
    else globalThis.__DSH_DESKTOP_PICK_DIRECTORY__ = previous
  }
})

test('the chooser route is resolved per press, not when the page is injected', async () => {
  // The shell memoizes a slot entry's injected props, so a bridge the page
  // publishes after the card was injected still has to win.
  const scope = fakeScope([])
  const calls = []
  const { ctx, registrations } = fakeCtx(scope, {
    pickDirectory: async () => {
      calls.push('service')
      return 'D:\\service'
    },
  })
  const previous = globalThis.__DSH_DESKTOP_PICK_DIRECTORY__
  delete globalThis.__DSH_DESKTOP_PICK_DIRECTORY__
  try {
    const { module } = loadBundle({})
    module.apply(ctx)
    const browse = registrations[0].options.inject().browse
    assert.equal(typeof browse, 'function')
    globalThis.__DSH_DESKTOP_PICK_DIRECTORY__ = async () => {
      calls.push('bridge')
      return 'D:\\desktop'
    }
    assert.equal(await browse(), 'D:\\desktop')
    assert.deepEqual(calls, ['bridge'])
  } finally {
    if (previous === undefined) delete globalThis.__DSH_DESKTOP_PICK_DIRECTORY__
    else globalThis.__DSH_DESKTOP_PICK_DIRECTORY__ = previous
  }
})

test('the summary view is the one-liner the card list shows', () => {
  const scope = fakeScope([])
  const React = makeReact(() => scope.getSnapshot())
  const { props, component } = mountPage(scope, undefined, React)
  assert.equal(component({ ...props, view: 'summary' }), 'description')
})

test('an entry the host has not answered renders nothing', () => {
  const scope = fakeScope([], { status: 'loading' })
  const React = makeReact(() => scope.getSnapshot())
  const { props, component } = mountPage(scope, undefined, React)
  assert.equal(component(props), null)
})

test('the page shows the stored paths and stages an edit', () => {
  const scope = fakeScope(['D:\\one'])
  const React = makeReact(() => scope.getSnapshot())
  const { props, component } = mountPage(scope, undefined, React)

  React.reset()
  let tree = component(props)
  assert.equal(tree.props.className, 'dsh-icf-form')
  const input = nodes(tree).find((node) => node.type === 'input')
  assert.equal(input.props.value, 'D:\\one')

  // Add a row, then type into it.
  React.reset()
  byText(tree, 'button', 'add').props.onClick()
  React.reset()
  tree = component(props)
  const inputs = nodes(tree).filter((node) => node.type === 'input')
  assert.equal(inputs.length, 2)
  inputs[1].props.onChange({ target: { value: ' D:\\two ' } })

  React.reset()
  tree = component(props)
  assert.ok(byText(tree, 'span', 'unsaved'), 'a staged edit is marked')
  const save = byText(tree, 'button', 'save')
  assert.equal(save.props.disabled, false)
})

test('saving submits the parsed list with the revision the draft started from', async () => {
  const scope = fakeScope(['D:\\one'])
  const React = makeReact(() => scope.getSnapshot())
  const { props, component } = mountPage(scope, undefined, React)

  React.reset()
  let tree = component(props)
  React.reset()
  byText(tree, 'button', 'add').props.onClick()
  React.reset()
  tree = component(props)
  const inputs = nodes(tree).filter((node) => node.type === 'input')
  inputs[0].props.onChange({ target: { value: ' D:\\one ' } })
  React.reset()
  tree = component(props)
  const inputsAgain = nodes(tree).filter((node) => node.type === 'input')
  inputsAgain[1].props.onChange({ target: { value: '' } })

  React.reset()
  tree = component(props)
  byText(tree, 'button', 'save').props.onClick()
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(scope.calls.length, 1)
  assert.deepEqual(scope.calls[0].ops, [{ op: 'set', path: ['paths'], value: ['D:\\one'] }])
  assert.equal(scope.calls[0].expectedRevision, 3)

  React.reset()
  // A save the host accepted puts the page back to rest, with nothing staged.
  assert.equal(byText(component(props), 'span', 'unsaved'), undefined)
})

test('a read-only deployment says so and cannot be edited', () => {
  const scope = fakeScope(['D:\\one'], { writable: false })
  const React = makeReact(() => scope.getSnapshot())
  const { props, component } = mountPage(scope, undefined, React)

  const tree = component(props)
  assert.ok(nodes(tree).some((node) => textOf(node) === 'readOnly'))
  assert.equal(nodes(tree).find((node) => node.type === 'input').props.disabled, true)
  assert.equal(byText(tree, 'button', 'add').props.disabled, true)
})

test('reset clears the user override so the field inherits the deployment again', async () => {
  // Discard only forgets a draft; the stored override is what makes the value
  // differ from the composition config, and clearing it is a write of its own.
  const scope = fakeScope(['D:\\one'])
  const React = makeReact(() => scope.getSnapshot())
  const { props, component } = mountPage(scope, undefined, React)

  const tree = component(props)
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
  const { props, component } = mountPage(scope, undefined, React)

  const tree = component(props)
  assert.equal(byText(tree, 'button', 'reset'), undefined)
  assert.ok(byText(tree, 'button', 'save'), 'the page itself is still there')
})

test('a Browse press replaces the row with what the chooser answered', async () => {
  const scope = fakeScope(['D:\\one'])
  const React = makeReact(() => scope.getSnapshot())
  const { props, component } = mountPage(scope, { pickDirectory: async () => 'D:\\picked' }, React)

  const tree = component(props)
  const browse = byText(tree, 'button', 'browse')
  assert.ok(browse, 'a picker means each row offers Browse')
  browse.props.onClick()
  await new Promise((resolve) => setImmediate(resolve))

  React.reset()
  const landed = component(props)
  assert.equal(nodes(landed).find((node) => node.type === 'input').props.value, 'D:\\picked')
  assert.ok(byText(landed, 'span', 'unsaved'), 'the pick is a staged edit')
})

test('a refused pick reports instead of doing nothing', async () => {
  // The composition may mount a picker backend with no `pick` verb; the
  // rejection must reach the operator rather than the unhandled-rejection log.
  const scope = fakeScope(['D:\\one'])
  const React = makeReact(() => scope.getSnapshot())
  const { props, component } = mountPage(
    scope,
    {
      pickDirectory: async () => {
        throw new Error('directory-picker/unavailable')
      },
    },
    React,
  )

  let tree = component(props)
  React.reset()
  byClass(tree, 'button', BROWSE).props.onClick()
  await new Promise((resolve) => setImmediate(resolve))

  React.reset()
  tree = component(props)
  assert.ok(byText(tree, 'p', 'browseFailed'))
  assert.equal(
    nodes(tree).find((node) => node.type === 'input').props.value,
    'D:\\one',
    'the row keeps what it had',
  )
})

test('a cancelled pick leaves the row untouched and silent', async () => {
  const scope = fakeScope(['D:\\one'])
  const React = makeReact(() => scope.getSnapshot())
  const previous = globalThis.__DSH_DESKTOP_PICK_DIRECTORY__
  globalThis.__DSH_DESKTOP_PICK_DIRECTORY__ = async () => null
  try {
    const { props, component } = mountPage(scope, undefined, React)
    let tree = component(props)
    React.reset()
    byClass(tree, 'button', BROWSE).props.onClick()
    await new Promise((resolve) => setImmediate(resolve))

    React.reset()
    tree = component(props)
    assert.equal(byText(tree, 'p', 'browseFailed'), undefined)
    assert.equal(nodes(tree).find((node) => node.type === 'input').props.value, 'D:\\one')
    assert.equal(byText(tree, 'span', 'unsaved'), undefined, 'nothing was staged')
  } finally {
    if (previous === undefined) delete globalThis.__DSH_DESKTOP_PICK_DIRECTORY__
    else globalThis.__DSH_DESKTOP_PICK_DIRECTORY__ = previous
  }
})

test('the paths field is text in, trimmed and non-empty entries out', () => {
  const { module } = loadBundle({})
  assert.deepEqual(module.parsePaths('D:\\one\n\n  D:\\two  \n   '), ['D:\\one', 'D:\\two'])
  assert.deepEqual(module.parsePaths(''), [])
})

test('the page stylesheet is installed once and removed on teardown', () => {
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
    assert.equal(appended[0].dataset.plugin, 'dsh-import-copilot-files')
    for (const effect of effects) effect.dispose()
    assert.deepEqual(appended.filter((entry) => entry === 'removed').length, 1)
  } finally {
    if (previous === undefined) delete globalThis.document
    else globalThis.document = previous
  }
})
