$ErrorActionPreference = "Stop"

$candidates = @()

if (Get-Command node -ErrorAction SilentlyContinue) {
    $candidates += "node"
}

$bundledNode = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if (Test-Path $bundledNode) {
    $candidates += $bundledNode
}

$node = $null
foreach ($candidate in $candidates) {
    try {
        & $candidate --version | Out-Null
        $node = $candidate
        break
    } catch {
    }
}

if (-not $node) {
    throw "Node.js not found. Install Node.js or use the Codex bundled runtime."
}

$scriptPath = Join-Path $PSScriptRoot "server.mjs"
& $node $scriptPath @args
