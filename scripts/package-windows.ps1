$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
Push-Location -LiteralPath $taskRoot
try {
    & npm.cmd run tauri build
    if ($LASTEXITCODE -ne 0) { throw 'Tauri build failed.' }
    $taskVersion = (Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json).version
    $taskPortable = Join-Path $taskRoot 'release/portable'
    New-Item -ItemType Directory -Path $taskPortable -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $taskRoot 'src-tauri/target/release/exchange-tools.exe') -Destination (Join-Path $taskPortable 'exchange-tools.exe') -Force
    Copy-Item -LiteralPath (Join-Path $taskRoot 'release-notes.txt') -Destination (Join-Path $taskPortable '使用说明.txt') -Force
    $taskZip = Join-Path $taskRoot "release/exchange-tools-$taskVersion-windows-x64-portable.zip"
    Compress-Archive -LiteralPath (Join-Path $taskPortable 'exchange-tools.exe'), (Join-Path $taskPortable '使用说明.txt') -DestinationPath $taskZip -Force
    $taskInstaller = Get-ChildItem -LiteralPath (Join-Path $taskRoot 'src-tauri/target/release/bundle/nsis') -Filter "*${taskVersion}*setup.exe" | Select-Object -First 1
    if ($null -eq $taskInstaller) { throw 'NSIS installer was not generated.' }
    Copy-Item -LiteralPath $taskInstaller.FullName -Destination (Join-Path $taskRoot "release/exchange-tools-$taskVersion-windows-x64-setup.exe") -Force
    Get-ChildItem -LiteralPath $taskPortable, (Join-Path $taskRoot 'release') -File | Select-Object FullName, Length
}
finally { Pop-Location }
