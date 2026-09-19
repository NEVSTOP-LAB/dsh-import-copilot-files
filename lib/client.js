/**
 * Browser half: the card the **Settings → Plugins → 插件配置** page renders for
 * this plugin.
 *
 * The page pairs the settings namespaces the host serves with the cards that
 * claim them, dispatching `settings.plugin.item` under the namespace as its
 * slot key — so `key` here and the namespace registered by `index.js` are the
 * same string, and a mismatch renders nothing at all.
 *
 * The file is plain lazy-CJS, which is the only bundle format the client module
 * system loads: running it registers a factory, and the body above that factory
 * runs the first time the module is materialized. `react` comes from the shell's
 * frozen platform table, so `require('react')` is answered without any bundle
 * of our own.
 *
 * The chrome mirrors the host's `PluginCard` and its field layout one class at
 * a time — the `.5px` `border-l4` on `bg-layer-3`, the 16px radius, the header
 * button that discloses the body, the field's label + hint + input, and the
 * footer's discard/save pair — because the plugins page lays the cards out and
 * dispatches them but never draws one. The chevron and the capsule buttons are
 * hand-drawn from the primitives' own geometry for the same reason: this bundle
 * may require `react` and nothing else.
 *
 * The host half is still the authority: this card only stages edits and submits
 * them; whether a value is acceptable is decided by the schema on the host, and
 * the card's acceptance check is a re-read of what the host answered.
 */

window.__ModuleLoader__.load({
  id: 'dsh-import-vscode-ai-files',
  factory: (require) => {
    const React = require('react')

    /** The settings namespace `index.js` registers; also the card's slot key. */
    const NAMESPACE = 'import-vscode-ai-files'
    /** The one field this card edits; the rest stay composition-only. */
    const PATHS_FIELD = 'paths'
    const STYLE_TAG = 'dsh-import-vscode-ai-files/card'
    /**
     * The Windows chooser DSH Desktop publishes on the page. Desktop composes
     * the `browse` picker backend, so this bridge is the only route to an OS
     * folder dialog there.
     */
    const DESKTOP_PICK = '__DSH_DESKTOP_PICK_DIRECTORY__'
    /** `ic_ds_chevron_down_outline_14` from `@deepseek-ai/dsh-client-ui-primitives`. */
    const CHEVRON_PATH =
      'M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z'

    /** Services this half cannot do its job without; the fiber parks until they exist. */
    const inject = ['slots', 'locale', 'settingsScope']

    const zh = {
      title: '导入其他位置的 AI 文件',
      description: '把工作区以外的 .github 配置也加载进来',
      intro: '下面每一行是一个项目根目录，按与工作区相同的规则扫描它的 .github。',
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
      title: 'Import AI files from other locations',
      description: 'Load .github configuration that lives outside the workspace',
      intro: 'Each row is a project root, scanned for .github exactly like the workspace.',
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

    const CSS = `
      .dsh-ivaf-card{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);border-radius:16px;list-style:none;transition:border-color .16s,background .16s}
      .dsh-ivaf-card:hover{border-color:var(--dsw-alias-label-dimmed)}
      .dsh-ivaf-cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}
      .dsh-ivaf-header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}
      .dsh-ivaf-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
      .dsh-ivaf-headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}
      .dsh-ivaf-name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}
      .dsh-ivaf-description{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}
      .dsh-ivaf-pending{align-items:center;border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px;font-weight:500;white-space:nowrap;flex:none;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);display:inline-flex}
      .dsh-ivaf-chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}
      .dsh-ivaf-chevronOpen{transform:rotate(180deg)}
      .dsh-ivaf-body{border-top:.5px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}
      .dsh-ivaf-readOnly{color:var(--dsw-alias-label-tertiary);margin:12px 0 0;font-size:12px;line-height:1.5}
      .dsh-ivaf-field{flex-direction:column;gap:6px;padding:12px 0;display:flex}
      .dsh-ivaf-fieldHead{align-items:center;gap:8px;display:flex}
      .dsh-ivaf-label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}
      .dsh-ivaf-badges{align-items:center;gap:8px;display:inline-flex}
      .dsh-ivaf-tag{align-items:center;border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px;font-weight:500;white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);display:inline-flex}
      .dsh-ivaf-reset{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;padding:0;font-size:12px;line-height:1.5}
      .dsh-ivaf-reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}
      .dsh-ivaf-reset:disabled{cursor:default}
      .dsh-ivaf-rows{margin:0;padding:0;display:flex;flex-direction:column;gap:6px;list-style:none}
      .dsh-ivaf-row{display:flex;align-items:center;gap:6px}
      .dsh-ivaf-input{flex:1;min-width:0;border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5}
      .dsh-ivaf-input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}
      .dsh-ivaf-input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}
      .dsh-ivaf-action{display:inline-flex;align-items:center;justify-content:center;gap:4px;height:34px;padding:0 12px;font:inherit;font-size:12px;line-height:18px;border-radius:17px;border:.5px solid var(--dsw-alias-border-l3);background:0 0;color:var(--dsw-alias-label-primary);cursor:pointer;flex:none;white-space:nowrap}
      .dsh-ivaf-action:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
      .dsh-ivaf-action:disabled{cursor:not-allowed;opacity:.4}
      .dsh-ivaf-action:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
      .dsh-ivaf-icon{width:34px;padding:0;border-color:transparent}
      .dsh-ivaf-fieldActions{display:flex;align-items:center;gap:8px;margin-top:2px}
      .dsh-ivaf-empty{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}
      .dsh-ivaf-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}
      .dsh-ivaf-notice{min-width:0;color:var(--dsw-alias-label-error);margin:0;font-size:12px;line-height:1.5}
      .dsh-ivaf-footer{border-top:.5px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}
      .dsh-ivaf-failed{min-width:0;color:var(--dsw-alias-label-error);flex:1;margin:0;font-size:12px;line-height:1.5}
      .dsh-ivaf-discard,.dsh-ivaf-save{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}
      .dsh-ivaf-discard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}
      .dsh-ivaf-discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}
      .dsh-ivaf-save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}
      .dsh-ivaf-discard:disabled,.dsh-ivaf-save:disabled{opacity:.4;cursor:default}
      .dsh-ivaf-discard:focus-visible,.dsh-ivaf-save:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
    `

    /** Inject the card's stylesheet once per mount, and remove it on teardown. */
    function installStyles() {
      const document = globalThis.document
      if (document === undefined) return () => {}
      if (document.querySelector(`style[data-plugin-css="${STYLE_TAG}"]`) !== null) return () => {}
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-import-vscode-ai-files'
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
     * Whether this deployment can serve a folder chooser at all. The card shows
     * its Browse action on this answer, and it is a per-page answer: the shell
     * publishes the Desktop bridge while the client boots.
     */
    function hasChooser(ctx) {
      if (typeof globalThis[DESKTOP_PICK] === 'function') return true
      return typeof ctx.get('uiWorkspace')?.pickDirectory === 'function'
    }

    /**
     * The folder chooser this deployment can serve, or `undefined` when it has
     * none — in which case the card offers no Browse action at all.
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

    /** The host's card chevron, drawn at the primitives' own 14px geometry. */
    function Chevron(props) {
      return React.createElement(
        'svg',
        {
          className: props.className,
          width: 14,
          height: 14,
          viewBox: '0 0 14 14',
          fill: 'none',
          xmlns: 'http://www.w3.org/2000/svg',
        },
        React.createElement('path', { d: CHEVRON_PATH, fill: 'currentColor' }),
      )
    }

    /** One editable path row: the input, an optional picker, and a remove action. */
    function PathRow(props) {
      const { t, index, value, disabled, browse, onEdit, onRemove, onBrowse } = props
      return React.createElement(
        'li',
        { className: 'dsh-ivaf-row' },
        React.createElement('input', {
          className: 'dsh-ivaf-input',
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
                className: 'dsh-ivaf-action',
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
            className: 'dsh-ivaf-action dsh-ivaf-icon',
            disabled,
            'aria-label': `${t('remove')} ${index + 1}`,
            onClick: () => onRemove(index),
          },
          '✕',
        ),
      )
    }

    /**
     * The card body. Every hook runs before the one early return, because a
     * namespace the host has not answered yet must not change the hook order.
     */
    function Card(props) {
      const { t, scope, browse } = props
      const subscribe = React.useCallback((notify) => scope.subscribe(notify), [scope])
      const read = React.useCallback(() => scope.getSnapshot(), [scope])
      const snapshot = React.useSyncExternalStore(subscribe, read)
      /** `null` while the card shows what the host holds, else the staged edit. */
      const [draft, setDraft] = React.useState(null)
      const [phase, setPhase] = React.useState('idle')
      const [open, setOpen] = React.useState(false)
      /** Why the last pick produced nothing; cleared by the next attempt. */
      const [notice, setNotice] = React.useState(null)

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
          setOpen(false)
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
        'li',
        { className: open ? 'dsh-ivaf-card dsh-ivaf-cardOpen' : 'dsh-ivaf-card' },
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-ivaf-header',
            'aria-expanded': open,
            'aria-label': t('title'),
            onClick: () => {
              setOpen(!open)
            },
          },
          React.createElement(
            'span',
            { className: 'dsh-ivaf-headText' },
            React.createElement('span', { className: 'dsh-ivaf-name' }, t('title')),
            React.createElement('span', { className: 'dsh-ivaf-description' }, t('description')),
          ),
          dirty ? React.createElement('span', { className: 'dsh-ivaf-pending' }, t('unsaved')) : null,
          React.createElement(Chevron, {
            className: open ? 'dsh-ivaf-chevron dsh-ivaf-chevronOpen' : 'dsh-ivaf-chevron',
          }),
        ),
        open
          ? React.createElement(
              'div',
              { className: 'dsh-ivaf-body' },
              !snapshot.writable
                ? React.createElement('p', { className: 'dsh-ivaf-readOnly', role: 'status' }, t('readOnly'))
                : null,
              React.createElement(
                'div',
                { className: 'dsh-ivaf-field' },
                React.createElement(
                  'div',
                  { className: 'dsh-ivaf-fieldHead' },
                  React.createElement('span', { className: 'dsh-ivaf-label' }, t('rowLabel')),
                  overridden
                    ? React.createElement(
                        'span',
                        { className: 'dsh-ivaf-badges' },
                        React.createElement('span', { className: 'dsh-ivaf-tag' }, t('overridden')),
                        React.createElement(
                          'button',
                          {
                            type: 'button',
                            className: 'dsh-ivaf-reset',
                            disabled: !editable,
                            onClick: () => {
                              void reset()
                            },
                          },
                          t('reset'),
                        ),
                      )
                    : null,
                ),
                rows.length === 0
                  ? React.createElement('p', { className: 'dsh-ivaf-empty' }, t('empty'))
                  : React.createElement(
                      'ul',
                      { className: 'dsh-ivaf-rows' },
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
                  { className: 'dsh-ivaf-fieldActions' },
                  React.createElement(
                    'button',
                    { type: 'button', className: 'dsh-ivaf-action', disabled: !editable, onClick: add },
                    t('add'),
                  ),
                ),
                React.createElement('p', { className: 'dsh-ivaf-hint' }, t('intro')),
                notice === null
                  ? null
                  : React.createElement('p', { className: 'dsh-ivaf-notice', role: 'status' }, notice),
              ),
              React.createElement(
                'div',
                { className: 'dsh-ivaf-footer' },
                phase === 'failed'
                  ? React.createElement(
                      'p',
                      { className: 'dsh-ivaf-failed', role: 'status' },
                      t('saveFailed'),
                    )
                  : null,
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    className: 'dsh-ivaf-discard',
                    disabled: !dirty || phase === 'saving',
                    onClick: discard,
                  },
                  t('discard'),
                ),
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    className: 'dsh-ivaf-save',
                    disabled: !dirty || !editable,
                    onClick: () => {
                      void save()
                    },
                  },
                  phase === 'saving' ? t('saving') : t('save'),
                ),
              ),
            )
          : null,
      )
    }

    /** Mount the card on the browser plugin's fiber. */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NAMESPACE, { zh, en }), `${NAMESPACE}: card copy`)
      ctx.effect(installStyles, `${NAMESPACE}: card styles`)

      const scope = ctx.settingsScope.bind({ namespace: NAMESPACE })

      ctx.slots.inject('settings.plugin.item', () =>
        ctx.slots.register(
          {
            name: 'settings.plugin.item',
            // The tab dispatches this card under the namespace the HOST serves.
            key: NAMESPACE,
            locale: NAMESPACE,
            inject: () => ({ scope, browse: directoryChooser(ctx) }),
          },
          Card,
        ),
      )
    }

    return { apply, inject, parsePaths }
  },
})
