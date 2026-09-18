# Recordly
Recordly is a full-stack, Docker-managed record collection platform built with Vue 3, Vuetify, NestJS, PostgreSQL/pgvector, optional Elasticsearch BM25 search, Redis, OCR processing, and an AI assistant with a pluggable model provider (Ollama locally, OpenAI in production).

I built this as a practical sample project for field-data workflows: users can store structured records for people in a local area, manage address and personal details, upload documents, and ask a local AI assistant to find records using natural language.

![Recordly records screen](https://github.com/user-attachments/assets/6df7fc33-0d4c-4753-a637-4a1124997674)

<img width="2551" height="1311" alt="image" src="https://github.com/user-attachments/assets/2f71a0d8-8649-4e9e-92fc-b7bd630ad74f" />


<img width="2281" height="1148" alt="image" src="https://github.com/user-attachments/assets/761cf6ea-ca41-4d19-9180-f08439d0937f" />


## Highlights

- Full-stack TypeScript-style architecture with a Vue frontend and NestJS backend.
- Docker Compose orchestration for frontend, backend, database, Elasticsearch, Redis, OCR worker, and pgAdmin.
- PostgreSQL persistence with TypeORM, pgvector, and a migration workflow.
- Redis-backed background processing for OCR tasks.
- Document upload support with PDF text extraction and OCR for images and scanned PDFs.
- Optional Elasticsearch BM25 indexing for uploaded document chunks.
- Recordly AI, a floating AI assistant for natural-language record search, summaries, and document RAG.
- Pluggable AI provider (Ollama by default locally, OpenAI available for production via `AI_PROVIDER`) where the backend validates intents, performs authorized retrieval, and sends only controlled context to the model.
- Environment-driven configuration for local and production deployments.
- Security-focused documentation for secrets, personal data, and production setup.

## Tech Stack

| Area | Tools |
| --- | --- |
| Frontend | Vue 3, Vite, Vuetify, Pinia |
| Backend | NestJS, TypeORM, class-validator |
| Database | PostgreSQL with pgvector |
| Queue / Worker | Redis, OCR worker service |
| Search | pgvector, optional Elasticsearch BM25 |
| AI | Ollama (local) or OpenAI (production), chat and embedding models |
| Infrastructure | Docker, Docker Compose, pgAdmin |

## What The App Includes

- **Record workflow**: multi-step record creation for personal, identity, occupation, family, financial account, and document details.
- **Document support**: upload files, extract embedded PDF text, and OCR images or scanned PDFs for AI search.
- **Recordly AI AI assistant**: search and summarize records or ask questions about accessible uploaded documents.
- **Document RAG**: redact and embed document chunks, retrieve them with pgvector plus optional BM25 hybrid search, and return document and page citations.
- **Role-aware access**: regular users see their own records; admins follow the backend’s broader record visibility rules.
- **Docker-first operation**: frontend, backend, PostgreSQL, Elasticsearch, Redis, OCR worker, Ollama, and pgAdmin run through Compose.

## Architecture

The app keeps browser concerns in Vue, business and security rules in NestJS,
background OCR in its worker, and AI calls (Ollama locally, OpenAI in
production) behind the backend. See
[Architecture](docs/ARCHITECTURE.md) for service and data flows.

```text
User
 |
 v
Frontend (`frontend`, Vue)
 |
 v
Backend API (`backend`, NestJS)
 |
 +-- AuthModule / UsersModule
 |     -> validate JWT, roles, and active user
 |     -> PostgreSQL/pgvector (`postgres_db`)
 |
 +-- RecordsModule
 |     -> enforce record access and run the six-step workflow
 |     -> save records and uploaded document metadata
 |     -> PostgreSQL/pgvector (`postgres_db`)
 |     -> queue document embedding in Redis (`redis`)
 |
 +-- AI Module
       |
       +-- Document indexing
       |     -> parse text PDFs in the backend
       |     -> send images and scanned PDF pages through Redis (`redis`)
       |     -> OCR worker (`ocr-worker`) downloads private MinIO objects and returns text
       |     -> redact and chunk text
       |     -> LLM provider (Ollama locally, OpenAI in production) creates embeddings
       |     -> PostgreSQL/pgvector (`postgres_db`) stores searchable chunks
       |     -> Elasticsearch (`elasticsearch`) optionally stores BM25 text index
       |
       +-- Recordly AI chat
             -> LLM provider classifies the user intent
             -> backend validates the intent
             -> authorized record query
                OR authorized vector/BM25 hybrid document retrieval
             -> LLM provider writes summaries or document-grounded answers
             -> frontend receives records and optional citations

pgAdmin (`pgadmin`) -> PostgreSQL/pgvector (`postgres_db`)
                     development database administration only
```

## Quick Start

Run one command from a fresh clone:

```sh
./setup.sh       # macOS / Linux / WSL2
./setup.ps1      # Windows (native PowerShell, no WSL needed)
```

This creates `.env` from `.env.example`, installs dependencies, generates a
locally-trusted TLS certificate (via [mkcert](https://github.com/FiloSottile/mkcert)),
points `recordly.techdev` / `api.recordly.techdev` at your machine, and starts Docker
Compose behind an nginx reverse proxy. See [Development](docs/DEVELOPMENT.md)
for what it does under the hood and how to customize the domain.

Useful Docker commands:

```sh
docker compose up -d
docker compose up --build -d
docker compose logs -f backend
docker compose down
```

Open:

- Frontend: `https://recordly.techdev`
- Backend API: `https://api.recordly.techdev`
- Ollama: `http://localhost:11434`
- pgAdmin: `https://pgadmin.recordly.techdev` (or `http://localhost:8080` directly)

## AI Assistant

Recordly AI supports natural-language record search, safe record summaries, and
questions grounded in uploaded documents. Document answers use pgvector semantic
retrieval and can optionally add Elasticsearch BM25 keyword retrieval
(`DOCUMENT_SEARCH_HYBRID_ENABLED`). The AI provider is pluggable (`AI_PROVIDER`:
Ollama locally, OpenAI in production); the backend owns permissions and
database queries and the model never receives direct database access. See the
[AI module](backend/src/modules/ai/README.md) when changing AI behavior.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Backend Modules](backend/README.md)
- [Development](docs/DEVELOPMENT.md)
- [Database](docs/DATABASE.md)
- [Security](docs/SECURITY.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Agent Instructions](AGENTS.md)
