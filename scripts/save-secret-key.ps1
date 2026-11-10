# Saves the Supabase secret key from the clipboard into .env.local.
# Copy the secret key in Supabase first, then run this. The key is never printed.
$envFile = Join-Path (Split-Path $PSScriptRoot) '.env.local'
$key = (Get-Clipboard -Raw)
if ($null -ne $key) { $key = $key.Trim() }
if (-not $key -or $key -notmatch '^sb_secret_[A-Za-z0-9_\-]{10,}$') {
  Write-Host 'The clipboard does not hold a Supabase secret key (it should start with sb_secret_).' -ForegroundColor Yellow
  Write-Host 'In Supabase: Project Settings > API Keys > Secret keys > click the copy icon, then run this again.'
  exit 1
}
$lines = Get-Content $envFile
$found = $false
$lines = $lines | ForEach-Object {
  if ($_ -match '^SUPABASE_SECRET_KEY=') { $found = $true; "SUPABASE_SECRET_KEY=$key" } else { $_ }
}
if (-not $found) { $lines += "SUPABASE_SECRET_KEY=$key" }
Set-Content -Path $envFile -Value $lines -Encoding utf8
Set-Clipboard -Value ' '
Write-Host "Saved the secret key ($($key.Substring(0, 14))...) to .env.local and cleared the clipboard." -ForegroundColor Green
