# Structured Retrieval

Handles AI requests that use structured record data instead of document vectors.

- `StructuredRetrievalService` owns record search, pagination, and safe summaries.
- Record lists get a short model-written reply on top of the record cards; a templated answer is the fallback.
- `record_summary` also reads the record's document text (in order, bounded by a character budget) so the reply explains what the documents contain.
- All record reads go through `RecordQueryService`.
- `StructuredRetrievalContextService` stores only the latest search filters and pagination state in Redis.
- Keep full records, chat transcripts, and raw model output out of Redis.
