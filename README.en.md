# dsh-import-copilot-files

A DSH plugin that loads a workspace's own **VSCode / Copilot style AI configuration** (`.github/`)
into **every** DSH session, so one copy drives both VSCode and DSH. It can also carry
**configuration directories outside the workspace**, one shared set of rules for every repository —
**the current user's `~/.copilot`** (the Copilot CLI's home) is included by default.

The plugin only **reads** configuration and writes no workspace file; the one write path is the GUI
page that edits the extra configuration directories, into DSH's own profile configuration
(`~/.dsh/profiles/<profile>/cordis.patch.yml`).

## Features

| File | Behaviour |
| --- | --- |
| `.github/copilot-instructions.md` | always injected — VSCode's repo-wide instructions |
| `.github/instructions/**/*.instructions.md` | scoped by the frontmatter `applyTo`: without it always injected; with it injected only once the session has actually looked at a matching file |
| `.github/skills/<name>/SKILL.md` | registered as DSH skills: `name` + `description` reach the catalog, the body loads on demand |

`applyTo` uses VSCode's syntax (`**`, `*`, `?`, `{a,b}`, `[abc]`, comma-separated) and matches
**relative to the root the file belongs to**: a project root on the workspace side, the entry itself
for a `paths` entry. `SKILL.md`'s `disable-model-invocation` / `user-invocable` mean what they mean
for a native DSH skill; omitting either allows it, an unparseable spelling drops the skill with a
warning.

## Scan scope

The session cwd, plus the direct subdirectories `scanSubdirectories` levels below it (1 by default),
each contributing its own `.github/` (`.github/instructions/` is walked to depth 4). The ancestor
chain is deliberately not walked. That is what makes a multi-repo folder such as `D:\NEVSTOP-LAB`
work: the folder itself and every repository directly under it contribute their own `.github`,
without interfering.

Every entry in `paths` **is** a configuration directory itself — the `.github`-equivalent, with no
`.github` under it — so `scanSubdirectories` does not apply to it. Paths may be absolute, relative
to the session cwd, or **start with `~` for the home directory** (only a *leading* `~` means that;
`~name` and `a/~/b` are ordinary relative paths, and neither environment variables nor wildcards are
expanded). A path that does not exist contributes nothing. The default is `['~/.copilot']`; remove
that row in the Plugins page and save `paths: []` to turn it off.

**AGENTS.md is not this plugin's business**: it belongs to the DSH core (`dsh-agent-instructions`),
read along the cwd ancestor chain.

## What you see in a session

One injection row titled "Context injection" and labelled `import-copilot-files`, plus the skills of
those configuration directories whose `disable-model-invocation` is not `true`. The order is fixed:
**AGENTS.md first**. A change appends a new injection rather than rewriting the old one, and a file
that disappears produces an explicit `Instructions removed:` note.

## Configuration

The plugin row lives in [`cordis.patch.yml`](./cordis.patch.yml); its `config` fields are:

| Field | Default | Meaning |
| --- | --- | --- |
| `maxBytes` | `65536` | per-injection byte budget; over it, files are omitted first and the last one truncated, with the loss stated |
| `scanSubdirectories` | `1` | levels below the cwd treated as project roots (the cwd walk only) |
| `instructionDirs` | `['.github/instructions']` | where `*.instructions.md` lives, relative to a configuration directory (a `paths` entry drops the leading `.github`) |
| `skillDirs` | `['.github/skills']` | where `<name>/SKILL.md` lives (same rule) |
| `paths` | `['~/.copilot']` | configuration directories **outside** the workspace, equivalent to a project's `.github`; a leading `~` is the home directory |

### Editing the paths in the Plugins page

The entry titled **Import Copilot Files** (in a Chinese UI, 导入 Copilot 文件) under
**Settings → Plugins** adds, edits and removes `paths`, and saves, discards
or resets to the deployment default; `maxBytes`, `scanSubdirectories`, `instructionDirs` and
`skillDirs` stay composition-only.

- What it writes is **the profile's own configuration layer** — the `config.paths` of this entry in
  `~/.dsh/profiles/<profile>/cordis.patch.yml`, the block that appears under the plugin row — never
  a workspace file; the composition `config` is this layer's base, so *Reset* clears the user
  override. Saving is **optimistic** — the page submits with the revision its draft started from, a
  concurrent edit is rejected with a retry prompt, and the page re-reads what the host answered. The
  change takes effect from the next model step.
- *Browse* uses **whichever route the deployment can serve** (the DSH Desktop window uses its own
  Windows chooser, other compositions the host's native picker); where the deployment has no route
  the page shows no *Browse* button and the path is typed.

## Install

Requires the [dsh CLI](https://github.com/deepseek-ai/deepseek-harness). `--profile web` is the
default profile; DSH Desktop uses `--profile desktop`.

```sh
dsh plugin --profile desktop add github:NEVSTOP-LAB/dsh-import-copilot-files
dsh plugin --profile desktop add github:NEVSTOP-LAB/dsh-import-copilot-files#<commit-sha>  # pin a commit
dsh plugin --profile desktop add ./dsh-import-copilot-files-0.2.0.tgz   # or the tarball from a Release
dsh --profile desktop --dump-config                                     # confirm the row is in the composition
dsh plugin --profile desktop remove dsh-import-copilot-files            # uninstall
```

> [!IMPORTANT]
> The profile patch layer is **not hot-reloaded** — restart DSH after installing. Afterwards,
> editing `.github/**` in a repository or a file under a `paths` entry takes effect **immediately**
> (it is re-read on every model step); only editing the plugin's own source needs another restart.

> [!WARNING]
> Requires **DSH ≥ 0.1.7** (measured on Desktop 2.0.14 / dsh `0.1.7-rc.1`). That release rebuilt the
> settings chain — a plugin's own `Config` schema is its settings document, addressed by Loader
> entry id — and this version implements the new shape, so it is **not compatible with 0.1.5 /
> 0.1.6** (use the previous tag there). If you installed on an older version and saved `paths`, that
> value is stranded in `~/.dsh/settings.yaml.imported` and is not migrated automatically; how to
> write it back into `cordis.patch.yml` is in
> [docs/compatibility.md §3.7](./docs/compatibility.md).

### The peer-dependency warning during installation

`dsh plugin add` passes pnpm's output through verbatim, so **any** plugin in the profile that
under-declares a peer dependency makes it appear. **It is not about this plugin** — every host
package this plugin uses is an optional peer. To see who is actually short, run
`cd $DSH_HOME/profiles/<profile> && pnpm peers check`; those belong to those packages and do not
affect this one.

## More documentation

- [Releases](https://github.com/NEVSTOP-LAB/dsh-import-copilot-files/releases) — tarballs and version history
- [CONTRIBUTING.md](./CONTRIBUTING.md) — how to contribute and submit changes
- [docs/design.md](./docs/design.md) — architecture, mechanisms, source layout, known limits
- [docs/compatibility.md](./docs/compatibility.md) — dependency surface, DSH seams, upgrade checklist, verification records
- [docs/development.md](./docs/development.md) — local checks, tests and manual verification, packaging and release
- [docs/pitfalls.md](./docs/pitfalls.md) — development pitfalls
- [CHANGELOG.md](./CHANGELOG.md) — changes per release

## License

MIT
