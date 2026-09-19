# DSH-Import-VSCode-AI-Files

A DSH plugin that loads a workspace's own **VSCode / Copilot style AI configuration** into
**every** DeepSeek Harness session. The same `.github` files then drive both VSCode and DSH —
no second copy to maintain.

It can also load further paths that live **outside** the workspace, with exactly the same
rules — one shared set of rules feeding every repository.

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

`applyTo` follows VSCode's rule: patterns match **relative to the project root the file belongs
to** (not the workspace root), and support `**`, `*`, `?`, `{a,b}`, `[abc]`, comma-separated.

`SKILL.md` frontmatter means the same as it does for a native DSH skill:

- `disable-model-invocation: true` — keeps the skill out of the catalog (the model cannot see it,
  the user can still invoke it with `/name`)
- `user-invocable: false` — the user cannot invoke it with `/name`
- omitting either allows it; an unparseable spelling drops the skill with a warning

### Scan scope

The session cwd, plus the direct subdirectories `scanSubdirectories` levels below it (1 by
default), each contributing its own `.github/`. `.github/instructions/` is walked recursively
(depth capped at 4).

That is what makes a multi-repo folder such as `D:\NEVSTOP-LAB` work: the folder itself and every
repository directly under it contribute their own `.github`, without interfering. The ancestor
chain is deliberately not walked, and neither are deeper levels.

Each entry in `paths` is scanned by **exactly the same rule** — the path itself, then the same
number of levels below it. So "one shared set of rules outside every workspace" is a folder name
in `paths`. Paths may be absolute or relative to the session cwd, and a path that does not exist
contributes nothing rather than failing. Naming a directory the scan already reached does not walk
it a second time — a second visit would get a fresh depth budget and pull in one level the rule
does not allow; conversely, a path deeper than the cwd budget IS scanned when it is named, because
naming it is the request. Instructions reached through `paths` are labelled with their **absolute**
path (`..\..` chains say less), and `applyTo` still matches relative to each file's own project
root.

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
| `scanSubdirectories` | `1` | levels below the cwd treated as project roots (applied to each entry in `paths` too) |
| `instructionDirs` | `['.github/instructions']` | where `*.instructions.md` lives |
| `skillDirs` | `['.github/skills']` | where `<name>/SKILL.md` lives |
| `paths` | `[]` | extra project roots **outside** the workspace, scanned by the same rule as the cwd |

### Editing the paths in the Plugins page

`paths` is also a field of the plugin's settings namespace (`import-vscode-ai-files`), so the
card for this plugin appears under **Settings → Plugins → plugin configuration**: add, edit and
remove paths, then save, discard, or reset to the deployment default.

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
> Once installed, editing `.github/**` inside a repository takes effect **immediately** (it is
> re-read on every model step); only editing the plugin's own source needs another restart.

Uninstall:

```sh
dsh plugin --profile desktop remove dsh-import-vscode-ai-files
```

## License

MIT
