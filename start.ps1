param([switch]$Login, [switch]$Doctor, [int]$Port = 4317)
$ErrorActionPreference = 'Stop'
$localConfig = Join-Path $PSScriptRoot '.local-tools.json'
$config = if (Test-Path -LiteralPath $localConfig) { Get-Content -Raw -LiteralPath $localConfig | ConvertFrom-Json }
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
$nodeExe = if ($nodeCmd) { $nodeCmd.Source } else { $config.node }
if (!$nodeExe -or !(Test-Path -LiteralPath $nodeExe)) { throw 'Install Node.js 24+ and rerun this launcher.' }
if ($config.kane -and (Test-Path -LiteralPath $config.kane)) { $env:RESTORE_DRILL_KANE = $config.kane }
Push-Location $PSScriptRoot
try {
  if ($Login -and $env:RESTORE_DRILL_KANE -match '\.[cm]?js$') { & $nodeExe $env:RESTORE_DRILL_KANE login --oauth }
  elseif ($Login) { & kane-cli login --oauth }
  elseif ($Doctor) { & $nodeExe cli.mjs doctor }
  else { & $nodeExe app.mjs --port $Port }
  $result = $LASTEXITCODE
} finally { Pop-Location }
exit $result
