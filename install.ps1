#Requires -Version 5
<#
.SYNOPSIS
    Install (or remove) the import-vscode-ai-files row in a DSH profile patch layer.

.DESCRIPTION
    Writes one `insert` patch entry into <DshHome>/profiles/<Profile>/cordis.patch.yml
    naming this checkout's src/index.js by file URL, so every DSH session on that
    profile loads VSCode/Copilot AI configuration from its own workspace.

    The DSH profile patch layer is NOT hot-reloaded: restart DSH afterwards. The
    plugin's own source is cached by Node's ESM loader too, so editing src/*.js
    also needs a restart. Editing `.github/**` in a repository does NOT — the
    plugin re-reads those on every model step.

    Idempotent. Everything above the managed block is preserved verbatim, and the
    managed block is rebuilt from scratch on every run.

.EXAMPLE
    pwsh -File install.ps1
    pwsh -File install.ps1 -Profile web
    pwsh -File install.ps1 -Uninstall
#>
[CmdletBinding()]
param(
    [string] $Profile = 'desktop',
    [string] $DshHome = $(if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }),
    [switch] $Uninstall
)

$ErrorActionPreference = 'Stop'

$pluginPath = Join-Path $PSScriptRoot 'src\index.js'
if (-not (Test-Path -LiteralPath $pluginPath)) { throw "plugin entry not found: $pluginPath" }

$patchPath = Join-Path $DshHome "profiles\$Profile\cordis.patch.yml"
$profileDir = Split-Path -Parent $patchPath
if (-not (Test-Path -LiteralPath $profileDir)) { throw "profile directory not found: $profileDir" }

# Everything from the first of these markers on belongs to this script.
$begin = '# >>> dsh-import-vscode-ai-files (managed by install.ps1) >>>'
$end = '# <<< dsh-import-vscode-ai-files <<<'
$legacy = '# ── VSCode / Copilot AI configuration'

$existing = if (Test-Path -LiteralPath $patchPath) { Get-Content -LiteralPath $patchPath -Raw } else { '' }
$cut = $existing.Length
foreach ($marker in @($begin, $legacy)) {
    $index = $existing.IndexOf($marker)
    if ($index -ge 0 -and $index -lt $cut) { $cut = $index }
}
$kept = $existing.Substring(0, $cut).TrimEnd()

if ($Uninstall) {
    Set-Content -LiteralPath $patchPath -Value ($kept + "`n") -Encoding utf8 -NoNewline
    Write-Host "Removed the import-vscode-ai-files row from $patchPath"
    Write-Host 'Restart DSH for the change to take effect.'
    return
}

$url = ([uri]$pluginPath).AbsoluteUri
$block = @"
$begin
# Loads the workspace's own VSCode-style AI configuration into every session:
# ``.github/copilot-instructions.md``, ``.github/instructions/**/*.instructions.md``
# (honouring ``applyTo``) and ``.github/skills/<name>/SKILL.md``.
#
# Host plane on purpose: the plugin publishes no service, so registering it
# globally is what makes it apply to every session and preset.
#
# The DSH profile patch layer is NOT hot-reloaded. Restart DSH after changing
# this row, or after editing the plugin's own source.
- insert:
    - id: import-vscode-ai-files
      name: '$url'
      config:
        maxBytes: 65536
        scanSubdirectories: 1
$end
"@

Set-Content -LiteralPath $patchPath -Value ($kept + "`n`n" + $block) -Encoding utf8 -NoNewline
Write-Host "Installed the import-vscode-ai-files row into $patchPath"
Write-Host "  plugin: $url"
Write-Host 'Restart DSH for the change to take effect.'
