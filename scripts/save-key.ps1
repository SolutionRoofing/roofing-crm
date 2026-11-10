# Saves an API key from the clipboard into .env.local without showing it.
# Usage (copy the key first):
#   powershell -ExecutionPolicy Bypass -File scripts\save-key.ps1 -Name RESEND_API_KEY -Prefix re_
#   powershell -ExecutionPolicy Bypass -File scripts\save-key.ps1 -Name SUPABASE_SECRET_KEY -Prefix sb_secret_
param(
  [Parameter(Mandatory = $true)][string]$Name,
  [Parameter(Mandatory = $true)][string]$Prefix
)
$envFile = Join-Path (Split-Path $PSScriptRoot) '.env.local'
$key = Get-Clipboard -Raw
if ($null -ne $key) { $key = $key.Trim() }
if (-not $key -or -not $key.StartsWith($Prefix) -or $key.Length -lt ($Prefix.Length + 10) -or $key -match '\s') {
  Write-Host "The clipboard does not hold a key that starts with $Prefix." -ForegroundColor Yellow
  Write-Host 'Copy the key from your normal web browser (Edge or Chrome), then run this again.'
  exit 1
}
$lines = @(Get-Content $envFile -Encoding utf8)
$found = $false
$lines = $lines | ForEach-Object { if ($_ -match "^$Name=") { $found = $true; "$Name=$key" } else { $_ } }
if (-not $found) { $lines += "$Name=$key" }
[IO.File]::WriteAllLines($envFile, $lines, (New-Object Text.UTF8Encoding($false)))
Set-Clipboard -Value ' '
Write-Host "Saved $Name ($($key.Substring(0, [Math]::Min($key.Length, $Prefix.Length + 4)))...) to .env.local and cleared the clipboard." -ForegroundColor Green
