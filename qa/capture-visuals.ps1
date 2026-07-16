param(
    [string]$Python = "python",
    [int]$AppPort = 18775,
    [int]$DebugPort = 9225
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseRoot = Join-Path $projectRoot "release"
$profileRoot = Join-Path $releaseRoot "qa-cdp-profile-$DebugPort"
$edgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$appBaseUrl = "http://127.0.0.1:$AppPort"

function Send-CdpCommand {
    param(
        [System.Net.WebSockets.ClientWebSocket]$Socket,
        [int]$Id,
        [string]$Method,
        [hashtable]$Params = @{}
    )

    $json = @{ id = $Id; method = $Method; params = $Params } |
        ConvertTo-Json -Depth 20 -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    $segment = [ArraySegment[byte]]::new($bytes)
    $null = $Socket.SendAsync(
        $segment,
        [System.Net.WebSockets.WebSocketMessageType]::Text,
        $true,
        [Threading.CancellationToken]::None
    ).GetAwaiter().GetResult()

    while ($true) {
        $stream = [IO.MemoryStream]::new()
        do {
            $buffer = [byte[]]::new(65536)
            $result = $Socket.ReceiveAsync(
                [ArraySegment[byte]]::new($buffer),
                [Threading.CancellationToken]::None
            ).GetAwaiter().GetResult()
            $stream.Write($buffer, 0, $result.Count)
        } while (-not $result.EndOfMessage)

        $response = [Text.Encoding]::UTF8.GetString($stream.ToArray()) |
            ConvertFrom-Json
        $stream.Dispose()
        if ($response.id -eq $Id) {
            if ($response.error) {
                throw "CDP $Method failed: $($response.error.message)"
            }
            return $response.result
        }
    }
}

function Wait-ForExpression {
    param(
        [System.Net.WebSockets.ClientWebSocket]$Socket,
        [ref]$CommandId,
        [string]$Expression,
        [int]$Attempts = 60
    )

    for ($attempt = 0; $attempt -lt $Attempts; $attempt++) {
        $CommandId.Value++
        $result = Send-CdpCommand $Socket $CommandId.Value "Runtime.evaluate" @{
            expression = "Boolean($Expression)"
            returnByValue = $true
        }
        if ($result.result.value -eq $true) {
            return
        }
        Start-Sleep -Milliseconds 250
    }
    throw "Page condition timed out: $Expression"
}

if (-not (Test-Path -LiteralPath $edgePath)) {
    throw "Microsoft Edge not found: $edgePath"
}

New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null
$server = Start-Process -FilePath $Python `
    -ArgumentList "launch.py", "--port", "$AppPort", "--no-browser" `
    -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
$edge = $null
$socket = $null

try {
    $serverReady = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        try {
            $health = Invoke-RestMethod "$appBaseUrl/api/health" -TimeoutSec 1
            if ($health.status -eq "ok") {
                $serverReady = $true
                break
            }
        } catch {
            Start-Sleep -Milliseconds 200
        }
    }
    if (-not $serverReady) {
        throw "CineVault server did not start."
    }

    $edge = Start-Process -FilePath $edgePath -ArgumentList @(
        "--headless",
        "--disable-gpu",
        "--hide-scrollbars",
        "--no-first-run",
        "--window-size=1366,768",
        "--remote-debugging-port=$DebugPort",
        "--user-data-dir=`"$profileRoot`"",
        "about:blank"
    ) -WindowStyle Hidden -PassThru

    $version = $null
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        try {
            $version = Invoke-RestMethod "http://127.0.0.1:$DebugPort/json/version" -TimeoutSec 1
            if ($version.webSocketDebuggerUrl) { break }
        } catch {
            Start-Sleep -Milliseconds 200
        }
    }
    if (-not $version.webSocketDebuggerUrl) {
        throw "Edge debugging endpoint did not start."
    }

    $tabs = Invoke-RestMethod "http://127.0.0.1:$DebugPort/json/list"
    $tab = $tabs | Where-Object { $_.type -eq "page" } | Select-Object -First 1
    if (-not $tab.webSocketDebuggerUrl) {
        throw "Edge page target was not found."
    }

    $socket = [System.Net.WebSockets.ClientWebSocket]::new()
    $null = $socket.ConnectAsync(
        [Uri]$tab.webSocketDebuggerUrl,
        [Threading.CancellationToken]::None
    ).GetAwaiter().GetResult()
    $commandId = 0

    $commandId++
    Send-CdpCommand $socket $commandId "Page.enable" | Out-Null
    $commandId++
    Send-CdpCommand $socket $commandId "Runtime.enable" | Out-Null
    $commandId++
    Send-CdpCommand $socket $commandId "Emulation.setDeviceMetricsOverride" @{
        width = 1366
        height = 768
        deviceScaleFactor = 1
        mobile = $false
    } | Out-Null

    $commandId++
    Send-CdpCommand $socket $commandId "Page.navigate" @{
        url = "$appBaseUrl/qa/seed.html"
    } | Out-Null
    Wait-ForExpression $socket ([ref]$commandId) `
        "location.pathname === '/' && document.querySelector('.app-shell')"

    $views = @("dashboard", "catalog", "categories", "franchises", "watched", "wheel")

    foreach ($view in $views) {
        $commandId++
        Send-CdpCommand $socket $commandId "Page.navigate" @{
            url = "$appBaseUrl/#$view"
        } | Out-Null
        Wait-ForExpression $socket ([ref]$commandId) `
            "document.querySelector('.navigation__item[data-view=$view]')?.classList.contains('is-active') && document.querySelector('h1')"

        if ($view -eq "catalog") {
            Wait-ForExpression $socket ([ref]$commandId) `
                "document.querySelectorAll('.movie-card').length === 10"
        }

        $commandId++
        $layout = Send-CdpCommand $socket $commandId "Runtime.evaluate" @{
            expression = "({width: innerWidth, scrollWidth: document.documentElement.scrollWidth})"
            returnByValue = $true
        }
        if ($layout.result.value.width -ne 1366) {
            throw "Unexpected viewport width for ${view}: $($layout.result.value.width)"
        }
        if ($layout.result.value.scrollWidth -gt $layout.result.value.width) {
            throw "Horizontal overflow in ${view}: $($layout.result.value.scrollWidth)px"
        }

        $commandId++
        $capture = Send-CdpCommand $socket $commandId "Page.captureScreenshot" @{
            format = "png"
            fromSurface = $true
            captureBeyondViewport = $false
        }
        $outputPath = Join-Path $releaseRoot "qa-filled-$view-verified.png"
        [IO.File]::WriteAllBytes($outputPath, [Convert]::FromBase64String($capture.data))
        Write-Host "Captured $view without horizontal overflow: $outputPath"
    }

    $commandId++
    Send-CdpCommand $socket $commandId "Browser.close" | Out-Null
} finally {
    if ($socket) { $socket.Dispose() }
    if ($edge -and -not $edge.HasExited) {
        Stop-Process -Id $edge.Id -Force -ErrorAction SilentlyContinue
    }
    if (-not $server.HasExited) {
        Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
    }
}
