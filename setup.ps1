# ===============================
# setup.ps1 - native Windows dev setup
# Mirrors setup.sh for developers who don't use WSL2.
# ===============================

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Remove-PathForce {
    param([string]$Path)
    if (Test-Path $Path) {
        Remove-Item -Recurse -Force $Path
    }
}

function Install-ServiceDependencies {
    param([string]$ServiceDir, [string]$ServiceName)

    Write-Host "Installing $ServiceName dependencies..."
    Push-Location (Join-Path $RootDir $ServiceDir)
    try {
        Remove-PathForce "node_modules"
        corepack enable
        yarn install
        if ($LASTEXITCODE -ne 0) { throw "yarn install failed for $ServiceName" }
    } finally {
        Pop-Location
    }
}

function Get-EnvValue {
    param([string]$Path, [string]$Name, [string]$Default)
    $line = Get-Content $Path | Where-Object { $_ -match "^$Name=" } | Select-Object -First 1
    if ($line) {
        return ($line -split "=", 2)[1].Trim()
    }
    return $Default
}

function Add-HostsEntry {
    param([string]$Domain)

    $hostsFile = "$env:WINDIR\System32\drivers\etc\hosts"
    $pattern = "^\s*127\.0\.0\.1\s+" + [regex]::Escape($Domain) + "\s*$"
    $existing = Select-String -Path $hostsFile -Pattern $pattern -Quiet -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "$Domain already present in the hosts file"
        return
    }

    Write-Host "Adding $Domain to the hosts file (a UAC prompt will appear)..."
    $line = "127.0.0.1 $Domain"
    $cmd = "Add-Content -Path '$hostsFile' -Value '$line'"
    Start-Process powershell -Verb RunAs -Wait -ArgumentList @("-NoProfile", "-Command", $cmd)
}

# Step 0: copy .env.example to .env if not exists
$envPath = Join-Path $RootDir ".env"
$envExamplePath = Join-Path $RootDir ".env.example"
if (-not (Test-Path $envPath)) {
    Write-Host "Creating .env from .env.example..."
    Copy-Item $envExamplePath $envPath
}

$AppDomain = Get-EnvValue -Path $envPath -Name "APP_DOMAIN" -Default "recordly.techdev"
$ApiDomain = Get-EnvValue -Path $envPath -Name "API_DOMAIN" -Default "api.recordly.techdev"

# Step 0a: point the local domains at this machine
Add-HostsEntry -Domain $AppDomain
Add-HostsEntry -Domain $ApiDomain

# Step 0b: generate a locally-trusted TLS certificate for those domains
Write-Host "Setting up local TLS certificate for $AppDomain and $ApiDomain..."
$env:APP_DOMAIN = $AppDomain
$env:API_DOMAIN = $ApiDomain
& (Join-Path $RootDir "certs\generate-certs.ps1")
if ($LASTEXITCODE -ne 0) { throw "Certificate generation failed" }

# Step 1: install dependencies
Install-ServiceDependencies -ServiceDir "ocr-worker" -ServiceName "OCR worker"
Install-ServiceDependencies -ServiceDir "backend" -ServiceName "backend"
Install-ServiceDependencies -ServiceDir "frontend" -ServiceName "frontend"

# Step 2: bring up Docker Compose
Write-Host "Bringing up Docker Compose..."
Set-Location $RootDir
docker compose down
docker compose up -d --build
if ($LASTEXITCODE -ne 0) { throw "docker compose up failed" }

Write-Host "Seeding development data..."
for ($attempt = 1; $attempt -le 12; $attempt++) {
    docker compose exec -T backend yarn seed 100
    if ($LASTEXITCODE -eq 0) {
        break
    }
    if ($attempt -eq 12) {
        Write-Host "Development seed failed after backend startup retries."
        exit 1
    }
    Write-Host "Backend not ready for seeding yet. Retrying in 5 seconds..."
    Start-Sleep -Seconds 5
}

Write-Host "Setup complete!"
Write-Host "Frontend: https://$AppDomain"
Write-Host "Backend: https://$ApiDomain"
Write-Host "OCR Worker: http://localhost:6000"
Write-Host "pgAdmin: http://localhost:8080 (Email: admin@example.com, Password: admin123)"
Write-Host "Seed users: admin1@example.com through admin10@example.com (Password: Admin@123456)"
