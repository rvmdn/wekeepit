#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Mendaftarkan 2 Windows Scheduled Task untuk WeKeepIt di server/PC tim:
  1. WeKeepIt-TeamServer : Menjalankan server otomatis saat Windows startup (background)
  2. WeKeepIt-DailyBackup : Backup harian data & D:\WeKeepIt-Vault setiap pukul 17:00
#>

$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$LaunchBat = Join-Path $AppDir "launch-team-server.bat"
$BackupBat = Join-Path $AppDir "backup-wekeepit.bat"

if (-not (Test-Path $LaunchBat)) { throw "Tidak ditemukan: $LaunchBat" }
if (-not (Test-Path $BackupBat)) { throw "Tidak ditemukan: $BackupBat" }

# 1. Task: Auto-start Team Server at system startup (hidden background, auto-restart on failure)
$serverAction = New-ScheduledTaskAction `
  -Execute "cmd.exe" `
  -Argument "/c set WEKEEPIT_NO_PAUSE=1 && `"$LaunchBat`"" `
  -WorkingDirectory $AppDir

$serverTrigger = New-ScheduledTaskTrigger -AtStartup
$serverPrincipal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$serverSettings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask `
  -TaskName "WeKeepIt-TeamServer" `
  -Action $serverAction `
  -Trigger $serverTrigger `
  -Principal $serverPrincipal `
  -Settings $serverSettings `
  -Description "Menjalankan WeKeepIt Team Server secara otomatis di background" `
  -Force | Out-Null

# 2. Task: Daily Backup at 17:00
$backupAction = New-ScheduledTaskAction `
  -Execute "cmd.exe" `
  -Argument "/c `"$BackupBat`"" `
  -WorkingDirectory $AppDir

$backupTrigger = New-ScheduledTaskTrigger -Daily -At 17:00
$backupSettings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable

Register-ScheduledTask `
  -TaskName "WeKeepIt-DailyBackup" `
  -Action $backupAction `
  -Trigger $backupTrigger `
  -Principal $serverPrincipal `
  -Settings $backupSettings `
  -Description "Backup harian data WeKeepIt dan D:\WeKeepIt-Vault pukul 17:00 (retensi 14 hari)" `
  -Force | Out-Null

# 3. Pastikan PC tidak auto-sleep saat dicolok listrik (AC)
powercfg /change standby-timeout-ac 0

Write-Host "[OK] Task 'WeKeepIt-TeamServer' (Startup) dan 'WeKeepIt-DailyBackup' (17:00) berhasil didaftarkan." -ForegroundColor Green
Write-Host "[OK] Power plan AC standby-timeout diset ke Never (0)." -ForegroundColor Green
Write-Host "Untuk menjalankan server sekarang juga via Task Scheduler: Start-ScheduledTask -TaskName 'WeKeepIt-TeamServer'"
