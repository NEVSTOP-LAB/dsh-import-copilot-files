# DSH-Import-VSCode-AI-Files

A DSH plugin that loads a workspace's own **VSCode / Copilot style AI configuration** into
**every** DeepSeek Harness session. The same `.github` files then drive both VSCode and DSH —
no second copy to maintain.

It can also load further **configuration directories** that live outside the workspace —
directories equivalent to a project's `.github` folder, with no `.github` of their own — one
shared set of rules feeding every repository.

> [!NOTE]
> The plugin only **reads** your workspace configuration, and it writes no workspace file. It
> additionally registers a DSH settings namespace (`import-vscode-ai-files`) so the extra paths
> can be edited in the GUI under **Settings → Plugins → plugin configuration**; that single
> field is what it writes, into DSH's own user settings document (`$DSH_HOME/settings.yaml`).

## Features

| File | Behaviour |
| --- | --- |
| `.github/copilot-instructions.md` | always injected — the equivalent of VSCode's repo-wide instructions |
| `.github/instructions/**/*.instructions.md` | scoped by the frontmatter `applyTo`: files without it are always injected; files with it are injected only once the session has actually looked at a matching file |
| `.github/skills/<name>/SKILL.md` | registered as DSH skills — `name` + `description` reach the skill catalog, the body loads on demand |

`applyTo` follows VSCode's rule: patterns match **relative to the root the file belongs to** — a
project root for the workspace walk, and the configured path itself for a `paths` entry — and
support `**`, `*`, `?`, `{a,b}`, `[abc]`, comma-separated.

`SKILL.md` frontmatter means the same as it does for a native DSH skill:

- `disable-model-invocation: true` — keeps the skill out of the catalog (the model cannot see it,
  the user can still invoke it with `/name`)
- `user-invocable: false` — the user cannot invoke it with `/name`
- omitting either allows it; an unparseable spelling drops the skill with a warning

### Scan scope

The unit of scanning is a **configuration directory** — one laid out like `.github`, holding
`copilot-instructions.md`, `instructions/` and `skills/`. Two things produce one.

The session cwd, plus the direct subdirectories `scanSubdirectories` levels below it (1 by
default): each of those is a **project root**, and its configuration directory is its `.github/`.
`.github/instructions/` is walked recursively (depth capped at 4).

That is what makes a multi-repo folder such as `D:\NEVSTOP-LAB` work: the folder itself and every
repository directly under it contribute their own `.github`, without interfering. The ancestor
chain is deliberately not walked, and neither are deeper levels.

Every entry in `paths` **is** a configuration directory itself — the `.github`-equivalent, with no
`.github` segment under it. `paths: [D:\shared-ai]` reads `D:\shared-ai\copilot-instructions.md`,
`D:\shared-ai\instructions\**` and `D:\shared-ai\skills\<name>\SKILL.md`. The entry's own walk never
reads a `.github` inside it; only when that directory is *also* reached by the cwd walk can its
`.github` be read — as a **project root's** `.github`, which is the cwd-side rule, the two sides
being independent. So "one shared set of
rules outside every workspace" is a folder name in `paths`. Each entry is exactly one configuration
directory, so `scanSubdirectories` does **not** apply to it: its subdirectories are content
(`instructions/`, `skills/`), not further configuration directories.

Paths may be absolute or relative to the session cwd, and a path that does not exist contributes
nothing rather than failing. A configuration directory the scan already read is not read again
(naming a project's own `.github` adds nothing). For a `paths` entry, `instructionDirs` /
`skillDirs` lose a leading `.github` segment — the default `.github/instructions` therefore means
`<path>/instructions`, while a directory that does not start with `.github` is joined as it is.
Instructions reached through `paths` are labelled with their **absolute** path (`..\..` chains say
less), and `applyTo` matches relative to that entry's own configuration directory.

**AGENTS.md is not this plugin's business**: it belongs to the DSH core
(`dsh-agent-instructions`), which reads it along the project-root-to-cwd ancestor chain. It is
therefore a current-working-directory concept, and neither `paths` nor a subdirectory root
contributes one.

## What you see in a session

| Injection panel | Source |
| --- | --- |
| **Instruction injection · `import-vscode-ai-files`** | the `.github` instructions, labelled from `source.plugin` |
| **Skill catalog** | the `.github/skills` entries whose `disable-model-invocation` is not `true` |

The order is fixed: **AGENTS.md first, the `.github` instructions after it**.

A change appends a new injection rather than rewriting the old one, and a file that disappears
produces an explicit `Instructions removed:` note instead of being dropped silently.

## Configuration

The plugin row lives in [`cordis.patch.yml`](./cordis.patch.yml); its `config` fields are:

| Field | Default | Meaning |
| --- | --- | --- |
| `maxBytes` | `65536` | per-injection byte budget; over it, files are omitted first and the last one truncated, with the loss stated in the body |
| `scanSubdirectories` | `1` | levels below the cwd treated as project roots (the cwd walk only) |
| `instructionDirs` | `['.github/instructions']` | where `*.instructions.md` lives, relative to a configuration directory (a `paths` entry drops the leading `.github`) |
| `skillDirs` | `['.github/skills']` | where `<name>/SKILL.md` lives (same rule) |
| `paths` | `[]` | configuration directories **outside** the workspace, equivalent to a project's `.github` (no `.github` under them) |

### Editing the paths in the Plugins page

`paths` is also a field of the plugin's settings namespace (`import-vscode-ai-files`), so the card
titled **Import VSCode AI Files** (in a Chinese UI, 导入 VSCode AI 文件) appears under
**Settings → Plugins → plugin configuration**: add, edit and
remove paths, then save, discard, or reset to the deployment default. The card has the same shape
as every other card on that page: a collapsed header that discloses the fields, the
add / browse / remove row, and discard / save in the footer.

- *Browse* opens a folder chooser through **whichever route the deployment can serve**: the DSH
  Desktop window uses its own Windows chooser, every other composition uses the host's native
  picker. Where neither exists the card says so and you type the path — a press never ends in
  silence.
- The card edits `paths` only; `maxBytes`, `scanSubdirectories`, `instructionDirs` and
  `skillDirs` stay composition-only.
- What it writes is DSH's own **user settings document** (the `import-vscode-ai-files:` section
  of `$DSH_HOME/settings.yaml`), never a workspace file; that document is hot-reloaded.
- Saving is **optimistic**: the card submits with the revision its draft started from, so a
  concurrent edit elsewhere is rejected with a retry prompt instead of being overwritten. After a
  save the card re-reads what the host answered rather than assuming the write landed.
- The composition `config` is this layer's **base**: *Discard* only forgets unsaved edits, while
  *Reset* (offered once the field is overridden) clears the user override, so the value falls back
  to `cordis.patch.yml`.
- Where no settings service is mounted (rare), the plugin runs on the composition config alone —
  it just has no card.

## Install

Requires the [dsh CLI](https://github.com/deepseek-ai/deepseek-harness).

From the GitHub repository:

```sh
dsh plugin --profile desktop add github:NEVSTOP-LAB/dsh-import-vscode-ai-files
```

> [!NOTE]
> `--profile web` is the default profile. DSH Desktop uses `--profile desktop`; any other
> profile is whatever its directory is named.

Pin a commit so a later update cannot change what runs:

```sh
dsh plugin --profile desktop add github:NEVSTOP-LAB/dsh-import-vscode-ai-files#<commit-sha>
```

Or install the tarball from [Releases](https://github.com/NEVSTOP-LAB/dsh-import-vscode-ai-files/releases):

```sh
dsh plugin --profile desktop add ./dsh-import-vscode-ai-files-0.1.0.tgz
```

Confirm the row reached the composition:

```sh
dsh --profile desktop --dump-config
```

> [!IMPORTANT]
> DSH's profile patch layer is **not hot-reloaded** — restart DSH after installing.
> Once installed, editing `.github/**` inside a repository — or the files under a configured
> `paths` entry — takes effect **immediately** (it is re-read on every model step); only editing
> the plugin's own source needs another restart.

Uninstall:

```sh
dsh plugin --profile desktop remove dsh-import-vscode-ai-files
```

## License

MIT
