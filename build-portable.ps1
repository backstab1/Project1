param(
    [string]$OutputDirectory = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = $PSScriptRoot
$releaseRoot = Join-Path $projectRoot "release"

if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $releaseRoot "CineVault"
}

$releaseRootFull = [IO.Path]::GetFullPath($releaseRoot)
$outputFull = [IO.Path]::GetFullPath($OutputDirectory)

if (-not $outputFull.StartsWith($releaseRootFull, [StringComparison]::OrdinalIgnoreCase)) {
    throw "OutputDirectory must be located inside: $releaseRootFull"
}

if (Test-Path -LiteralPath $outputFull) {
    Remove-Item -LiteralPath $outputFull -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $outputFull | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $outputFull "docs") | Out-Null

Copy-Item -LiteralPath (Join-Path $projectRoot "index.html") -Destination $outputFull
Copy-Item -LiteralPath (Join-Path $projectRoot "launch.py") -Destination $outputFull
Copy-Item -LiteralPath (Join-Path $projectRoot "CineVault.cmd") -Destination $outputFull
Copy-Item -LiteralPath (Join-Path $projectRoot "README.md") -Destination $outputFull
Copy-Item -LiteralPath (Join-Path $projectRoot "src") -Destination $outputFull -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot "docs\IMPORT_FORMAT.md") `
    -Destination (Join-Path $outputFull "docs\IMPORT_FORMAT.md")

$zipPath = Join-Path $releaseRoot "CineVault-portable.zip"
if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}
Compress-Archive -Path (Join-Path $outputFull "*") `
    -DestinationPath $zipPath -CompressionLevel Optimal

Write-Host ""
Write-Host "Portable build created:"
Write-Host "  Folder: $outputFull"
Write-Host "  ZIP:    $zipPath"
Write-Host ""
Write-Host "Start the app with CineVault.cmd."
