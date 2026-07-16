param(
    [string]$Python = "python"
)

$ErrorActionPreference = "Stop"
$projectRoot = $PSScriptRoot
$releaseRoot = Join-Path $projectRoot "release"
$workRoot = Join-Path $releaseRoot "pyinstaller-work"
$distRoot = Join-Path $releaseRoot "windows-dist"
$packageRoot = Join-Path $releaseRoot "CineVault-Windows"
$zipPath = Join-Path $releaseRoot "CineVault-Windows.zip"

New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null

foreach ($target in @($workRoot, $distRoot, $packageRoot)) {
    $fullTarget = [IO.Path]::GetFullPath($target)
    $fullRelease = [IO.Path]::GetFullPath($releaseRoot)
    if (-not $fullTarget.StartsWith($fullRelease, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Build target must be inside $fullRelease"
    }
    if (Test-Path -LiteralPath $fullTarget) {
        Remove-Item -LiteralPath $fullTarget -Recurse -Force
    }
}

& $Python -m PyInstaller `
    --noconfirm `
    --clean `
    --onefile `
    --name CineVault `
    --distpath $distRoot `
    --workpath $workRoot `
    --specpath $workRoot `
    --add-data "$(Join-Path $projectRoot 'index.html');." `
    --add-data "$(Join-Path $projectRoot 'src');src" `
    (Join-Path $projectRoot "launch.py")

if ($LASTEXITCODE -ne 0) {
    throw "PyInstaller failed with exit code $LASTEXITCODE"
}

New-Item -ItemType Directory -Force -Path $packageRoot | Out-Null
Copy-Item -LiteralPath (Join-Path $distRoot "CineVault.exe") -Destination $packageRoot
Copy-Item -LiteralPath (Join-Path $projectRoot "CineVault.cmd") -Destination $packageRoot
Copy-Item -LiteralPath (Join-Path $projectRoot "README.md") -Destination $packageRoot

if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}
Compress-Archive -Path (Join-Path $packageRoot "*") -DestinationPath $zipPath -CompressionLevel Optimal

Write-Host ""
Write-Host "Standalone Windows build created:"
Write-Host "  EXE: $(Join-Path $packageRoot 'CineVault.exe')"
Write-Host "  ZIP: $zipPath"
