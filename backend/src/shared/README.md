# Shared Backend Infrastructure

Reusable infrastructure that is not owned by one feature module.

- `SharedModule`: common services used across features.
- `RedisModule` and `BullQueueModule`: Redis clients and queue event helpers.
- `constants`: shared queue names and application constants.
- OCR queue retention: the backend creates the OCR jobs, so job options such as
  retention are set where the queue is registered in `SharedModule`, not in the
  `ocr-worker` (options there would never apply). Completed jobs hold the
  extracted document text and are removed after 5 minutes, failed jobs after
  1 hour. They are kept that long, not removed at once, so a job that finishes
  before the backend starts waiting can still be read.
- `StorageService`: private MinIO object upload, streaming, deletion retry, and
  transient-object cleanup.
- `utilities`: focused helpers such as Bull connection and vector validation.
- [`seeder`](seeder/README.md): development seed entry point.

Keep feature-specific business logic under `src/modules`, not here.
