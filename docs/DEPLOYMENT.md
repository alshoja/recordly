# Deployment

Production uses the existing Dockerfiles and `docker-compose.prod.yaml`.

## Start Production

From the repository root:

```sh
docker compose -f docker-compose.prod.yaml up --build -d
docker compose -f docker-compose.prod.yaml logs -f backend
```

Stop production services:

```sh
docker compose -f docker-compose.prod.yaml down
```

## Production Services

The production compose file runs:

- `postgres_db`
- `redis`
- `minio`
- `backend`
- `frontend`

The backend exposes port `5001`. The frontend exposes host port `3000` mapped to container port `80`.

## MinIO AIStor Free

Download the AIStor license file from MinIO SUBNET and place it at:

```text
secrets/minio.license
```

The license and MinIO credentials must not be committed. Configure
`MINIO_IMAGE`, root credentials, and the backend/OCR service-account credentials
in the deployment environment. Pin `MINIO_IMAGE` to a tested AIStor release for
production. The `minio-init` service creates the private document, profile, and
transient buckets and applies their restricted policies.

Start MinIO with the rest of the stack:

```sh
docker compose -f docker-compose.prod.yaml up -d minio
docker compose -f docker-compose.prod.yaml logs -f minio
```

The production console binds to `127.0.0.1:9001` by default. Access it through
an SSH tunnel:

```sh
ssh -L 9001:127.0.0.1:9001 user@server
```

Then open `http://localhost:9001`. Nginx is not required for this single-node
deployment. Add a TLS reverse proxy later only if the console or S3 API must be
exposed outside the Docker network.

## Required Environment

Provide production values for database, Redis, backend, frontend, JWT, encryption, CORS, and asset URL settings. Do not commit the production `.env` file.

## Migrations

Production should run committed migrations only. Do not run `migration:generate` in production.

Before running migrations from the production backend container, confirm the production image includes the migration config and runtime command. The current backend Dockerfile is optimized for running the compiled app directly (`node dist/main`), so production migration execution may need a dedicated release step or image adjustment.

## Checklist

- Production `.env` exists on the server and is not committed.
- `secrets/minio.license` exists on the server and is not committed.
- `JWT_SECRET` and `ENCRYPTION_KEY` are strong production secrets.
- `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD` are strong production credentials.
- Backend and OCR MinIO access keys are configured with different strong secrets.
- `CORS_ORIGINS`, `VITE_API_URL`, and `VITE_ASSET_URL` match the deployed domain.
- Database backups exist before migrations.
- Images are rebuilt after dependency or Dockerfile changes.
- Logs are checked after startup.
