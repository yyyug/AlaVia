param(
  [string]$BucketName = "soundscape-tiles",
  [string[]]$Prefixes = @("tiles/", "pmtiles/"),
  [string]$CloudflareApiToken = $env:CLOUDFLARE_API_TOKEN,
  [string]$CloudflareAccountId = $env:CLOUDFLARE_ACCOUNT_ID,
  [string]$DevVarsPath = ".dev.vars",
  [string]$DatabaseName = "alavia",
  [string]$Environment = "production"
)

$ErrorActionPreference = "Stop"

function Import-DevVars {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    return
  }

  Get-Content $Path | ForEach-Object {
    if ($_ -match "^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$") {
      $name = $matches[1]
      $value = $matches[2]
      if (-not (Get-Variable -Name $name -Scope Script -ErrorAction SilentlyContinue)) {
        Set-Variable -Name $name -Value $value -Scope Script
      }
    }
  }
}

function Invoke-WranglerJson {
  param(
    [string[]]$Arguments
  )

  $output = & npx wrangler @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw ($output -join [Environment]::NewLine)
  }

  return ($output -join [Environment]::NewLine) | ConvertFrom-Json
}

function Remove-R2ObjectByKey {
  param(
    [string]$ObjectKey
  )

  & npx wrangler r2 object delete "$BucketName/$ObjectKey" --remote --env $Environment | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to delete R2 object $ObjectKey"
  }
  Write-Host "Deleted $ObjectKey"
}

function Clear-D1CachedMarkers {
  & npx wrangler d1 execute $DatabaseName --remote --env $Environment --yes --command "UPDATE tile_access SET cached_at = NULL WHERE cached_at IS NOT NULL" | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to clear D1 tile_access cached_at markers"
  }
}

function Clear-WithWranglerFallback {
  Write-Host "Clearing cached tile objects via Wrangler fallback..."
  $result = Invoke-WranglerJson -Arguments @(
    "d1", "execute", $DatabaseName,
    "--remote",
    "--env", $Environment,
    "--json",
    "--command", "SELECT tile_key FROM tile_access WHERE cached_at IS NOT NULL"
  )

  $rows = @()
  if ($result -is [System.Array]) {
    foreach ($entry in $result) {
      if ($entry.results) {
        $rows += @($entry.results)
      }
    }
  } elseif ($result.results) {
    $rows = @($result.results)
  }

  foreach ($row in $rows) {
    $tileKey = [string]$row.tile_key
    if (-not $tileKey) {
      continue
    }
    Remove-R2ObjectByKey -ObjectKey "tiles/$tileKey.json"
  }

  if ($Prefixes -contains "pmtiles/") {
    try {
      Remove-R2ObjectByKey -ObjectKey "pmtiles/hongkong-z16.pmtiles"
    } catch {
      Write-Host "PMTiles object missing or already deleted: pmtiles/hongkong-z16.pmtiles"
    }
  }

  Clear-D1CachedMarkers
}

Import-DevVars -Path $DevVarsPath

if (-not $CloudflareApiToken -and $script:CLOUDFLARE_API_TOKEN) {
  $CloudflareApiToken = $script:CLOUDFLARE_API_TOKEN
}

if (-not $CloudflareAccountId -and $script:CLOUDFLARE_ACCOUNT_ID) {
  $CloudflareAccountId = $script:CLOUDFLARE_ACCOUNT_ID
}

if ($CloudflareApiToken -and $CloudflareAccountId) {
  $headers = @{ Authorization = "Bearer $CloudflareApiToken" }
  $base = "https://api.cloudflare.com/client/v4/accounts/$CloudflareAccountId/r2/buckets/$BucketName/objects"

  foreach ($prefix in $Prefixes) {
    Write-Host "Clearing prefix: $prefix"
    $cursor = $null

    do {
      $query = "?prefix=$([uri]::EscapeDataString($prefix))"
      if ($cursor) {
        $query += "&cursor=$([uri]::EscapeDataString($cursor))"
      }

      $resp = Invoke-RestMethod -Method Get -Uri "$base$query" -Headers $headers
      if (-not $resp.success) {
        throw "Failed to list objects for prefix $prefix"
      }

      $objects = @($resp.result)
      foreach ($obj in $objects) {
        $objKey = [string]$obj.key
        if (-not $objKey) {
          continue
        }

        $encodedKey = [uri]::EscapeDataString($objKey).Replace("%2F", "/")
        $deleteResp = Invoke-RestMethod -Method Delete -Uri "$base/$encodedKey" -Headers $headers
        if (-not $deleteResp.success) {
          throw "Failed to delete object $objKey"
        }
        Write-Host "Deleted $objKey"
      }

      $cursor = $resp.result_info.cursor
    } while ($cursor)
  }

  Clear-D1CachedMarkers
} else {
  Clear-WithWranglerFallback
}

Write-Host "Done clearing Soundscape tile objects and D1 markers."