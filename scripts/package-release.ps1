[CmdletBinding()]
param(
    [string]$RarPath = '',
    [string]$Configuration = 'Release'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$exe = Join-Path $root "WandEnhancer/bin/$Configuration/WandEnhancer.exe"
if (-not (Test-Path $exe)) { throw "Build $exe first with build.cmd on Windows." }
if (-not $RarPath) {
    $command = Get-Command rar.exe -ErrorAction SilentlyContinue
    if ($command) { $RarPath = $command.Source }
    elseif (Test-Path "$env:ProgramFiles/WinRAR/Rar.exe") { $RarPath = "$env:ProgramFiles/WinRAR/Rar.exe" }
    else { throw 'Install WinRAR or pass -RarPath to its Rar.exe.' }
}
$staging = Join-Path $root ".out/package-staging-$([Guid]::NewGuid().ToString('N'))"
$payload = Join-Path $staging 'WandEnhancer-Toolbox'
New-Item -ItemType Directory -Force -Path $payload | Out-Null
Copy-Item $exe (Join-Path $payload 'WandEnhancer.exe') -Force
Copy-Item (Join-Path $root 'packaging/README-RU.md') (Join-Path $payload 'README-RU.md') -Force
Copy-Item (Join-Path $root 'packaging/Start-ReadOnly.cmd') $payload -Force
Copy-Item (Join-Path $root 'LICENSE.md') $payload -Force
$archive = Join-Path $root '.out/WandEnhancer-Toolbox.rar'
# Recreate the archive so stale files from earlier releases cannot remain in it.
if (Test-Path $archive) { Remove-Item $archive -Force }
Push-Location $staging
try {
    & $RarPath a -r -m5 -idq $archive 'WandEnhancer-Toolbox'
    if ($LASTEXITCODE -ne 0) { throw "RAR creation failed: $LASTEXITCODE" }
    & $RarPath t -idq $archive
    if ($LASTEXITCODE -ne 0) { throw "RAR verification failed: $LASTEXITCODE" }
} finally {
    Pop-Location
    Remove-Item $staging -Recurse -Force
}
Get-FileHash -Algorithm SHA256 $archive | Format-List
Write-Output "Created $archive"
