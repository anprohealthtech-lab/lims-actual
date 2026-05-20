param(
  [string]$CertificatePath = "$PSScriptRoot\qz-certificate.pem",
  [string]$QzInstallDir = "$env:ProgramFiles\QZ Tray"
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host "[LIMS QZ Trust] $Message" -ForegroundColor Cyan
}

function Assert-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Please run this script as Administrator."
  }
}

function Stop-QzTray {
  Write-Step "Stopping QZ Tray if it is running..."
  Get-Process | Where-Object {
    $_.ProcessName -like "qz-tray*" -or
    ($_.Path -and $_.Path -like "$QzInstallDir*")
  } | ForEach-Object {
    try {
      Stop-Process -Id $_.Id -Force -ErrorAction Stop
    } catch {
      Write-Warning "Could not stop process $($_.ProcessName): $($_.Exception.Message)"
    }
  }
}

function Set-PropertyLine {
  param(
    [string]$Path,
    [string]$Name,
    [string]$Value
  )

  $line = "$Name=$Value"

  if (Test-Path -LiteralPath $Path) {
    $content = Get-Content -LiteralPath $Path
    $updated = $false
    $content = $content | ForEach-Object {
      if ($_ -match "^\s*#?\s*$([regex]::Escape($Name))\s*=") {
        $updated = $true
        $line
      } else {
        $_
      }
    }

    if (-not $updated) {
      $content += $line
    }

    Set-Content -LiteralPath $Path -Value $content -Encoding Default
  } else {
    Set-Content -LiteralPath $Path -Value $line -Encoding Default
  }
}

function Remove-LimsTrustEntries {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }

  $item = Get-Item -LiteralPath $Path
  if ($item.Length -eq 0) {
    return
  }

  $backupPath = "$Path.$backupStamp.bak"
  Copy-Item -LiteralPath $Path -Destination $backupPath -Force

  $remaining = Get-Content -LiteralPath $Path | Where-Object {
    $_ -notmatch "Accucell Pathology Laboratory" -and
    $_ -notmatch "LIMS QZ Tray Printing" -and
    $_ -notmatch "110b04002c4970ea158b440863892660b90bc8d2"
  }

  Set-Content -LiteralPath $Path -Value $remaining -Encoding Default
}

Assert-Admin

if (-not (Test-Path -LiteralPath $CertificatePath)) {
  throw "Certificate not found: $CertificatePath"
}

if (-not (Test-Path -LiteralPath $QzInstallDir)) {
  throw "QZ Tray install directory not found: $QzInstallDir"
}

$qzConsole = Join-Path $QzInstallDir "qz-tray-console.exe"
$qzExe = Join-Path $QzInstallDir "qz-tray.exe"
$qzProperties = Join-Path $QzInstallDir "qz-tray.properties"
$qzAuthDir = Join-Path $QzInstallDir "auth"
$targetCert = Join-Path $qzAuthDir "lims-qz-certificate.pem"
$overrideCert = Join-Path $QzInstallDir "override.crt"
$backupStamp = Get-Date -Format "yyyyMMdd-HHmmss"

if (-not (Test-Path -LiteralPath $qzConsole)) {
  throw "qz-tray-console.exe not found: $qzConsole"
}

Stop-QzTray

Write-Step "Preparing QZ auth directory..."
New-Item -ItemType Directory -Force -Path $qzAuthDir | Out-Null

if (Test-Path -LiteralPath $qzProperties) {
  $backupPath = "$qzProperties.$backupStamp.bak"
  Write-Step "Backing up qz-tray.properties to $backupPath"
  Copy-Item -LiteralPath $qzProperties -Destination $backupPath -Force
}

Write-Step "Copying LIMS QZ certificate..."
Copy-Item -LiteralPath $CertificatePath -Destination $targetCert -Force
Copy-Item -LiteralPath $CertificatePath -Destination $overrideCert -Force

$propertyCertPath = "override.crt"
Write-Step "Configuring authcert.override=$propertyCertPath"
Set-PropertyLine -Path $qzProperties -Name "authcert.override" -Value $propertyCertPath

$userAllowed = Join-Path $env:APPDATA "qz\allowed.dat"
$systemAllowedDir = Join-Path $env:PROGRAMDATA "qz"
$systemAllowed = Join-Path $systemAllowedDir "allowed.dat"
$userBlocked = Join-Path $env:APPDATA "qz\blocked.dat"
$systemBlocked = Join-Path $systemAllowedDir "blocked.dat"

function Invoke-QzWhitelist {
  param([string]$CertPath)

  foreach ($flag in @("--allow", "--whitelist")) {
    Write-Step "Running qz-tray-console.exe $flag ..."
    $global:LASTEXITCODE = 0
    & $qzConsole $flag $CertPath
    $exitCode = $LASTEXITCODE

    if ($exitCode -eq 0 -or $null -eq $exitCode) {
      return $true
    }

    Write-Warning "QZ command $flag returned exit code $exitCode."
  }

  return $false
}

Write-Step "Removing stale LIMS QZ decisions..."
Remove-LimsTrustEntries -Path $userAllowed
Remove-LimsTrustEntries -Path $systemAllowed
Remove-LimsTrustEntries -Path $userBlocked
Remove-LimsTrustEntries -Path $systemBlocked

if (Invoke-QzWhitelist -CertPath $targetCert) {
  Write-Step "QZ whitelist command completed."
} else {
  Write-Warning "QZ whitelist command did not complete cleanly. Continuing because authcert.override was configured."
}

if ((Test-Path -LiteralPath $userAllowed) -and (Get-Item -LiteralPath $userAllowed).Length -gt 0) {
  Write-Step "Copying current user allowed.dat to system-wide QZ data directory..."
  New-Item -ItemType Directory -Force -Path $systemAllowedDir | Out-Null
  Copy-Item -LiteralPath $userAllowed -Destination $systemAllowed -Force
}

if (Test-Path -LiteralPath $systemAllowed) {
  Write-Step "Copying system-wide allowed.dat to current user QZ data directory..."
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $userAllowed) | Out-Null
  Copy-Item -LiteralPath $systemAllowed -Destination $userAllowed -Force
}

if (Test-Path -LiteralPath $qzExe) {
  Write-Step "Starting QZ Tray..."
  Start-Process -FilePath $qzExe
}

Write-Host ""
Write-Host "Done. Restart the browser tab and try printing again." -ForegroundColor Green
Write-Host "If QZ prompts once, tick 'Remember this decision' and click Allow." -ForegroundColor Green
