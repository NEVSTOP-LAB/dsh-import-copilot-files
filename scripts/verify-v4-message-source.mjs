/**
 * Verify THIS plugin's injected message against the installed harness's v4
 * admission, instead of trusting a hand-copied shape.
 *
 * Why it exists: session format v4 refuses the retired V3 plugin wrapper
 * `{ kind: 'plugin', plugin: <pkg> }` at write time with
 * `format v4 message requires a producer-owned source kind`. That write is the
 * step's own `session.append`, so the whole turn fails — and the offline suite
 * cannot see it, because the suite never runs the harness's format code. This
 * script drives the real plugin object, then hands the message it produces to
 * the real admission the writer runs.
 *
 * It needs a harness checkout but no running DSH, no session and no network:
 *
 *   node scripts/verify-v4-message-source.mjs
 *   DSH_APP=/path/to/resources/app node scripts/verify-v4-message-source.mjs
 *
 * `DSH_APP` defaults to this station's DSH Desktop install. Point it at any
 * folder whose `node_modules` carries `@deepseek-ai/dsh-session-format-v3-to-v4`
 * (a source checkout of the harness works too).
 *
 * Exit code is 0 only when all three hold: the produced source is admitted,
 * it restores as a full v4 artifact with `kind` / `changes` / text intact, and
 * the retired wrapper is still refused (the check is not blind).
 */
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join } from 'node:path'
import plugin from '../index.js'

const APP = process.env.DSH_APP ?? 'C:\\Users\\nevstop\\AppData\\Local\\Programs\\DSH Desktop\\resources\\app'

let assertV4RowAdmission
let releasedV4SessionFormatCodec
let restoreReleasedV4Artifact
try {
  const appRequire = createRequire(join(APP, 'package.json'))
  const resolve = (spec) => pathToFileURL(appRequire.resolve(spec, { paths: [APP] })).href
  ;({ assertV4RowAdmission, releasedV4SessionFormatCodec, restoreReleasedV4Artifact } = await import(
    resolve('@deepseek-ai/dsh-session-format-v3-to-v4')
  ))
} catch (error) {
  console.error(
    `cannot load @deepseek-ai/dsh-session-format-v3-to-v4 from ${APP} — point DSH_APP at a harness ` +
      `checkout with that package installed. Underlying error: ${error.message}`,
  )
  process.exit(2)
}

const WORKSPACE = fileURLToPath(new URL('../test/fixtures/workspace', import.meta.url))
const NO_HOME = join(process.env.TEMP ?? '.', 'copilot-ai-config-no-home')

// Drive the plugin exactly as the agent loop does.
const listeners = []
const agent = { id: 'session-verify', session: { header: { cwd: WORKSPACE } } }
plugin.apply(
  {
    skills: { registerProvider: () => () => {} },
    on: (name, listener) => {
      if (name === 'agent/pre-step') listeners.push(listener)
      return () => {}
    },
  },
  {},
  { homeDir: NO_HOME },
)
const payload = { agent, messages: [], turn: 1, step: 2, signal: undefined }
const base = { kind: 'accept', messages: [] }
let index = -1
const next = async () => {
  index += 1
  return index < listeners.length ? listeners[index](payload, next) : base
}
const decision = await next()
const message = decision.messages.at(-1)
if (message === undefined) {
  console.error('the plugin injected nothing for the fixture workspace — nothing to verify')
  process.exit(1)
}

console.log('injected source:', JSON.stringify(message.source))
console.log('content bytes  :', message.content[0].text.length)

const event = { seq: 9, type: 'user/message', data: message }
try {
  assertV4RowAdmission(event, new Set(['user/message']))
  console.log('ROW ADMISSION  : admitted')
} catch (error) {
  console.log('ROW ADMISSION  : REJECTED ->', error.message)
  process.exitCode = 1
}

// Restore it the way a reading session does: this runs the full v4 admission
// (header, vocabulary, message sources, relationships) over the event.
try {
  const header = releasedV4SessionFormatCodec.encodeHeader(
    {
      version: 4,
      id: 'session-verify',
      createdAt: Date.now(),
      cwd: WORKSPACE,
      isSeeded: false,
      delegationDepth: 0,
    },
    0,
  )
  // The surface marker a persisted row carries, exactly as the log writes it.
  const stored = { ...event, seq: 0, surfaceOp: 'append' }
  const artifact = restoreReleasedV4Artifact(
    { header: releasedV4SessionFormatCodec.decodeHeader(header), events: [stored], inheritedEventCount: 0 },
    new Set(['user/message']),
  )
  const back = artifact.events[0]
  console.log('ARTIFACT RESTORE: ok')
  console.log('  kind           =', JSON.stringify(back.data.source.kind))
  console.log('  changes        =', JSON.stringify(back.data.source.changes))
  console.log('  text preserved =', back.data.content[0].text === message.content[0].text)
  if (back.data.content[0].text !== message.content[0].text) process.exitCode = 1
} catch (error) {
  console.log('ARTIFACT RESTORE: FAILED ->', error.constructor.name + ': ' + error.message)
  process.exitCode = 1
}

// The retired shape, for contrast: proves this check can fail.
try {
  assertV4RowAdmission(
    {
      seq: 9,
      type: 'user/message',
      data: { ...message, source: { kind: 'plugin', plugin: 'import-copilot-files', form: 'instructions' } },
    },
    new Set(['user/message']),
  )
  console.log('RETIRED SHAPE  : admitted (the check would be blind!)')
  process.exitCode = 1
} catch (error) {
  console.log('RETIRED SHAPE  : rejected ->', error.message)
}
