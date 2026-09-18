# Seeder

Owns development seed orchestration and fake record generation.

- Run with `docker compose exec backend yarn seed`.
- Seed data must be synthetic and safe to commit.
- Keep seed behavior aligned with current entities and required fields.
- Do not use the seeder for production migrations or persistent configuration.
