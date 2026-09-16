#Requires -Version 5.1
<#
.SYNOPSIS
  Installs tudelft-mcp on Windows.

.DESCRIPTION
  irm https://danieltyukov.github.io/tudelft-mcp/install.ps1 | iex

  To skip client setup:
  iex "& { $(irm https://danieltyukov.github.io/tudelft-mcp/install.ps1) } -NoSetup"

  Set $env:TUDELFT_MCP_VERSION to install an exact version instead of the latest release.

  What it does: checks for Node.js 20 or newer, installs the package globally with npm
  (falling back to the GitHub release tarball when the package is not on the registry),
  writes the MCP config of the clients it finds, and tells you to run "tudelft-mcp login".
#>
param(
  [switch]$NoSetup
)

$ErrorActionPreference = 'Stop'

function Fail([string]$Message) {
  Write-Host "error: $Message" -ForegroundColor Red
  exit 1
}

function Show-NodeHint {
  Write-Host 'tudelft-mcp needs Node.js 20 or newer.'
  Write-Host 'Install it with:  winget install OpenJS.NodeJS.LTS'
  Write-Host 'or download the LTS installer from https://nodejs.org'
  Write-Host 'Then open a new terminal and run this installer again.'
}

# Runs a native command, returns its combined output, and leaves the exit code in $LASTEXITCODE.
function Invoke-Native([string]$Command, [string[]]$Arguments) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = & $Command @Arguments 2>&1 | ForEach-Object { "$_" }
    return ($output -join "`n")
  } finally {
    $ErrorActionPreference = $previous
  }
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Show-NodeHint
  exit 1
}
$major = 0
try { $major = [int](Invoke-Native 'node' @('-p', "process.versions.node.split('.')[0]")).Trim() } catch { $major = 0 }
if ($major -lt 20) {
  Write-Host "Found Node.js $(Invoke-Native 'node' @('--version')), which is too old."
  Show-NodeHint
  exit 1
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Fail 'npm was not found next to node. Reinstall Node.js from https://nodejs.org'
}

$package = 'tudelft-mcp'
$fallback = 'https://github.com/danieltyukov/tudelft-mcp/releases/latest/download/tudelft-mcp.tgz'
if ($env:TUDELFT_MCP_VERSION) {
  $package = "tudelft-mcp@$($env:TUDELFT_MCP_VERSION)"
  $fallback = "https://github.com/danieltyukov/tudelft-mcp/releases/download/v$($env:TUDELFT_MCP_VERSION)/tudelft-mcp.tgz"
}

Write-Host "Installing $package with npm. This can take a minute."
$output = Invoke-Native 'npm' @('install', '-g', $package)
if ($LASTEXITCODE -ne 0) {
  if ($output -match 'E404|404 Not Found') {
    Write-Host 'The package is not on the npm registry yet. Installing the GitHub release instead.'
    $output = Invoke-Native 'npm' @('install', '-g', $fallback)
    if ($LASTEXITCODE -ne 0) {
      Write-Host $output
      Fail "Installing from $fallback failed."
    }
  } else {
    Write-Host $output
    Fail 'npm install failed.'
  }
}

$bin = Get-Command tudelft-mcp -ErrorAction SilentlyContinue
if ($bin) {
  $binPath = $bin.Source
} else {
  $prefix = (Invoke-Native 'npm' @('prefix', '-g')).Trim()
  $binPath = Join-Path $prefix 'tudelft-mcp.cmd'
  if (-not (Test-Path $binPath)) {
    Fail "tudelft-mcp was installed but could not be found. Check 'npm prefix -g' and your PATH."
  }
  Write-Host "Note: $prefix is not on your PATH yet. Open a new terminal before running tudelft-mcp directly."
}
$version = (Invoke-Native $binPath @('--version')).Trim()
Write-Host "Installed tudelft-mcp $version."

if (-not $NoSetup) {
  Write-Host ''
  Write-Host 'Configuring the MCP clients found on this machine.'
  Invoke-Native $binPath @('setup', '--all') | Write-Host
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Setup did not finish. Run 'tudelft-mcp setup' later to try again."
  }
}

Write-Host ''
Write-Host "Next: run 'tudelft-mcp login' to sign in once with your NetID. A browser window opens for that."
Write-Host 'Then restart your MCP client (Claude Desktop, Cursor, ...) and ask it about your courses.'
