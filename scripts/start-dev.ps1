#!/usr/bin/env pwsh
# Start the local Wrangler dev server for AlaVia.
# Default URL: http://localhost:8787
# Press Ctrl+C to stop.

Set-Location "$PSScriptRoot\.."
npm run dev
