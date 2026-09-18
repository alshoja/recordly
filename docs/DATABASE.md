# Database

The database is PostgreSQL with pgvector running in the `postgres_db` Docker Compose service. Local data is persisted in the `recordly_db_data` Docker volume.

## Configuration

Database and TypeORM values come from the root `.env` file through Docker Compose:

- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`
- `POSTGRESQL_DATABASE`
- `POSTGRESQL_USERNAME`
- `POSTGRESQL_PASSWORD`

Use `.env.example` as placeholder reference only.

## Migrations

TypeORM migration config is in `backend/database/typeorm.config.ts`.

Migration files live in:

```text
backend/database/migrations/
```

Development uses TypeORM synchronization while entities are actively changing.
Do not generate a migration for every development entity edit. Generate and
review migrations when preparing schema changes for production.

Manual migrations should be limited to operations TypeORM cannot reliably
generate, such as PostgreSQL extensions, specialized indexes, or data
backfills. The production migration flow is:

```sh
docker compose exec backend yarn migration:generate <migration-name>
docker compose exec backend yarn migration:run
```

Review generated migrations before committing. Commit migrations with the entity changes that caused them.

For document RAG, run the committed pgvector-extension migration before a
generated migration that creates vector columns. The committed manual HNSW
index migration must run after the migration that creates the
`document_chunks` table and its vector column.

Production should only run committed migrations. Do not generate migrations in production. Before running migrations from the production backend container, confirm the production image includes the migration config and runtime command; the current Dockerfile is optimized for running the compiled backend app.

## Seeding

Run seed logic through the backend container:

```sh
docker compose exec backend yarn seed
```

Seed users and seed values should come from environment variables or safe placeholders. Do not commit production credentials or real personal records.

## Volumes And Resets

Local database data is stored in the `recordly_db_data` Docker volume. Removing volumes deletes local database state, so only do it intentionally after taking any needed backup.

For ordinary shutdown:

```sh
docker compose down
```

For destructive local reset, use Docker volume removal only when you intentionally want to delete local data.

## Backups

Before production database changes, take a database backup outside the application containers. Keep backups out of git.
