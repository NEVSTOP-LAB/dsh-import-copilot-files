/**
 * The settings schema for this plugin's namespace.
 *
 * `z` arrives as an argument rather than an import: the only place that may
 * import `@deepseek-ai/schemastery` is the lazy loader in `index.js`, because a
 * bare import would make the package fail to load in a checkout with no
 * `node_modules` (and in any profile where the package cannot be resolved).
 * Taking it as a parameter also keeps the schema's shape testable offline.
 *
 * The schema has to be a REAL schemastery schema when it reaches the service:
 * the browser rebuilds it from `schema.toJSON()` (an `{ uid, refs }` envelope)
 * to render the card, and a hand-written envelope cannot be rebuilt — the
 * namespace then silently has no editable draft.
 *
 * The field set mirrors the row's `config`, because the composition entry is
 * the namespace's `base` layer and the resolved value is what discovery runs
 * on. Defaults come from `index.js`, so the two cannot drift apart.
 */

/**
 * @param z - the schemastery entry point (`import z from '@deepseek-ai/schemastery'`).
 * @param defaults - the composition defaults, from `index.js`.
 * @returns the schema resolving this plugin's namespace.
 */
export function settingsSchema(z, defaults) {
  return z.object({
    maxBytes: z.number().default(defaults.maxBytes),
    scanSubdirectories: z.number().default(defaults.scanSubdirectories),
    instructionDirs: z.array(z.string()).default(defaults.instructionDirs),
    skillDirs: z.array(z.string()).default(defaults.skillDirs),
    paths: z.array(z.string()).default(defaults.paths),
  })
}
