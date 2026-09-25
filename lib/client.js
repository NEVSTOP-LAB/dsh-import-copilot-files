/**
 * Browser half: the page the **Plugins** settings section renders for this
 * plugin's entry.
 *
 * Since dsh `0.1.7` there is no namespace-registration handshake to complete.
 * A plugin's settings document IS its Loader entry, `dsh-settings` derives the
 * form from the entry's own `Config` schema, and the page reaches it through two
 * client services:
 *
 * - `configForms.get(entryId)` — the shared form for one Host plugin entry:
 *   `getSnapshot()`, `subscribe()`, `mutate(ops, revision)`, `unset(field)`.
 * - `configForms.whileServed([entryId], register)` — registers the page only
 *   while the Host actually serves that entry, so a deployment whose `Config`
 *   could not be resolved (no schemastery, no settings provider) shows no trace
 *   of this card instead of an empty one.
 *
 * The card itself is one cell of the plugin page's `plugins.item` list — the
 * page renders each cell's `view: 'summary'` as the card's one-liner and its
 * `view: 'page'` as the body of the plugin's page. That is why this bundle draws
 * a form and not a card: the container belongs to the host, and a second
 * disclosure header inside it would be chrome on chrome.
 *
 * The file is plain lazy-CJS, the only bundle format the client module system
 * loads: running it registers a factory, and the body above that factory runs
 * the first time the module is materialized. `react` comes from the shell's
 * frozen platform table, so `require('react')` is answered without any bundle of
 * our own.
 *
 * The host half is still the authority: this page only stages edits and submits
 * them; whether a value is acceptable is decided by the schema on the host, and
 * the page's acceptance check is a re-read of what the host answered.
 */

window.__ModuleLoader__.load({
  id: 'dsh-import-copilot-files',
  factory: (require) => {
    const React = require('react')

    /**
     * The Loader entry id: the settings entry the host serves, the key
     * `configForms.get` is addressed by, and this page's cell id in
     * `plugins.item`. `index.js` exports the same string as `SETTINGS_ENTRY_ID`,
     * and `npm run verify:settings` compares both against `cordis.patch.yml` —
     * the composition file is where the id actually comes from.
     */
    const ENTRY_ID = 'dsh-import-copilot-files'
    /** Dictionary namespace owned by this bundle; unrelated to the entry id. */
    const LOCALE_NS = 'import-copilot-files'
    /** The one field this page edits; the rest stay composition-only. */
    const PATHS_FIELD = 'paths'
    const STYLE_TAG = 'dsh-import-copilot-files/card'
    /**
     * The Windows chooser DSH Desktop publishes on the page. Desktop composes
     * the `browse` picker backend, so this bridge is the only route to an OS
     * folder dialog there.
     */
    const DESKTOP_PICK = '__DSH_DESKTOP_PICK_DIRECTORY__'

    /** Services this half cannot do its job without; the fiber parks until they exist. */
    const inject = ['slots', 'locale', 'configForms']

    const zh = {
      title: '导入 Copilot 文件',
      description: '把工作区以外的 VSCode AI 配置也加载进来',
      intro:
        '下面每一行是一个配置目录，等价于项目里的 .github：直接放 copilot-instructions.md、instructions/ 与 skills/。以 ~ 开头表示用户主目录。',
      empty: '还没有配置任何路径。',
      rowLabel: '路径',
      add: '添加路径',
      browse: '浏览…',
      remove: '删除',
      overridden: '已覆盖',
      reset: '恢复默认',
      discard: '放弃',
      save: '保存',
      saving: '保存中…',
      unsaved: '未保存',
      saveFailed: '保存失败，请重试或重新打开设置。',
      browseFailed: '当前部署没有可用的目录选择器，请手动填写路径。',
      readOnly: '当前部署的设置为只读，路径只能在组合配置里修改。',
    }

    const en = {
      title: 'Import Copilot Files',
      description: 'Load VSCode AI configuration that lives outside the workspace',
      intro:
        "Each row is a configuration directory equivalent to a project's .github folder: it holds copilot-instructions.md, instructions/ and skills/ directly. A leading ~ means your home directory.",
      empty: 'No path configured yet.',
      rowLabel: 'Path',
      add: 'Add path',
      browse: 'Browse…',
      remove: 'Remove',
      overridden: 'Overridden',
      reset: 'Reset',
      discard: 'Discard',
      save: 'Save',
      saving: 'Saving…',
      unsaved: 'Unsaved',
      saveFailed: 'Save failed. Try again, or reopen the settings.',
      browseFailed: 'This deployment has no folder picker; type the path instead.',
      readOnly: 'This deployment is read-only; paths can only be set in the composition.',
    }

    /**
     * The rows editor's own layout. The form frame around it — and the page's
     * card, headers and footer seating — belong to the host, which is why this
     * is a handful of field rules rather than a copy of the host's card chrome.
     * The tokens are the theme service's published `--dsw-alias-*` names.
     */
    const CSS = `
      .dsh-icf-form{display:flex;flex-direction:column;min-width:0}
      .dsh-icf-readOnly{color:var(--dsw-alias-label-tertiary);margin:0 0 4px;font-size:12px;line-height:1.5}
      .dsh-icf-field{flex-direction:column;gap:6px;padding:4px 0 8px;display:flex}
      .dsh-icf-fieldHead{align-items:center;gap:8px;display:flex}
      .dsh-icf-label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}
      .dsh-icf-badges{align-items:center;gap:8px;display:inline-flex}
      .dsh-icf-tag{align-items:center;border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px;font-weight:500;white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);display:inline-flex}
      .dsh-icf-reset{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;padding:0;font-size:12px;line-height:1.5}
      .dsh-icf-reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}
      .dsh-icf-reset:disabled{cursor:default}
      .dsh-icf-rows{margin:0;padding:0;display:flex;flex-direction:column;gap:6px;list-style:none}
      .dsh-icf-row{display:flex;align-items:center;gap:6px}
      .dsh-icf-input{flex:1;min-width:0;border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5}
      .dsh-icf-input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}
      .dsh-icf-input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}
      .dsh-icf-action{display:inline-flex;align-items:center;justify-content:center;gap:4px;height:34px;padding:0 12px;font:inherit;font-size:12px;line-height:18px;border-radius:17px;border:.5px solid var(--dsw-alias-border-l3);background:0 0;color:var(--dsw-alias-label-primary);cursor:pointer;flex:none;white-space:nowrap}
      .dsh-icf-action:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
      .dsh-icf-action:disabled{cursor:not-allowed;opacity:.4}
      .dsh-icf-action:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
      .dsh-icf-icon{width:34px;padding:0;border-color:transparent}
      .dsh-icf-fieldActions{display:flex;align-items:center;gap:8px;margin-top:2px}
      .dsh-icf-empty{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}
      .dsh-icf-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}
      .dsh-icf-notice{min-width:0;color:var(--dsw-alias-label-error);margin:0;font-size:12px;line-height:1.5}
      .dsh-icf-footer{border-top:.5px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}
      .dsh-icf-failed{min-width:0;color:var(--dsw-alias-label-error);flex:1;margin:0;font-size:12px;line-height:1.5}
      .dsh-icf-discard,.dsh-icf-save{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}
      .dsh-icf-discard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}
      .dsh-icf-discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}
      .dsh-icf-save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}
      .dsh-icf-discard:disabled,.dsh-icf-save:disabled{opacity:.4;cursor:default}
      .dsh-icf-discard:focus-visible,.dsh-icf-save:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
    `

    /** Inject this page's stylesheet once per mount, and remove it on teardown. */
    function installStyles() {
      const document = globalThis.document
      if (document === undefined) return () => {}
      if (document.querySelector(`style[data-plugin-css="${STYLE_TAG}"]`) !== null) return () => {}
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-import-copilot-files'
      tag.dataset.pluginCss = STYLE_TAG
      tag.textContent = CSS
      document.head.appendChild(tag)
      return () => tag.remove()
    }

    /**
     * One path per non-empty line: the field is an array on the host, and this
     * is the only place its text form is interpreted.
     *
     * @param text - the joined rows the user edited.
     * @returns the trimmed, non-empty entries, in order.
     */
    function parsePaths(text) {
      return String(text)
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '')
    }

    function sameList(left, right) {
      return left.length === right.length && left.every((value, index) => value === right[index])
    }

    /** Whether the user layer carries this field, i.e. it overrides the deployment. */
    function isOverridden(user, field) {
      return user !== null && typeof user === 'object' && Object.hasOwn(user, field)
    }

    /** A picker answers with a path, or with null/'' when the operator cancels. */
    function pickedPath(value) {
      return typeof value === 'string' && value !== '' ? value : null
    }

    /**
     * Whether this deployment can serve a folder chooser at all. The page shows
     * its Browse action on this answer, and it is a per-page answer: the shell
     * publishes the Desktop bridge while the client boots.
     */
    function hasChooser(ctx) {
      if (typeof globalThis[DESKTOP_PICK] === 'function') return true
      return typeof ctx.get('uiWorkspace')?.pickDirectory === 'function'
    }

    /**
     * The folder chooser this deployment can serve, or `undefined` when it has
     * none — in which case the page offers no Browse action at all.
     *
     * The route is resolved per press rather than here, because the shell
     * memoizes a slot entry's injected props for the entry's lifetime.
     *
     * Two routes exist and only one is available per deployment:
     *
     * - DSH Desktop (win32) publishes its Windows chooser on the page and
     *   composes the `browse` picker backend, whose Remote `pick` verb refuses
     *   with `directory-picker/unavailable`.
     * - Every other composition mounts the `native` backend, reached through
     *   `uiWorkspace.pickDirectory()`.
     *
     * @param ctx - the client context this half is mounted on.
     * @returns the picking action, or undefined when neither route exists.
     */
    function directoryChooser(ctx) {
      if (!hasChooser(ctx)) return undefined
      return async () => {
        const bridge = globalThis[DESKTOP_PICK]
        if (typeof bridge === 'function') return pickedPath(await bridge())
        return pickedPath(await ctx.get('uiWorkspace').pickDirectory())
      }
    }

    /** One editable path row: the input, an optional picker, and a remove action. */
    function PathRow(props) {
      const { t, index, value, disabled, browse, onEdit, onRemove, onBrowse } = props
      return React.createElement(
        'li',
        { className: 'dsh-icf-row' },
        React.createElement('input', {
          className: 'dsh-icf-input',
          type: 'text',
          value,
          disabled,
          spellCheck: false,
          'aria-label': `${t('rowLabel')} ${index + 1}`,
          placeholder: 'D:\\some\\folder',
          onChange: (event) => onEdit(index, event.target.value),
        }),
        browse === undefined
          ? null
          : React.createElement(
              'button',
              {
                type: 'button',
                className: 'dsh-icf-action',
                disabled,
                onClick: () => {
                  void onBrowse(index)
                },
              },
              t('browse'),
            ),
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-icf-action dsh-icf-icon',
            disabled,
            'aria-label': `${t('remove')} ${index + 1}`,
            onClick: () => onRemove(index),
          },
          '✕',
        ),
      )
    }

    /**
     * The page body. Every hook runs before the first return, because the page
     * asks the same registration for its one-liner and for its body.
     */
    function Card(props) {
      const { t, scope, browse } = props
      const subscribe = React.useCallback((notify) => scope.subscribe(notify), [scope])
      const read = React.useCallback(() => scope.getSnapshot(), [scope])
      const snapshot = React.useSyncExternalStore(subscribe, read)
      /** `null` while the page shows what the host holds, else the staged edit. */
      const [draft, setDraft] = React.useState(null)
      const [phase, setPhase] = React.useState('idle')
      /** Why the last pick produced nothing; cleared by the next attempt. */
      const [notice, setNotice] = React.useState(null)

      // The card's one-liner, drawn on the Plugins page's card list.
      if (props.view === 'summary') return t('description')
      if (snapshot.status !== 'ready') return null

      const stored = Array.isArray(snapshot.value?.[PATHS_FIELD]) ? snapshot.value[PATHS_FIELD] : []
      const rows = draft === null ? stored : draft.paths
      const editable = snapshot.writable && phase !== 'saving'
      const dirty = draft !== null
      const overridden = isOverridden(snapshot.user, PATHS_FIELD)

      // The revision is pinned when the draft starts, so a save computed from a
      // stale form is rejected rather than quietly overwriting someone else.
      const stage = (next) =>
        setDraft({ paths: next, revision: draft === null ? snapshot.revision : draft.revision })
      const edit = (index, value) => stage(rows.map((row, at) => (at === index ? value : row)))
      const remove = (index) => stage(rows.filter((_, at) => at !== index))
      const add = () => stage([...rows, ''])
      const discard = () => {
        setDraft(null)
        setPhase('idle')
      }

      /**
       * Replace one row with what the folder chooser answered. A cancelled or
       * unserviceable pick leaves the row alone and says so; a rejection must
       * not reach the console as an unhandled one.
       */
      const pick = async (index) => {
        setNotice(null)
        let picked
        try {
          picked = await browse()
        } catch {
          setNotice(t('browseFailed'))
          return
        }
        if (typeof picked === 'string' && picked !== '') edit(index, picked)
      }

      const save = async () => {
        if (draft === null) return
        const value = parsePaths(draft.paths.join('\n'))
        setPhase('saving')
        try {
          await scope.mutate([{ op: 'set', path: [PATHS_FIELD], value }], draft.revision)
        } catch {
          setPhase('failed')
          return
        }
        // Acceptance is the host's answer, not the write having been sent.
        const landed = scope.getSnapshot().value?.[PATHS_FIELD]
        if (sameList(Array.isArray(landed) ? landed : [], value)) {
          setDraft(null)
          setPhase('idle')
        } else {
          setPhase('failed')
        }
      }

      /**
       * Drop the user override so the field inherits the composition config
       * again. Discarding a draft only forgets unsaved edits; this is the
       * operation that changes what is stored.
       */
      const reset = async () => {
        setPhase('saving')
        try {
          await scope.unset(PATHS_FIELD)
        } catch {
          setPhase('failed')
          return
        }
        if (isOverridden(scope.getSnapshot().user, PATHS_FIELD)) {
          setPhase('failed')
        } else {
          setDraft(null)
          setPhase('idle')
        }
      }

      return React.createElement(
        'div',
        { className: 'dsh-icf-form' },
        !snapshot.writable
          ? React.createElement('p', { className: 'dsh-icf-readOnly', role: 'status' }, t('readOnly'))
          : null,
        React.createElement(
          'div',
          { className: 'dsh-icf-field' },
          React.createElement(
            'div',
            { className: 'dsh-icf-fieldHead' },
            React.createElement('span', { className: 'dsh-icf-label' }, t('rowLabel')),
            React.createElement(
              'span',
              { className: 'dsh-icf-badges' },
              dirty ? React.createElement('span', { className: 'dsh-icf-tag' }, t('unsaved')) : null,
              overridden
                ? React.createElement('span', { className: 'dsh-icf-tag' }, t('overridden'))
                : null,
              overridden
                ? React.createElement(
                    'button',
                    {
                      type: 'button',
                      className: 'dsh-icf-reset',
                      disabled: !editable,
                      onClick: () => {
                        void reset()
                      },
                    },
                    t('reset'),
                  )
                : null,
            ),
          ),
          rows.length === 0
            ? React.createElement('p', { className: 'dsh-icf-empty' }, t('empty'))
            : React.createElement(
                'ul',
                { className: 'dsh-icf-rows' },
                rows.map((row, index) =>
                  React.createElement(PathRow, {
                    key: index,
                    t,
                    index,
                    value: row,
                    disabled: !editable,
                    browse,
                    onEdit: edit,
                    onRemove: remove,
                    onBrowse: pick,
                  }),
                ),
              ),
          React.createElement(
            'div',
            { className: 'dsh-icf-fieldActions' },
            React.createElement(
              'button',
              { type: 'button', className: 'dsh-icf-action', disabled: !editable, onClick: add },
              t('add'),
            ),
          ),
          React.createElement('p', { className: 'dsh-icf-hint' }, t('intro')),
          notice === null
            ? null
            : React.createElement('p', { className: 'dsh-icf-notice', role: 'status' }, notice),
        ),
        React.createElement(
          'div',
          { className: 'dsh-icf-footer' },
          phase === 'failed'
            ? React.createElement('p', { className: 'dsh-icf-failed', role: 'status' }, t('saveFailed'))
            : null,
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'dsh-icf-discard',
              disabled: !dirty || phase === 'saving',
              onClick: discard,
            },
            t('discard'),
          ),
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'dsh-icf-save',
              disabled: !dirty || !editable,
              onClick: () => {
                void save()
              },
            },
            phase === 'saving' ? t('saving') : t('save'),
          ),
        ),
      )
    }

    /** Mount this entry's page on the browser plugin's fiber. */
    function apply(ctx) {
      const t = ctx.locale.bind(LOCALE_NS)
      ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), `${ENTRY_ID}: page copy`)
      ctx.effect(installStyles, `${ENTRY_ID}: page styles`)

      // The provider owns every form it hands out, so this one is not disposed
      // here: the service releases them when it unloads, and a bundle reload
      // re-reads the same shared form rather than a second copy of it.
      const scope = ctx.configForms.get(ENTRY_ID)

      ctx.effect(
        () =>
          ctx.configForms.whileServed([ENTRY_ID], () =>
            ctx.slots.inject(
              'plugins.item',
              () =>
                ctx.slots.register(
                  {
                    name: 'plugins.item',
                    // The cell key is the entry id, so the page's own form lookup
                    // and this registration address the same namespace.
                    id: ENTRY_ID,
                    order: 50,
                    label: () => t('title'),
                    locale: LOCALE_NS,
                    inject: () => ({ scope, browse: directoryChooser(ctx) }),
                  },
                  Card,
                ),
            ),
        ),
        `${ENTRY_ID}: plugin page`,
      )
    }

    return { apply, inject, parsePaths, ENTRY_ID }
  },
})
