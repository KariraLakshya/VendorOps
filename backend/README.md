# Zelosify Recruit Backend

Multi-tenant Vendor–Hiring Manager Contract Management Module. Auth, RBAC,
tenant isolation, S3 file handling, and persistence live here; the actual
AI Recommendation Agent (resume reading, LLM tool-calling, deterministic
scoring) runs as a separate Python/FastAPI service — see
`../agent`.

## Stack

- Node.js / Express / TypeScript, Prisma + PostgreSQL
- Keycloak for authentication, JWT (RS256) verification
- S3-compatible object storage (AWS S3 or MinIO for local dev)
- Vitest for unit/integration tests
- Pino for structured JSON logging
- `express-rate-limit` on auth and profile-upload endpoints

## Architecture: two services

```
backend (Node)                          agent (Python/FastAPI)
------------------------                --------------------------------------
Auth (Keycloak) + RBAC                  Resume text extraction (PyMuPDF/python-pptx)
Tenant-scoped vendor/HM APIs            LLM tool-calling orchestrator (Groq)
S3 presign/upload/retrieval             Tool registry (skill normalization,
Prisma transactions, idempotency          feature extraction, matching & scoring)
Recommendation queue (fire-and-forget)  Prompt-injection mitigation
Rate limiting                           Schema validation + retry logic
        |                                        ^
        |   POST /recommend                      |
        |   (X-Internal-Api-Key)                  |
        +----------------------------------------+
        { resumeFile (base64), fileFormat, context } -> { output, metadata }
```

This Node backend never calls Groq and contains no resume-parsing or
scoring logic — `recommendationService.ts` fetches the profile's file
bytes from S3 and hands them, still raw, to the agent service over HTTP;
the deterministic score it gets back is persisted as-is.

## Getting started

```bash
cd backend
npm install

# Start Postgres and MinIO (S3-compatible storage) — Keycloak too if you
# need real login (see the note below)
docker compose up -d postgres minio minio-init

cp .env.example .env   # fill in ENCRYPTION_KEY and AGENT_SERVICE_API_KEY

npm run prisma:migrate   # applies migrations (or `prisma:deploy` in CI)
npm run seed              # seeds the "Bruce Wayne Corp" tenant + 13 openings
npm run dev
```

You'll also need the agent service running (see
`../agent/README.md`) — by default this backend expects
it at `http://localhost:8001`, and `AGENT_SERVICE_API_KEY` must be the
identical value in both `.env` files.

**Keycloak**: `docker-compose.yml` includes a Keycloak container, but it
needs a realm/client/users configured before login actually works —
that setup isn't automated here. Without it, you can still exercise every
piece of business logic by calling the controllers directly with a
hand-built authenticated request (see the vendor/hiring-manager
controller tests for the pattern).

### Required environment variables

See `.env.example`. Notably:

- `DATABASE_URL` — Postgres connection string (docker-compose exposes it on `localhost:5445`)
- `ENCRYPTION_KEY` — **must be exactly 32 bytes (64 hex chars)**. Generate
  it, don't hand-type it:
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
  (an off-by-one-hex-digit version of this key was a real, live-caught bug)
- `AGENT_SERVICE_URL` / `AGENT_SERVICE_API_KEY` — where the Python agent
  service lives and the shared secret it requires on every call
- `S3_ENDPOINT` / `S3_*` — points at the bundled MinIO container by default; set to blank + real AWS credentials to use actual S3
- `KEYCLOAK_*` — needs a realm/client configured before Keycloak-based login will work end-to-end

## The recommendation pipeline (this side)

```
Controller (no business logic)
  -> Recommendation Service
       - fetches the profile + opening (sanitized fields only — the agent
         service never sees raw Prisma models)
       - retrieves the raw file bytes from S3 (no parsing here anymore —
         that all moved into the agent service)
       - atomically claims the profile for processing (transactional
         compare-and-swap on recommendationStatus, so two concurrent
         triggers for the same profile can't both process it)
       - calls the agent service: POST /recommend
       - persists the result atomically via a Prisma transaction
  -> Recommendation Queue (bounded concurrency, fire-and-forget after the
     upload transaction commits — the upload API never blocks on the AI
     pipeline)
```

Idempotent re-run: a profile whose recommendation is already `COMPLETED`
(or currently `PROCESSING`) is skipped unless `force` is passed. A
previously `FAILED` profile is deliberately left claimable, so the next
trigger for it self-heals a transient failure without needing `force`.

See `../agent/README.md` for the agent's own design
decisions (dynamic tool-calling, deterministic score override, prompt
sanitization, schema-validated retries, token/latency logging).

## Security

- **RBAC + tenant isolation**: every query is scoped by
  `req.user.tenant.tenantId`, resolved server-side from the verified JWT
  — never from a client-supplied parameter. Shortlist/reject additionally
  re-checks `opening.hiringManagerId === loggedInUser.id` inside the same
  transaction as the write.
- **Rate limiting**: `/verify-login` and `/verify-totp` (brute-force
  targets — a TOTP code is only 6 digits), `/register` (spam deterrent),
  and the profile upload endpoint (each file triggers a real, paid LLM
  call downstream).
- **Upload tokens** are bound to tenant + opening + uploader and
  re-validated server-side before the S3 write — a token minted for one
  vendor/opening can't be replayed against another.
- **The agent service has no auth of its own** beyond a shared-secret
  header this backend sends on every call — see its README for why that
  matters if it's ever exposed beyond a private network.

## What's been verified live (not just mocked)

Everything above has automated test coverage, but a chunk of it was also
run for real, which is how these got caught and fixed:

- **`ENCRYPTION_KEY` was silently 31 bytes, not 32** — never exercised
  until a real presigned-upload flow actually called
  `crypto.createCipheriv`. Fixed, and now generated programmatically
  rather than hand-typed.
- **`postgres:latest` resolves to Postgres 18**, which changed its
  expected data-directory layout and crash-looped against this project's
  existing volume mount. Pinned to `postgres:16-alpine` in
  `docker-compose.yml`.
- **`minio/minio` and `minio/mc` were removed from Docker Hub** entirely
  (MinIO moved to a licensing model that dropped the free Docker Hub
  images in 2025). Repointed to `quay.io/minio/minio` and
  `quay.io/minio/mc`.
- The hand-written Prisma migration (never actually run against a live
  database before) applied cleanly to real Postgres on the first try.
- The full Upload → Submit → Recommend → Shortlist flow, run through the
  real controllers against real Postgres, real MinIO, and a real Groq
  call via the agent service — including the automatic recommendation
  trigger racing against an explicit manual one, which the transactional
  claim in `recommendationService.ts` correctly resolved (one won, the
  other cleanly skipped).

## Testing

```bash
npm test
```

- `tests/unit/controllers/` — tenant-isolation and cross-tenant/cross-manager ownership (RBAC) tests
- `tests/unit/middlewares/` — RBAC unauthorized-access tests, rate-limiter enforcement
- `tests/unit/services/agent/` — the HTTP contract with the Python agent service (request shape, error propagation) and the pure helpers in `recommendationService.ts`
- `tests/integration/uploadToShortlistFlow.integration.test.ts` — the full flow through real controller/service code sharing one in-memory Prisma stand-in, so a field-name mismatch between stages would actually be caught

The agent's own scoring-boundary, schema-validation, prompt-injection, and
performance tests live in `../agent/tests/` (pytest), since
that's where the logic they cover actually runs.
