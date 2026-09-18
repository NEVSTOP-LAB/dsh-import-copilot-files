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
      save: '保存',
      discard: '放弃',
      reset: '恢复默认',
      saving: '保存中…',
      unsaved: '未保存',
      saveFailed: '保存失败，请重试或重新打开设置。',
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
      save: 'Save',
      discard: 'Discard',
      reset: 'Reset',
      saving: 'Saving…',
      unsaved: 'Unsaved',
      saveFailed: 'Save failed. Try again, or reopen the settings.',
      readOnly: 'This deployment is read-only; paths can only be set in the composition.',
    }

    const CSS = `
      .dsh-ivaf-card{list-style:none;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:12px 14px;color:var(--dsw-alias-label-primary)}
      .dsh-ivaf-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
      .dsh-ivaf-name{font-size:13.5px;font-weight:600}
      .dsh-ivaf-desc{font-size:12px;color:var(--dsw-alias-label-secondary)}
      .dsh-ivaf-tag{margin-left:auto;font-size:11px;color:var(--dsw-alias-state-warn-primary)}
      .dsh-ivaf-intro{margin:6px 0 10px;font-size:12px;color:var(--dsw-alias-label-secondary)}
      .dsh-ivaf-rows{margin:0;padding:0;display:flex;flex-direction:column;gap:6px;list-style:none}
      .dsh-ivaf-row{display:flex;align-items:center;gap:6px}
      .dsh-ivaf-input{flex:1;min-width:0;font:inherit;font-size:12.5px;padding:5px 8px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:6px}
      .dsh-ivaf-input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
      .dsh-ivaf-empty{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary)}
      .dsh-ivaf-actions{margin-top:8px;display:flex;gap:8px}
      .dsh-ivaf-button{font:inherit;font-size:12px;padding:4px 12px;cursor:pointer;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:6px}
      .dsh-ivaf-button:hover:enabled{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary)}
      .dsh-ivaf-button:disabled{cursor:default;opacity:.5}
      .dsh-ivaf-footer{margin-top:10px;display:flex;align-items:center;gap:8px;justify-content:flex-end}
      .dsh-ivaf-status{margin:0;margin-right:auto;font-size:12px;color:var(--dsw-alias-label-secondary)}
      .dsh-ivaf-status[data-tone="error"]{color:var(--dsw-alias-state-error-primary)}
      .dsh-ivaf-save{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary)}
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

    /** One editable path row: the input, an optional picker, and a remove action. */
    function PathRow(props) {
      const { t, index, value, disabled, browse, onEdit, onRemove } = props
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
                className: 'dsh-ivaf-button',
                disabled,
                onClick: () => {
                  void browse().then((picked) => {
                    if (typeof picked === 'string' && picked !== '') onEdit(index, picked)
                  })
                },
              },
              t('browse'),
            ),
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-ivaf-button',
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
        'li',
        { className: 'dsh-ivaf-card' },
        React.createElement(
          'div',
          { className: 'dsh-ivaf-head' },
          React.createElement('span', { className: 'dsh-ivaf-name' }, t('title')),
          React.createElement('span', { className: 'dsh-ivaf-desc' }, t('description')),
          dirty ? React.createElement('span', { className: 'dsh-ivaf-tag' }, t('unsaved')) : null,
        ),
        React.createElement('p', { className: 'dsh-ivaf-intro' }, t('intro')),
        !snapshot.writable
          ? React.createElement('p', { className: 'dsh-ivaf-status', role: 'status' }, t('readOnly'))
          : null,
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
                }),
              ),
            ),
        React.createElement(
          'div',
          { className: 'dsh-ivaf-actions' },
          React.createElement(
            'button',
            { type: 'button', className: 'dsh-ivaf-button', disabled: !editable, onClick: add },
            t('add'),
          ),
        ),
        React.createElement(
          'div',
          { className: 'dsh-ivaf-footer' },
          phase === 'failed'
            ? React.createElement(
                'p',
                { className: 'dsh-ivaf-status', role: 'status', 'data-tone': 'error' },
                t('saveFailed'),
              )
            : null,
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'dsh-ivaf-button',
              disabled: !dirty || phase === 'saving',
              onClick: discard,
            },
            t('discard'),
          ),
          overridden
            ? React.createElement(
                'button',
                {
                  type: 'button',
                  className: 'dsh-ivaf-button',
                  disabled: !editable,
                  onClick: () => {
                    void reset()
                  },
                },
                t('reset'),
              )
            : null,
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'dsh-ivaf-button dsh-ivaf-save',
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
            inject: () => {
              // Optional: the folder picker is a convenience, not a dependency.
              const picker = ctx.get('uiWorkspace')
              const browse =
                typeof picker?.pickDirectory === 'function' ? () => picker.pickDirectory() : undefined
              return { scope, browse }
            },
          },
          Card,
        ),
      )
    }

    return { apply, inject, parsePaths }
  },
})
