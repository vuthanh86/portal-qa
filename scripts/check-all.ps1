#!/usr/bin/env pwsh
# scripts/check-all.ps1 — syntax-check every shipped .mjs and .js file.
$repo = "C:\Users\ThanhVu\dsh-qa"
$ok = $true

Get-ChildItem -Path $repo -Recurse -Include "*.mjs", "*.js" |
    Where-Object { $_.FullName -notlike "*\node_modules\*" } |
    ForEach-Object {
        $f = $_.FullName
        $out = node --check $f 2>&1
        $code = $LASTEXITCODE
        if ($code -ne 0) {
            $ok = $false
            Write-Host "FAIL  $f"
            Write-Host "      $out"
        } else {
            Write-Host "OK    $f"
        }
    }

if (-not $ok) { exit 1 }
Write-Host "all clean"