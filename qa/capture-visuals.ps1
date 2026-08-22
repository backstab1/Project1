param(
    [string]$Python = "python",
    [int]$AppPort = 18775,
    [int]$DebugPort = 9225
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseRoot = Join-Path $projectRoot "release"
$shotRoot = Join-Path $releaseRoot "qa-shots"
$profileRoot = Join-Path $releaseRoot "qa-cdp-profile-$DebugPort"
$edgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$appBaseUrl = "http://127.0.0.1:$AppPort"

$script:socket = $null
$script:commandId = 0

# Every shell view. The value is an extra readiness condition for that view.
$viewChecks = [ordered]@{
    dashboard  = $null
    catalog    = "document.querySelectorAll('.movie-card, .movie-row').length > 0"
    franchises = $null
    categories = $null
    watched    = $null
    wheel      = $null
    sessions   = $null
    insights   = "document.querySelector('.status-split, .empty')"
    settings   = $null
}

function Send-CdpCommand {
    param([string]$Method, [hashtable]$Params = @{})

    $script:commandId++
    $id = $script:commandId
    $json = @{ id = $id; method = $Method; params = $Params } |
        ConvertTo-Json -Depth 20 -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    $null = $script:socket.SendAsync(
        [ArraySegment[byte]]::new($bytes),
        [System.Net.WebSockets.WebSocketMessageType]::Text,
        $true,
        [Threading.CancellationToken]::None
    ).GetAwaiter().GetResult()

    while ($true) {
        $stream = [IO.MemoryStream]::new()
        do {
            $buffer = [byte[]]::new(65536)
            $result = $script:socket.ReceiveAsync(
                [ArraySegment[byte]]::new($buffer),
                [Threading.CancellationToken]::None
            ).GetAwaiter().GetResult()
            $stream.Write($buffer, 0, $result.Count)
        } while (-not $result.EndOfMessage)

        $response = [Text.Encoding]::UTF8.GetString($stream.ToArray()) | ConvertFrom-Json
        $stream.Dispose()
        if ($response.id -eq $id) {
            if ($response.error) {
                throw "CDP $Method failed: $($response.error.message)"
            }
            return $response.result
        }
    }
}

function Invoke-Eval {
    param([string]$Expression)

    $result = Send-CdpCommand "Runtime.evaluate" @{
        expression = $Expression
        returnByValue = $true
        awaitPromise = $true
    }
    if ($result.exceptionDetails) {
        throw "Browser expression failed: $($result.exceptionDetails.text)"
    }
    return $result.result.value
}

function Wait-For {
    param([string]$Expression, [int]$Attempts = 60)

    for ($attempt = 0; $attempt -lt $Attempts; $attempt++) {
        $result = Send-CdpCommand "Runtime.evaluate" @{
            expression = "Boolean($Expression)"
            returnByValue = $true
        }
        if ($result.result.value -eq $true) { return }
        Start-Sleep -Milliseconds 250
    }
    throw "Page condition timed out: $Expression"
}

function Wait-ForPosters {
    # A poster that fails to load is swapped for initials, and an unreachable
    # host can take seconds to fail. Screenshots must wait for that to settle.
    Invoke-Eval @"
(async () => {
  // Lazy posters outside the viewport never start loading, so only the ones
  // that are actually on screen are worth waiting for.
  const onScreen = () => [...document.querySelectorAll('img[data-poster-fallback]')]
    .filter((image) => {
      const box = image.getBoundingClientRect();
      return box.bottom > 0 && box.top < innerHeight && box.width > 0;
    });
  for (let attempt = 0; attempt < 60; attempt++) {
    if (onScreen().every((image) => image.complete)) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
})()
"@ | Out-Null
}

function Wait-ForAnimations {
    # Content animates in with a stagger, so a screenshot taken right after the
    # markup appears would capture half-transparent cards.
    Invoke-Eval @"
(async () => {
  const animations = document.getAnimations().filter((animation) =>
    (animation.effect?.getTiming?.().iterations ?? 1) !== Infinity);
  await Promise.race([
    Promise.all(animations.map((animation) => animation.finished.catch(() => {}))),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return true;
})()
"@ | Out-Null
}

function Save-Screenshot {
    param([string]$Name)

    Wait-ForPosters
    Wait-ForAnimations
    $capture = Send-CdpCommand "Page.captureScreenshot" @{
        format = "png"
        fromSurface = $true
        captureBeyondViewport = $false
    }
    $outputPath = Join-Path $shotRoot "$Name.png"
    [IO.File]::WriteAllBytes($outputPath, [Convert]::FromBase64String($capture.data))
    return $outputPath
}

function Set-Viewport {
    param([ValidateSet("desktop", "mobile")][string]$Device)

    if ($Device -eq "desktop") {
        Send-CdpCommand "Emulation.setDeviceMetricsOverride" @{
            width = 1366; height = 768; deviceScaleFactor = 1; mobile = $false
        } | Out-Null
        return 1366
    }

    Send-CdpCommand "Emulation.setDeviceMetricsOverride" @{
        width = 390; height = 844; deviceScaleFactor = 2; mobile = $true
    } | Out-Null
    return 390
}

function Assert-NoHorizontalOverflow {
    param([string]$Label, [int]$ExpectedWidth)

    $layout = Invoke-Eval "({width: innerWidth, scrollWidth: document.documentElement.scrollWidth})"
    if ($layout.width -ne $ExpectedWidth) {
        throw "Unexpected viewport width for ${Label}: $($layout.width)"
    }
    if ($layout.scrollWidth -gt $layout.width) {
        throw "Horizontal overflow in ${Label}: $($layout.scrollWidth)px"
    }
}

function Assert-ModalFitsViewport {
    $fits = Invoke-Eval @"
(() => {
  const surface = document.querySelector('dialog[open] .modal__surface');
  if (!surface) return false;
  const box = surface.getBoundingClientRect();
  return box.left >= 0 && box.top >= 0 && box.right <= innerWidth &&
    box.bottom <= innerHeight && surface.scrollWidth <= surface.clientWidth;
})()
"@
    if ($fits -ne $true) {
        throw "Open dialog does not fit the current viewport."
    }
}

function Assert-NoConsoleErrors {
    param([string]$Label)

    $errors = Invoke-Eval "(window.__qaErrors ?? []).join(' | ')"
    if ($errors) {
        throw "Console errors in ${Label}: $errors"
    }
}

function Open-View {
    param([string]$View, [switch]$SkipContentCheck)

    Send-CdpCommand "Page.navigate" @{ url = "$appBaseUrl/#$View" } | Out-Null
    # The active marker lives on the sidebar item, the CV brand and the tabbar.
    Wait-For "document.querySelector('[data-view=$View].is-active') && document.querySelector('h1')"
    $extraCheck = $viewChecks[$View]
    # An empty library has no content conditions: an empty state is expected there.
    if ($extraCheck -and -not $SkipContentCheck) { Wait-For $extraCheck }
}

function Set-Theme {
    param([ValidateSet("light", "dark")][string]$Theme)

    Invoke-Eval "localStorage.setItem('cinevault-theme', '$Theme')" | Out-Null
    Send-CdpCommand "Page.reload" @{ ignoreCache = $false } | Out-Null
    Wait-For "document.documentElement.dataset.theme === '$Theme' && document.querySelector('.app')"
}

function Invoke-ViewSweep {
    param(
        [string]$State,
        [string]$Theme,
        [ValidateSet("desktop", "mobile")][string]$Device,
        [string[]]$Views,
        [switch]$SkipContentCheck
    )

    $expectedWidth = Set-Viewport $Device
    foreach ($view in $Views) {
        Open-View $view -SkipContentCheck:$SkipContentCheck
        Assert-NoHorizontalOverflow "$State/$Theme/$Device/$view" $expectedWidth
        Assert-NoConsoleErrors "$State/$Theme/$Device/$view"
        $path = Save-Screenshot "qa-$State-$Theme-$Device-$view"
        Write-Host "  $view -> $(Split-Path -Leaf $path)"
    }
}

if (-not (Test-Path -LiteralPath $edgePath)) {
    throw "Microsoft Edge not found: $edgePath"
}

New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null
New-Item -ItemType Directory -Force -Path $shotRoot | Out-Null
# The empty state is only meaningful on a clean browser profile.
if (Test-Path -LiteralPath $profileRoot) {
    Remove-Item -LiteralPath $profileRoot -Recurse -Force
}

$server = Start-Process -FilePath $Python `
    -ArgumentList "launch.py", "--port", "$AppPort", "--no-browser" `
    -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
$edge = $null

try {
    $serverReady = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        try {
            $health = Invoke-RestMethod "$appBaseUrl/api/health" -TimeoutSec 1
            if ($health.status -eq "ok") { $serverReady = $true; break }
        } catch {
            Start-Sleep -Milliseconds 200
        }
    }
    if (-not $serverReady) { throw "CineVault server did not start." }

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
    if (-not $version.webSocketDebuggerUrl) { throw "Edge debugging endpoint did not start." }

    $tabs = Invoke-RestMethod "http://127.0.0.1:$DebugPort/json/list"
    $tab = $tabs | Where-Object { $_.type -eq "page" } | Select-Object -First 1
    if (-not $tab.webSocketDebuggerUrl) { throw "Edge page target was not found." }

    $script:socket = [System.Net.WebSockets.ClientWebSocket]::new()
    $null = $script:socket.ConnectAsync(
        [Uri]$tab.webSocketDebuggerUrl,
        [Threading.CancellationToken]::None
    ).GetAwaiter().GetResult()

    Send-CdpCommand "Page.enable" | Out-Null
    Send-CdpCommand "Runtime.enable" | Out-Null
    # Collect page errors in every document the run navigates to.
    Send-CdpCommand "Page.addScriptToEvaluateOnNewDocument" @{
        source = @"
window.__qaErrors = [];
const reportedError = console.error.bind(console);
console.error = (...args) => {
  window.__qaErrors.push(args.map((value) => String(value)).join(' '));
  reportedError(...args);
};
addEventListener('error', (event) => {
  if (event.message) window.__qaErrors.push('uncaught: ' + event.message);
});
addEventListener('unhandledrejection', (event) => {
  window.__qaErrors.push('unhandled rejection: ' + String(event.reason));
});

// A stubbed TMDB proxy keeps the run offline, deterministic and free of the
// machine owner's API quota.
window.__qaTmdb = { search: 0, movie: 0, poster: 0 };
const qaRealFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const raw = String(typeof input === 'string' ? input : input.url);
  const url = new URL(raw, location.origin);
  const json = (data) => new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  if (url.pathname === '/api/tmdb/status') return json({ configured: true });

  if (url.pathname === '/api/tmdb/search') {
    window.__qaTmdb.search += 1;
    const query = url.searchParams.get('query') || '';
    const year = url.searchParams.get('year') || '2001';
    const candidate = (id) => ({
      id,
      title: query,
      original_title: 'QA Original',
      release_date: year + '-01-01',
      popularity: 42,
    });
    // 2024 is the seeded long-title movie: two identical hits must stay
    // ambiguous and land in the manual review list.
    return json({ results: year === '2024'
      ? [candidate(900001), candidate(900002)]
      : [candidate(900001)] });
  }

  if (url.pathname.startsWith('/api/tmdb/movie/')) {
    window.__qaTmdb.movie += 1;
    return json({
      id: 900001,
      original_title: 'QA Original',
      overview: 'QA overview from the stubbed TMDB proxy.',
      release_date: '2001-01-01',
      runtime: 111,
      production_countries: [{ name: 'QA Land' }],
      genres: [{ name: 'QA Genre' }],
      poster_path: '/qa.jpg',
    });
  }

  if (url.pathname === '/api/tmdb/poster') {
    window.__qaTmdb.poster += 1;
    return json({ url: '/assets/tmdb.svg' });
  }

  return qaRealFetch(input, init);
};
"@
    } | Out-Null
    Set-Viewport "desktop" | Out-Null

    # 1. Empty library.
    Send-CdpCommand "Page.navigate" @{ url = "$appBaseUrl/" } | Out-Null
    Wait-For "document.querySelector('.app')"
    Set-Theme "light"
    Write-Host "Empty library, light theme, 1366x768:"
    Invoke-ViewSweep "empty" "light" "desktop" @("dashboard", "catalog", "categories", "wheel") -SkipContentCheck

    $emptyStateShown = Invoke-Eval "Boolean(document.querySelector('.empty'))"
    if ($emptyStateShown -ne $true) {
        throw "Empty library does not render an empty state."
    }

    # 2. Filled library.
    Send-CdpCommand "Page.navigate" @{ url = "$appBaseUrl/qa/seed.html" } | Out-Null
    Wait-For "location.pathname === '/' && document.querySelector('.app')" 120

    Write-Host "Filled library, light theme, 1366x768:"
    Invoke-ViewSweep "filled" "light" "desktop" @($viewChecks.Keys)

    Write-Host "Filled library, dark theme, 1366x768:"
    Set-Theme "dark"
    Invoke-ViewSweep "filled" "dark" "desktop" @($viewChecks.Keys)

    # 3. Mobile sizes.
    Set-Theme "light"
    Write-Host "Filled library, light theme, 390x844:"
    Invoke-ViewSweep "filled" "light" "mobile" @("dashboard", "catalog", "watched", "wheel")

    Open-View "catalog"
    Invoke-Eval "document.querySelector('.tabbar__more').open = true" | Out-Null
    Wait-For "document.querySelector('.tabbar__sheet')?.getBoundingClientRect().height > 0"
    Assert-NoHorizontalOverflow "filled/light/mobile/tabbar-sheet" 390
    Save-Screenshot "qa-filled-light-mobile-tabbar-sheet" | Out-Null
    Invoke-Eval "document.querySelector('.tabbar__more').open = false" | Out-Null
    Write-Host "  tabbar sheet fits 390px."

    # 4. Long Russian titles and a broken poster URL.
    Set-Viewport "desktop" | Out-Null
    Open-View "catalog"
    $longTitleFits = Invoke-Eval @"
(() => {
  // qa-long carries the longest Russian title and an unreachable poster URL.
  const card = document.querySelector('[data-action=movie-open][data-id=qa-long]')
    ?.closest('.movie-card, .movie-row');
  if (!card) return 'card-missing';
  return card.scrollWidth <= card.clientWidth + 1 ? 'ok' : 'overflow';
})()
"@
    if ($longTitleFits -ne "ok") {
        throw "Long Russian title breaks its card: $longTitleFits"
    }
    Write-Host "Long title card does not overflow."

    $brokenPoster = Invoke-Eval @"
(async () => {
  const card = document.querySelector('[data-action=movie-open][data-id=qa-long]')
    ?.closest('.movie-card, .movie-row');
  if (!card) return 'card-missing';
  // Posters load lazily, so the card has to be on screen before it can fail.
  card.scrollIntoView({ block: 'center' });
  // The unreachable poster URL has to degrade into the initials placeholder.
  for (let attempt = 0; attempt < 40; attempt++) {
    if (card.querySelector('.poster-fallback')) return 'ok';
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return card.querySelector('img') ? 'still-a-broken-image' : 'no-placeholder';
})()
"@
    if ($brokenPoster -ne "ok") {
        throw "Broken poster URL does not fall back to initials: $brokenPoster"
    }
    Write-Host "Broken poster URL falls back to initials."

    # 5. Dialogs, the movie drawer and the command palette.
    Invoke-Eval "document.querySelector('[data-action=movie-add]').click()" | Out-Null
    Wait-For "document.querySelector('dialog[open]')"
    Assert-ModalFitsViewport

    $requiredWorks = Invoke-Eval @"
(() => {
  const form = document.querySelector('dialog[open] form');
  form.elements.title.value = '';
  return form.checkValidity() === false;
})()
"@
    if ($requiredWorks -ne $true) {
        throw "Required movie title validation is not active."
    }
    Save-Screenshot "qa-dialog-movie-add" | Out-Null

    $cardsBefore = Invoke-Eval "document.querySelectorAll('.movie-card').length"
    Invoke-Eval @"
(() => {
  const form = document.querySelector('dialog[open] form');
  form.elements.title.value = 'QA Interactive Movie';
  form.elements.categoryId.value = 'qa-world';
  form.elements.releaseYear.value = '2026';
  form.elements.durationMinutes.value = '123';
  form.requestSubmit();
  return true;
})()
"@ | Out-Null
    Wait-For "!document.querySelector('dialog[open]') && document.querySelectorAll('.movie-card').length === $($cardsBefore + 1)"
    Write-Host "Movie creation works."

    Invoke-Eval @"
(() => {
  const card = [...document.querySelectorAll('.movie-card')]
    .find(node => node.textContent.includes('QA Interactive Movie'));
  card.querySelector('[data-action=movie-edit]').click();
  return true;
})()
"@ | Out-Null
    Wait-For "document.querySelector('dialog[open] form')?.elements.title.value === 'QA Interactive Movie'"
    Assert-ModalFitsViewport
    Save-Screenshot "qa-dialog-movie-edit" | Out-Null
    Invoke-Eval "document.querySelector('dialog[open] [data-dialog-close]').click()" | Out-Null
    Wait-For "!document.querySelector('dialog[open]')"

    Invoke-Eval "document.querySelector('[data-action=movie-add]').click()" | Out-Null
    Wait-For "document.querySelector('dialog[open]')"
    Invoke-Eval @"
(() => {
  const form = document.querySelector('dialog[open] form');
  form.elements.title.value = 'QA Interactive Movie';
  form.elements.categoryId.value = 'qa-world';
  form.elements.releaseYear.value = '2026';
  form.requestSubmit();
  return true;
})()
"@ | Out-Null
    Wait-For "document.querySelector('dialog[open] [data-dialog-error]')?.textContent.trim().length > 0"
    Save-Screenshot "qa-dialog-duplicate-error" | Out-Null
    Invoke-Eval "document.querySelector('dialog[open] [data-dialog-close]').click()" | Out-Null
    Wait-For "!document.querySelector('dialog[open]')"
    Write-Host "Duplicate movie is rejected with an inline error."

    Invoke-Eval "document.querySelector('.movie-card [data-action=movie-open]').click()" | Out-Null
    Wait-For "document.querySelector('.drawer__panel')"
    $drawerFits = Invoke-Eval @"
(async () => {
  const panel = document.querySelector('.drawer__panel');
  // The drawer slides in, so measure only after its transition settles.
  await Promise.all(panel.getAnimations().map((animation) => animation.finished.catch(() => {})));
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const box = panel.getBoundingClientRect();
  const fits = box.top >= -1 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1;
  return fits ? 'ok' : JSON.stringify({
    top: Math.round(box.top),
    right: Math.round(box.right),
    bottom: Math.round(box.bottom),
    innerWidth,
    innerHeight,
  });
})()
"@
    if ($drawerFits -ne "ok") {
        throw "Movie drawer does not fit the viewport: $drawerFits"
    }
    Assert-NoHorizontalOverflow "filled/light/desktop/drawer" 1366
    Save-Screenshot "qa-movie-drawer" | Out-Null
    Invoke-Eval "document.querySelector('[data-action=detail-close]').click()" | Out-Null
    Wait-For "!document.querySelector('.drawer__panel')"
    Write-Host "Movie drawer opens and closes."

    # Favorites filter, tag filter and the notes block.
    $favorites = Invoke-Eval @"
(async () => {
  const cardCount = () => document.querySelectorAll('.movie-card').length;
  const before = cardCount();
  document.querySelector('[data-action=catalog-favorites-toggle]').click();
  await new Promise((resolve) => setTimeout(resolve, 300));
  const filtered = cardCount();
  if (filtered === 0) return 'favorites filter hides everything';
  if (filtered >= before) return 'favorites filter changed nothing: ' + before + ' -> ' + filtered;
  const allFavorite = [...document.querySelectorAll('.movie-card')]
    .every((card) => card.querySelector('.badge--favorite'));
  if (!allFavorite) return 'a non-favorite movie passed the filter';
  // The filter stays on so the screenshot below shows the filtered catalog.
  window.__qaCatalogBefore = before;
  return 'ok';
})()
"@
    if ($favorites -ne "ok") {
        throw "Favorites filter is broken: $favorites"
    }
    Save-Screenshot "qa-catalog-favorites" | Out-Null

    $favoritesReset = Invoke-Eval @"
(async () => {
  document.querySelector('[data-action=catalog-favorites-toggle]').click();
  await new Promise((resolve) => setTimeout(resolve, 300));
  return document.querySelectorAll('.movie-card').length === window.__qaCatalogBefore
    ? 'ok'
    : 'favorites filter did not reset';
})()
"@
    if ($favoritesReset -ne "ok") {
        throw "Favorites filter is broken: $favoritesReset"
    }
    Write-Host "Favorites filter narrows the catalog."

    $tagFilter = Invoke-Eval @"
(async () => {
  const select = document.querySelector('[data-control=catalog-tag]');
  if (!select) return 'tag select is missing';
  const option = [...select.options].find((item) => item.value);
  if (!option) return 'no tags in the library';
  select.value = option.value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 300));
  const chip = document.querySelector('[data-action=catalog-filter-clear][data-filter=tag]');
  if (!chip) return 'tag chip is missing';
  const count = document.querySelectorAll('.movie-card').length;
  chip.click();
  await new Promise((resolve) => setTimeout(resolve, 300));
  return count > 0 ? 'ok' : 'tag filter hides everything';
})()
"@
    if ($tagFilter -ne "ok") {
        throw "Tag filter is broken: $tagFilter"
    }
    Write-Host "Tag filter works and can be cleared."

    $notes = Invoke-Eval @"
(async () => {
  document.querySelector('[data-action=movie-open][data-id=qa-hunt]').click();
  for (let attempt = 0; attempt < 20; attempt++) {
    const panel = document.querySelector('.drawer__panel');
    if (panel?.querySelector('.drawer__notes') && panel.querySelector('.chip--tag')) {
      return 'ok';
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return 'drawer has no notes or tags';
})()
"@
    if ($notes -ne "ok") {
        throw "Movie drawer misses notes or tags: $notes"
    }
    Save-Screenshot "qa-movie-drawer-notes" | Out-Null
    Invoke-Eval "document.querySelector('[data-action=detail-close]').click()" | Out-Null
    Wait-For "!document.querySelector('.drawer__panel')"
    Write-Host "Drawer shows tags and the personal note."

    Invoke-Eval "document.querySelector('[data-action=palette-open]').click()" | Out-Null
    Wait-For "document.querySelector('.palette:not([hidden])')"
    Invoke-Eval @"
(() => {
  const input = document.querySelector('.palette__input');
  input.value = 'QA Interactive';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()
"@ | Out-Null
    Wait-For "document.querySelectorAll('.palette__item').length > 0"
    Assert-NoHorizontalOverflow "filled/light/desktop/palette" 1366
    Save-Screenshot "qa-command-palette" | Out-Null
    Invoke-Eval "document.querySelector('.palette__input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))" | Out-Null
    Wait-For "document.querySelector('.palette')?.hidden !== false"
    Write-Host "Command palette searches the library."

    Open-View "settings"
    $preferences = Invoke-Eval @"
(async () => {
  const motion = document.querySelector('[data-control=setting-reduced-motion]');
  if (!motion) return 'motion switch is missing';
  motion.checked = true;
  motion.dispatchEvent(new Event('change', { bubbles: true }));
  for (let attempt = 0; attempt < 20; attempt++) {
    if (document.documentElement.dataset.motion === 'reduced') break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (document.documentElement.dataset.motion !== 'reduced') {
    return 'reduced motion was not applied to the document';
  }
  const restored = document.querySelector('[data-control=setting-reduced-motion]');
  if (!restored.checked) return 'the switch lost its state after re-render';
  restored.checked = false;
  restored.dispatchEvent(new Event('change', { bubbles: true }));
  for (let attempt = 0; attempt < 20; attempt++) {
    if (!document.documentElement.dataset.motion) return 'ok';
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return 'reduced motion was not turned off';
})()
"@
    if ($preferences -ne "ok") {
        throw "Behaviour settings are broken: $preferences"
    }
    Save-Screenshot "qa-settings-preferences" | Out-Null
    Write-Host "Behaviour settings persist and apply."

    # Wave 3: statuses and bulk operations.
    Open-View "catalog"
    $statuses = Invoke-Eval @"
(async () => {
  const segments = [...document.querySelectorAll('[data-action=catalog-status-set]')]
    .map((node) => node.dataset.value);
  const expected = ['all', 'queued', 'watching', 'watched', 'dropped'];
  if (segments.join(',') !== expected.join(',')) return 'status filter is ' + segments.join(',');

  document.querySelector('[data-action=movie-open][data-id=qa-stalker]').click();
  for (let attempt = 0; attempt < 20; attempt++) {
    if (document.querySelector('.status-switch')) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const dropButton = document.querySelector('[data-action=movie-status-set][data-status=dropped]');
  if (!dropButton) return 'status switch is missing in the drawer';
  dropButton.click();
  await new Promise((resolve) => setTimeout(resolve, 700));

  const repository = await import('/src/data/libraryRepository.js');
  const library = await repository.loadLibrary();
  const movie = library.movies.find((item) => item.id === 'qa-stalker');
  if (movie.status !== 'dropped') return 'status was not saved: ' + movie.status;

  const engine = await import('/src/domain/rollEngine.js');
  const pool = engine.buildRollPool(library);
  if (pool.some((item) => item.id === 'qa-stalker')) return 'dropped movie stayed in the wheel';
  return 'ok';
})()
"@
    if ($statuses -ne "ok") {
        throw "Movie statuses are broken: $statuses"
    }
    Invoke-Eval "document.querySelector('[data-action=detail-close]')?.click()" | Out-Null
    Write-Host "Statuses persist and keep dropped movies out of the wheel."

    Open-View "catalog"
    $bulk = Invoke-Eval @"
(async () => {
  document.querySelector('[data-action=selection-toggle]').click();
  await new Promise((resolve) => setTimeout(resolve, 400));
  if (!document.querySelector('.bulk-bar')) return 'bulk bar did not appear';

  const cards = [...document.querySelectorAll('.movie-card [data-action=selection-toggle-movie]')];
  if (cards.length < 2) return 'not enough cards to select';
  cards[0].click();
  await new Promise((resolve) => setTimeout(resolve, 300));
  cards[1].click();
  await new Promise((resolve) => setTimeout(resolve, 300));
  if (document.querySelectorAll('.movie-card.is-selected').length !== 2) {
    return 'selection did not stick';
  }
  return 'ok';
})()
"@
    if ($bulk -ne "ok") {
        throw "Bulk selection is broken: $bulk"
    }
    Save-Screenshot "qa-catalog-bulk" | Out-Null

    $bulkFavorite = Invoke-Eval @"
(async () => {
  const before = document.querySelectorAll('.badge--favorite').length;
  document.querySelector('[data-action=bulk-favorite]').click();
  await new Promise((resolve) => setTimeout(resolve, 900));
  const after = document.querySelectorAll('.badge--favorite').length;
  if (after <= before) return 'favorite badges did not grow: ' + before + ' -> ' + after;
  if (document.querySelectorAll('.movie-card.is-selected').length !== 0) {
    return 'selection was not cleared after the bulk action';
  }
  document.querySelector('[data-action=selection-toggle]').click();
  await new Promise((resolve) => setTimeout(resolve, 300));
  return document.querySelector('.bulk-bar') ? 'bulk bar stayed open' : 'ok';
})()
"@
    if ($bulkFavorite -ne "ok") {
        throw "Bulk favorite action is broken: $bulkFavorite"
    }
    Write-Host "Bulk selection applies an action and closes."

    # Wave 4: the insights view.
    Open-View "insights"
    $insights = Invoke-Eval @"
(() => {
  const statuses = document.querySelectorAll('.status-split__item').length;
  const charts = document.querySelectorAll('.bar-list').length;
  const pace = document.querySelectorAll('.pace-chart__column').length;
  if (statuses !== 4) return 'status split has ' + statuses + ' cells';
  if (charts < 2) return 'not enough charts: ' + charts;
  if (pace !== 12) return 'watch pace has ' + pace + ' months';
  return 'ok';
})()
"@
    if ($insights -ne "ok") {
        throw "Insights view is broken: $insights"
    }
    Save-Screenshot "qa-insights" | Out-Null

    $drillDown = Invoke-Eval @"
(async () => {
  const button = document.querySelector('[data-action=catalog-status-open][data-status=watched]');
  if (!button) return 'status drill-down is missing';
  button.click();
  await new Promise((resolve) => setTimeout(resolve, 700));
  if (!location.hash.includes('catalog')) return 'drill-down did not open the catalog';
  const active = document.querySelector('[data-action=catalog-status-set].is-active');
  return active?.dataset.value === 'watched' ? 'ok' : 'wrong filter: ' + active?.dataset.value;
})()
"@
    if ($drillDown -ne "ok") {
        throw "Insights drill-down is broken: $drillDown"
    }
    Invoke-Eval "document.querySelector('[data-action=catalog-filters-reset]')?.click()" | Out-Null
    Write-Host "Insights render charts and drill down into the catalog."

    # Wave 5: wheel pool filters and CSV export.
    Open-View "wheel"
    $poolFilter = Invoke-Eval @"
(async () => {
  const before = document.querySelectorAll('.pool-list li').length;
  const favorites = document.querySelector('[data-action=roll-filter-set][data-filter=favorites]');
  if (!favorites) return 'pool filter is missing';
  favorites.click();
  await new Promise((resolve) => setTimeout(resolve, 700));
  const filtered = document.querySelectorAll('.pool-list li').length;
  const empty = document.querySelector('.empty');
  if (!empty && filtered >= before) {
    return 'favorites filter changed nothing: ' + before + ' -> ' + filtered;
  }
  document.querySelector('[data-action=roll-filter-set][data-filter=all]').click();
  await new Promise((resolve) => setTimeout(resolve, 700));
  return document.querySelectorAll('.pool-list li').length === before
    ? 'ok'
    : 'pool did not return to its full size';
})()
"@
    if ($poolFilter -ne "ok") {
        throw "Wheel pool filter is broken: $poolFilter"
    }
    Write-Host "Wheel pool filter narrows and restores the pool."

    $csv = Invoke-Eval @"
(async () => {
  const csvModule = await import('/src/domain/csvExport.js');
  const repository = await import('/src/data/libraryRepository.js');
  const csv = csvModule.buildLibraryCsv(await repository.loadLibrary());
  const lines = csv.split('\r\n');
  if (lines.length < 3) return 'csv has only ' + lines.length + ' lines';
  if (!lines[0].includes('TMDB ID')) return 'csv header is wrong: ' + lines[0];
  return 'ok';
})()
"@
    if ($csv -ne "ok") {
        throw "CSV export is broken: $csv"
    }
    Write-Host "CSV export produces a header and rows."

    # Wave 2 check runs last, so make sure we are back on the settings view.
    Open-View "settings"
    $enrichment = Invoke-Eval @"
(async () => {
  const button = document.querySelector('[data-action=tmdb-enrich]');
  if (!button) return 'enrich button is missing';
  if (button.disabled) return 'enrich button is disabled while movies need metadata';
  button.click();
  for (let attempt = 0; attempt < 20; attempt++) {
    if (document.querySelector('dialog[open] [data-enrich-progress]')) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const dialog = document.querySelector('dialog[open]');
  if (!dialog?.querySelector('[data-enrich-progress]')) return 'enrichment dialog did not open';
  dialog.querySelector('[data-dialog-submit]').click();
  // The pass walks the library one movie at a time, so give it room.
  for (let attempt = 0; attempt < 160; attempt++) {
    // The summary dialog is the one that has counters and no progress bar.
    const summary = document.querySelector('dialog[open] .kv-list');
    if (summary && !document.querySelector('dialog[open] [data-enrich-progress]')) {
      return 'ok';
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return 'enrichment did not finish';
})()
"@
    if ($enrichment -ne "ok") {
        throw "Bulk TMDB enrichment is broken: $enrichment"
    }
    Assert-ModalFitsViewport
    Save-Screenshot "qa-tmdb-enrichment" | Out-Null

    $enrichmentResult = Invoke-Eval @"
(() => {
  const values = [...document.querySelectorAll('dialog[open] .kv-list div')]
    .map((row) => row.querySelector('span').textContent.trim() + '=' + row.querySelector('b').textContent.trim());
  const manual = document.querySelectorAll('[data-enrich-fix]').length;
  return values.join(', ') + '; manual=' + manual + '; calls=' + JSON.stringify(window.__qaTmdb);
})()
"@
    Write-Host "  $enrichmentResult"
    if ($enrichmentResult -notmatch "manual=1") {
        throw "Ambiguous TMDB match did not land in the manual list: $enrichmentResult"
    }
    Invoke-Eval "document.querySelector('dialog[open] [data-dialog-submit]').click()" | Out-Null
    Wait-For "!document.querySelector('dialog[open]')"

    $enriched = Invoke-Eval @"
(async () => {
  const repository = await import('/src/data/libraryRepository.js');
  const library = await repository.loadLibrary();
  const linked = library.movies.filter((movie) => movie.tmdbId).length;
  const withGenres = library.movies.filter((movie) => (movie.genres ?? []).length).length;
  const untouched = library.movies.find((movie) => movie.id === 'qa-long');
  if (linked === 0) return 'no movie got a tmdbId';
  if (withGenres === 0) return 'no movie got genres';
  // The ambiguous movie must stay exactly as it was.
  if (untouched.tmdbId) return 'ambiguous movie was linked automatically';
  return 'ok';
})()
"@
    if ($enriched -ne "ok") {
        throw "Enrichment did not persist correctly: $enriched"
    }
    Write-Host "Bulk TMDB enrichment fills metadata and defers ambiguous matches."

    # 6. Wheel.
    Open-View "wheel"
    Wait-For "document.querySelector('[data-action=roll-configure]')"
    Invoke-Eval "document.querySelector('[data-action=roll-configure]').click()" | Out-Null
    Wait-For "document.querySelectorAll('dialog[open] .player-row').length === 4"
    Assert-ModalFitsViewport
    Save-Screenshot "qa-dialog-wheel-config" | Out-Null
    Invoke-Eval "document.querySelector('dialog[open] form').requestSubmit()" | Out-Null
    Wait-For "!document.querySelector('dialog[open]') && document.querySelector('#wheel-canvas')"
    $wheelFits = Invoke-Eval @"
(() => {
  // Wheel, status, spin button and progress must be readable on a 768px screen
  // without scrolling. Only the stage padding may fall below the fold.
  const required = ['.wheel-frame', '.wheel-status', '.wheel-actions', '.wheel-progress'];
  const below = required.filter((selector) =>
    document.querySelector(selector).getBoundingClientRect().bottom > innerHeight);
  return below.length === 0 ? 'ok' : 'below the fold: ' + below.join(', ');
})()
"@
    if ($wheelFits -ne "ok") {
        throw "Wheel scene does not fit the 768px viewport: $wheelFits"
    }
    Save-Screenshot "qa-wheel-session-started" | Out-Null
    Assert-NoConsoleErrors "interactive checks"
    Write-Host "Interactive dialogs and session start passed."

    Write-Host ""
    Write-Host "Visual QA passed. Screenshots: $shotRoot"

    Send-CdpCommand "Browser.close" | Out-Null
} finally {
    if ($script:socket) { $script:socket.Dispose() }
    if ($edge -and -not $edge.HasExited) {
        Stop-Process -Id $edge.Id -Force -ErrorAction SilentlyContinue
    }
    if (-not $server.HasExited) {
        Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
    }
}
