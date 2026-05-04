param(
  [string]$MapsApiKey = "",
  [string]$GeminiApiKey = ""
)

$ErrorActionPreference = "Stop"

if (-not $MapsApiKey) {
  throw "MapsApiKey is required"
}

if (-not $GeminiApiKey) {
  throw "GeminiApiKey is required"
}

Set-Location "C:\Users\user\Downloads\AlaVia"

npx wrangler@4 d1 create alavia
npx wrangler@4 r2 bucket create alavia-cache
npx wrangler@4 d1 execute alavia --file=schema.sql

$MapsApiKey | npx wrangler@4 secret put GOOGLE_MAPS_API_KEY
$GeminiApiKey | npx wrangler@4 secret put GEMINI_API_KEY

Write-Host "Remember to update wrangler.toml with the created D1 database_id." -ForegroundColor Yellow
Write-Host "Cloudflare setup commands completed." -ForegroundColor Green
