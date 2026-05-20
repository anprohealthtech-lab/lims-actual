$ErrorActionPreference = "Continue"

function Write-Section {
  param([string]$Title)
  Write-Host ""
  Write-Host "=== $Title ===" -ForegroundColor Cyan
}

function Show-File {
  param([string]$Path)
  if (Test-Path -LiteralPath $Path) {
    $item = Get-Item -LiteralPath $Path
    Write-Host "FOUND: $Path ($($item.Length) bytes)"
    return $true
  }

  Write-Host "MISSING: $Path" -ForegroundColor Yellow
  return $false
}

$qzInstallDir = "$env:ProgramFiles\QZ Tray"
$qzProperties = Join-Path $qzInstallDir "qz-tray.properties"
$qzConsole = Join-Path $qzInstallDir "qz-tray-console.exe"
$qzCert = Join-Path $qzInstallDir "auth\lims-qz-certificate.pem"
$qzOverrideCert = Join-Path $qzInstallDir "override.crt"
$repoCert = Join-Path $PSScriptRoot "qz-certificate.pem"
$userAllowed = Join-Path $env:APPDATA "qz\allowed.dat"
$systemAllowed = Join-Path $env:PROGRAMDATA "qz\allowed.dat"
$userBlocked = Join-Path $env:APPDATA "qz\blocked.dat"
$systemBlocked = Join-Path $env:PROGRAMDATA "qz\blocked.dat"
$userLogDir = Join-Path $env:APPDATA "qz\logs"

Write-Section "QZ Install"
Show-File $qzConsole | Out-Null
Show-File $qzProperties | Out-Null
Show-File $qzCert | Out-Null
Show-File $qzOverrideCert | Out-Null

Write-Section "Certificate Hashes"
foreach ($certPath in @($repoCert, $qzCert, $qzOverrideCert)) {
  if (Show-File $certPath) {
    certutil -hashfile $certPath SHA256
  }
}

Write-Section "qz-tray.properties authcert.override"
if (Show-File $qzProperties) {
  $matches = Select-String -LiteralPath $qzProperties -Pattern "authcert|trusted|override" -CaseSensitive:$false
  if ($matches) {
    $matches | ForEach-Object {
      Write-Host "$($_.LineNumber): $($_.Line)"
    }
  } else {
    Write-Host "No authcert/trusted/override lines found. Full file:"
    Get-Content -LiteralPath $qzProperties | ForEach-Object {
      Write-Host $_
    }
  }
}

Write-Section "allowed/block files"
foreach ($allowedPath in @($userAllowed, $systemAllowed, $userBlocked, $systemBlocked)) {
  if (Show-File $allowedPath) {
    Write-Host "--- $allowedPath ---"
    Get-Content -LiteralPath $allowedPath | Select-Object -First 20
  }
}

Write-Section "Recent QZ Logs"
if (Test-Path -LiteralPath $userLogDir) {
  Get-ChildItem -LiteralPath $userLogDir -File | Sort-Object LastWriteTime -Descending | Select-Object -First 3 | ForEach-Object {
    Write-Host "--- $($_.FullName) ---"
    Select-String -LiteralPath $_.FullName -Pattern "authcert|override|allowed|Accucell|Untrusted|trusted|certificate" -CaseSensitive:$false |
      Select-Object -Last 40 |
      ForEach-Object { Write-Host "$($_.LineNumber): $($_.Line)" }
  }
} else {
  Write-Host "MISSING: $userLogDir" -ForegroundColor Yellow
}

Write-Section "Next Manual Check"
Write-Host "In the QZ popup, click 'View request details' and check:"
Write-Host "1. Certificate > Trusted"
Write-Host "2. Certificate > Fingerprint"
Write-Host "If Trusted still says 'Untrusted website', QZ is not applying authcert.override."
