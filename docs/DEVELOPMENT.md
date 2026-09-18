# Development

Development is controlled through Docker Compose from the repository root.

## Start And Stop

```sh
./setup.sh
docker compose up -d
docker compose up --build -d
docker compose down
```

Use `./setup.sh` for first setup or a full dependency/container rebuild. It creates `.env` from `.env.example` when needed, installs service dependencies, and starts Docker Compose.

## Logs And Shells

```sh
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f ocr-worker
docker compose exec backend sh
docker compose exec frontend sh
docker compose exec ocr-worker sh
```

## Local Domain And TLS

The app runs at `https://recordly.techdev` (frontend), `https://api.recordly.techdev`
(backend) and `https://pgadmin.recordly.techdev` (pgAdmin) instead of `localhost`, so it behaves like a real deployed site and
can be shared with anyone by domain name.

`./setup.sh` sets this up automatically on macOS and Linux:

1. Reads `APP_DOMAIN` / `API_DOMAIN` / `PGADMIN_DOMAIN` from `.env` (defaults:
   `recordly.techdev` / `api.recordly.techdev` / `pgadmin.recordly.techdev`).
2. Adds `127.0.0.1 <domain>` entries to `/etc/hosts` for all three domains (asks
   for `sudo`; skipped if already present).
3. Installs [mkcert](https://github.com/FiloSottile/mkcert) if missing (via
   Homebrew on macOS, or a downloaded binary + `libnss3-tools` on Linux),
   registers a local trusted CA (`mkcert -install`), and writes a certificate
   for all three domains to `certs/local-cert.pem` / `certs/local-key.pem`.
4. Starts Docker Compose, including an `nginx` reverse proxy
   (`nginx/local.conf`) that terminates TLS with that certificate and routes
   `recordly.techdev` to `frontend`, `api.recordly.techdev` to `backend` and
   `pgadmin.recordly.techdev` to `pgadmin`. Plain HTTP
   requests on port 80 redirect to HTTPS.

Certificates are machine-specific and gitignored (`certs/*.pem`); every
teammate generates their own by running `./setup.sh` (or
`certs/generate-certs.sh` directly to regenerate without a full setup).

To use a different domain, set `APP_DOMAIN` / `API_DOMAIN` / `PGADMIN_DOMAIN` in `.env` before
running `./setup.sh`, and update `VITE_API_URL`, `VITE_ASSET_URL`, and
`CORS_ORIGINS` to match.

Direct container ports (`localhost:3000`, `localhost:5001`) still work
alongside the domain for quick debugging.

### Windows

No WSL required. Run the native PowerShell setup script instead:

```powershell
./setup.ps1
```

It mirrors `setup.sh` step for step: creates `.env`, adds `recordly.techdev` /
`api.recordly.techdev` to the Windows hosts file (`C:\Windows\System32\drivers\etc\hosts`
— a UAC prompt appears just for that step), installs
[mkcert](https://github.com/FiloSottile/mkcert) via `winget` (or `choco` if
`winget` isn't available) and trusts its CA in the Windows certificate store,
generates `certs/local-cert.pem` / `certs/local-key.pem` via
`certs/generate-certs.ps1`, installs dependencies for each service, and runs
`docker compose up --build -d` plus the seed script. Works with Docker
Desktop on either the WSL2 or Hyper-V backend — the script itself never
touches WSL.

If you'd rather use WSL2 (Docker Desktop's default backend), you can instead
run `./setup.sh` from inside a WSL2 shell. Note that WSL2 has its own
`/etc/hosts` and its own mkcert trust store, separate from Windows' — since a
browser running natively on Windows reads the Windows-side hosts file and
certificate store, you'd still need to repeat the hosts-file and
`mkcert -install` steps from a native (non-WSL) PowerShell prompt for the
domain to resolve and the padlock to show as trusted there. `./setup.ps1`
avoids that duplication entirely.

## Service Names

Use these Docker Compose service names:

- `backend`
- `frontend`
- `ocr-worker`
- `postgres_db`
- `redis`
- `pgadmin`
- `nginx`

## Rebuilds

Rebuild containers after Dockerfile, package, or dependency changes:

```sh
docker compose up --build -d
```

Use targeted rebuilds when only one service changed:

```sh
docker compose up --build -d backend
docker compose up --build -d frontend
docker compose up --build -d ocr-worker
```

## NestJS Generation

Run Nest CLI through the relevant container:

```sh
docker compose exec backend npx nest g module <name>
docker compose exec backend npx nest g controller <name>
docker compose exec backend npx nest g service <name>
docker compose exec backend npx nest g resource <name>
docker compose exec ocr-worker npx nest g service <name>
```

Do not create new `.spec.ts` files for now unless explicitly requested.

## Troubleshooting

- If the frontend cannot reach the API, check `VITE_API_URL`, `CORS_ORIGINS`, and backend logs.
- If database connection fails, check `DB_HOST=postgres_db` and the PostgreSQL env values.
- If OCR work is not processed, check `redis`, `backend`, and `ocr-worker` logs.
- If generated files do not appear locally, confirm the service has the expected source volume mounted.
