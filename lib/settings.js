/**
 * This plugin's `Config` schema — which is also the settings form the GUI
 * serves for it.
 *
 * Since dsh `0.1.7` there is no settings-namespace registration to call: a
 * plugin's own `Config` schema IS its settings document, addressed by the
 * **Loader entry id**, and `dsh-settings` derives an editable form from the
 * fields that carry `meta.volatile`. A schema with no volatile field produces no
 * form at all — the entry then simply has no page, and the browser card that
 * claims the namespace never registers.
 *
 * `z` arrives as an argument rather than an import: the only place that may
 * load `@deepseek-ai/schemastery` is the lazy resolver in `index.js`, because a
 * bare import would make the package fail to load in a checkout with no
 * `node_modules` (and in any profile where the package cannot be resolved).
 * Taking it as a parameter also keeps the schema's shape testable offline.
 *
 * The schema has to be a REAL schemastery schema when it reaches the loader:
 * the browser rebuilds it from `schema.toJSON()` (a `{ uid, refs }` envelope)
 * to render the page, and a hand-written envelope cannot be rebuilt — the
 * namespace then silently has no editable draft.
 *
 * `paths` is the one field the GUI edits, so it is the one field that must be
 * editable **in place**: `dsh-settings` projects the form from the volatile
 * fields alone, which is what keeps the card from claiming the four
 * composition-only knobs. Marking it volatile also makes its resolved value a
 * live reference (`createVolatile`), so `index.js` reads through `.get()` and a
 * committed change reaches discovery without remounting the plugin.
 *
 * The field set mirrors the row's `config`, because the composition entry is
 * the form's `base` layer and the resolved value is what discovery runs on.
 * Defaults come from `index.js`, so the two cannot drift apart.
 */

/**
 * Mark one field as editable through the settings form.
 *
 * The marker is `meta.volatile` — the property `dsh-settings` reads in
 * `volatileForm()` / `isVolatilePath()`. Schemastery exposes two spellings of
 * it: the `.volatile()` helper on the builds that define it, and the generic
 * `.extra(key, value)` that helper is implemented with. Both write the same
 * `meta` property, and a profile resolves whichever `@deepseek-ai/schemastery`
 * copy its own `node_modules` holds, so neither spelling can be assumed.
 *
 * @param field - the schema node to mark.
 * @returns the marked schema, which schemastery returns as a copy.
 */
function volatile(field) {
  return typeof field.volatile === 'function'
    ? field.volatile()
    : field.extra('volatile', true)
}

/**
 * @param z - the schemastery entry point (`import z from '@deepseek-ai/schemastery'`).
 * @param defaults - the composition defaults, from `index.js`.
 * @returns the schema resolving this plugin's Config, and the entry's form.
 */
export function settingsSchema(z, defaults) {
  return z.object({
    maxBytes: z.number().default(defaults.maxBytes),
    scanSubdirectories: z.number().default(defaults.scanSubdirectories),
    instructionDirs: z.array(z.string()).default(defaults.instructionDirs),
    skillDirs: z.array(z.string()).default(defaults.skillDirs),
    paths: volatile(z.array(z.string()).default(defaults.paths)),
  })
}
