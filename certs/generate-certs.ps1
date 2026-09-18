# ===============================
# generate-certs.ps1
# Creates a locally-trusted TLS certificate (via mkcert) for the app's
# local development domains, natively on Windows (no WSL required).
# Safe to re-run; regenerates the cert each time.
# ===============================

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $PSScriptRoot
$CertDir = Join-Path $RootDir "certs"

$AppDomain = if ($env:APP_DOMAIN) { $env:APP_DOMAIN } else { "recordly.techdev" }
$ApiDomain = if ($env:API_DOMAIN) { $env:API_DOMAIN } else { "api.recordly.techdev" }
$PgadminDomain = if ($env:PGADMIN_DOMAIN) { $env:PGADMIN_DOMAIN } else { "pgadmin.recordly.techdev" }

function Install-Mkcert {
    if (Get-Command mkcert -ErrorAction SilentlyContinue) {
        return
    }

    Write-Host "mkcert not found, installing..."
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        winget install -e --id FiloSottile.mkcert --accept-source-agreements --accept-package-agreements
    } elseif (Get-Command choco -ErrorAction SilentlyContinue) {
        choco install mkcert -y
    } else {
        Write-Host "Install mkcert manually: https://github.com/FiloSottile/mkcert#installation"
        exit 1
    }

    # Refresh PATH in this session so a freshly installed mkcert is visible
    # without needing to open a new terminal.
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("PATH", "User")

    if (-not (Get-Command mkcert -ErrorAction SilentlyContinue)) {
        Write-Host "mkcert was installed but isn't on PATH yet. Open a new terminal and re-run this script."
        exit 1
    }
}

Install-Mkcert

Write-Host "Installing local mkcert CA into the Windows trust store..."
mkcert -install

New-Item -ItemType Directory -Force -Path $CertDir | Out-Null

Write-Host "Generating certificate for $AppDomain, $ApiDomain and $PgadminDomain..."
mkcert `
    -cert-file (Join-Path $CertDir "local-cert.pem") `
    -key-file (Join-Path $CertDir "local-key.pem") `
    $AppDomain $ApiDomain $PgadminDomain

Write-Host "Certificate written to $(Join-Path $CertDir 'local-cert.pem')"
