# Накат миграций через сессионный пулер Supabase.
#
# Прямой адрес базы db.<ref>.supabase.co существует только в IPv6 и из этой
# сети недоступен, поэтому подключение идет через пулер по IPv4.
#
# Скрипт собирает строку подключения сам: имя пользователя, кодирование
# пароля и порт - те места, где проще всего ошибиться руками. Пароль вводится
# скрыто, в журнал не попадает и нигде не сохраняется.

# Continue, а не Stop: сообщения внешних программ не должны ронять скрипт.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$env:PATH = "$env:ProgramFiles\nodejs;$env:PATH"

$refFile = Join-Path $root 'supabase\.temp\project-ref'
if (-not (Test-Path $refFile)) {
  Write-Host 'Проект не привязан: сначала выполните setup-supabase.cmd.' -ForegroundColor Red
  exit 1
}
$ref = (Get-Content $refFile -Raw).Trim()
$region = 'eu-central-1'

Write-Host ''
Write-Host '==========================================================='
Write-Host '  CineVault: накат схемы через сессионный пулер'
Write-Host '==========================================================='
Write-Host ''
Write-Host "  Проект: $ref"
Write-Host "  Регион: $region"
Write-Host ''
Write-Host '  Нужен пароль базы данных - тот, что вы задавали при'
Write-Host '  создании проекта. Не пароль от аккаунта Supabase.'
Write-Host ''
Write-Host '  Забыли - панель: Project Settings, Database,'
Write-Host '  Database password, Reset database password.'
Write-Host ''
Write-Host '  Ввод скрыт: символы не отображаются, это нормально.'
Write-Host ''

$secure = Read-Host '  Пароль базы' -AsSecureString
$plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
)
if ([string]::IsNullOrWhiteSpace($plain)) {
  Write-Host 'Пароль не введен.' -ForegroundColor Red
  exit 1
}

# Спецсимволы в пароле рвут строку подключения, поэтому кодируем всегда.
$encoded = [uri]::EscapeDataString($plain)
$logPath = Join-Path $root 'push-schema.log'
if (Test-Path $logPath) { Remove-Item $logPath -Force }

function Hide-Secret([string]$text) {
  if ([string]::IsNullOrEmpty($text)) { return $text }
  $text = $text.Replace($encoded, '***')
  return $text.Replace($plain, '***')
}

# Какой из двух пулеров обслуживает проект, заранее неизвестно: пробуем оба.
$poolers = @("aws-0-$region.pooler.supabase.com", "aws-1-$region.pooler.supabase.com")
$ok = $false

foreach ($poolHost in $poolers) {
  $url = "postgresql://postgres.$ref" + ':' + $encoded + '@' + $poolHost + ':5432/postgres'

  Write-Host ''
  Write-Host "--- Пробую $poolHost ---------------------------" -ForegroundColor Cyan
  Write-Host ''

  # Никакого 2>&1: в PowerShell 5.1 каждая строка stderr внешней программы
  # становится ошибкой, а при ErrorActionPreference = Stop - фатальной.
  # Supabase CLI пишет в stderr обычные сообщения о ходе работы.
  $outFile = Join-Path $env:TEMP 'cinevault-push-out.txt'
  $errFile = Join-Path $env:TEMP 'cinevault-push-err.txt'
  $process = Start-Process -FilePath 'npx.cmd' `
    -ArgumentList @('supabase', 'db', 'push', '--db-url', $url) `
    -NoNewWindow -Wait -PassThru `
    -RedirectStandardOutput $outFile -RedirectStandardError $errFile
  $code = $process.ExitCode

  $raw = @()
  if (Test-Path $outFile) { $raw += @(Get-Content $outFile -ErrorAction SilentlyContinue) }
  if (Test-Path $errFile) { $raw += @(Get-Content $errFile -ErrorAction SilentlyContinue) }
  # Во временных файлах может оказаться строка подключения целиком.
  Remove-Item $outFile, $errFile -Force -ErrorAction SilentlyContinue
  $output = $raw | Where-Object { $_ } | ForEach-Object { Hide-Secret ([string]$_) }

  $output | ForEach-Object { Write-Host $_ }
  Add-Content -Path $logPath -Value "=== $poolHost (код $code) ===" -Encoding utf8
  $output | ForEach-Object { Add-Content -Path $logPath -Value $_ -Encoding utf8 }

  if ($code -eq 0) { $ok = $true; break }

  if ($output -match 'Tenant or user not found') {
    Write-Host 'Этот пулер не обслуживает проект, пробую следующий.' -ForegroundColor Yellow
    continue
  }
  if ($output -match 'password authentication failed|SASL') {
    Write-Host ''
    Write-Host 'Пароль не подошел. Сбросьте его в панели и запустите файл заново.' -ForegroundColor Red
    break
  }
}

Write-Host ''
if ($ok) {
  Write-Host '===========================================================' -ForegroundColor Green
  Write-Host '  Схема накатилась. Возвращайтесь в чат.' -ForegroundColor Green
  Write-Host '===========================================================' -ForegroundColor Green
} else {
  Write-Host '===========================================================' -ForegroundColor Red
  Write-Host '  Не вышло. Журнал без пароля: push-schema.log' -ForegroundColor Red
  Write-Host '  Просто напишите в чат - я его прочитаю сам.' -ForegroundColor Red
  Write-Host '===========================================================' -ForegroundColor Red
}
Write-Host ''
Read-Host 'Enter - закрыть окно'
