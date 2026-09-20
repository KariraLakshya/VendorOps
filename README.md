# Vendor–Hiring Manager Contract Management Module

A production-grade, multi-tenant contract-hiring platform with a real
LLM tool-calling AI recommendation agent — built for Zelosify's Round
One assignment.

Two personas, three services:

- **IT Vendor** — browses contract openings for their tenant, uploads
  candidate resumes (PDF/PPTX).
- **Hiring Manager** — reviews submitted profiles with an AI-generated
  recommendation (score, confidence, explanation), shortlists or rejects.
- An **AI Recommendation Agent** sits between them: a genuine LLM
  tool-calling loop (not a single prompt-and-parse call) that reads the
  resume, extracts structured fields, and scores the candidate against
  the opening using a deterministic, auditable formula — never the LLM's
  own arithmetic.

## Architecture

```
┌─────────────────┐      ┌──────────────────────┐      ┌───────────────────┐
│    frontend     │─────▶│       backend         │─────▶│       agent       │
│ Next.js 15 +    │ HTTP │  Node / Express /     │ HTTP │  Python / FastAPI │
│ Redux           │◀─────│  TypeScript / Prisma  │◀─────│                   │
└─────────────────┘      └──────────┬────────────┘      └─────────┬─────────┘
                                     │                              │
                          ┌──────────┴──────────┐                  │
                          │  Postgres · Keycloak │                  ▼
                          │       · MinIO        │            Groq (LLM)
                          └───────────────────────┘
```

- **Frontend** — role-based dashboards (vendor / hiring manager), drag-drop
  upload, dark mode, table virtualization, skeleton loaders.
- **Backend** — auth (Keycloak/JWT), RBAC, tenant isolation, S3-compatible
  file storage, Prisma/Postgres persistence, rate limiting. Owns *no*
  scoring logic — it fetches resumes and hands them to the agent service.
- **Agent Service** — the AI brain, entirely separate from the backend
  above. Owns resume text extraction (PyMuPDF/python-pptx), an LLM
  tool-calling orchestrator (Groq), and the deterministic matching/scoring
  engine. Authenticated via a shared-secret header — it has no other
  auth of its own and is meant to be reachable only from the backend.

Each piece has its own README with the real depth: **[Backend](backend/README.md)** · **[Agent Service](agent/README.md)** · **[Frontend](frontend/README.md)**.

## Why three services instead of one

The spec calls for a "real LLM-based agent with tool-calling capability" —
not a wrapper that calls an LLM once and maps the output to a database row.
Python has the stronger ecosystem for that (the official Groq SDK, PyMuPDF,
python-pptx), so the agent's reasoning loop and resume parsing live there,
while Node keeps the parts it's already well-suited for: auth, RBAC,
tenant-scoped queries, and S3. The two talk over one HTTP endpoint
(`POST /recommend`) with a request/response contract that carries no raw
database models across the boundary — only sanitized, purpose-built DTOs.

## Quick start

You need Docker running, Node 20+, and Python 3.12+.

```bash
# 1. Infra: Postgres, MinIO (S3-compatible), Keycloak
cd backend
docker compose up -d postgres minio minio-init
# Keycloak needs a realm/client configured before login works end-to-end —
# see backend/README.md if you need that path.

# 2. Backend
npm install
cp .env.example .env        # fill in ENCRYPTION_KEY, AGENT_SERVICE_API_KEY (see below)
npm run prisma:migrate
npm run seed                 # seeds "Bruce Wayne Corp" tenant + 13 openings
npm run dev                  # http://localhost:5000

# 3. Agent service (separate terminal)
cd ../agent
python -m venv .venv && .venv\Scripts\activate   # or `source .venv/bin/activate`
pip install -r requirements.txt
cp .env.example .env         # fill in GROQ_API_KEY, AGENT_SERVICE_API_KEY (must match backend's)
uvicorn app.main:app --port 8001

# 4. Frontend (separate terminal)
cd ../frontend
npm install
npm run dev                  # http://localhost:5173
```

`AGENT_SERVICE_API_KEY` must be the **exact same value** in both `.env`
files — the agent service refuses every request otherwise (fails closed,
not open). Generate secrets, don't hand-type them:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## What's actually been verified live

Every claim below was run for real, not just unit-tested against mocks:

- A real resume PDF, through real Postgres + real MinIO + a real Groq
  model (`openai/gpt-oss-120b`), producing a genuine tool-calling
  sequence (`resume_parsing_tool → skill_normalization_tool →
  feature_extraction_tool → matching_scoring_engine_tool`), a correct
  deterministic score, and a persisted, shortlist-able recommendation.
- The hand-written Prisma migration, applied to a real Postgres instance
  for the first time (previously only schema-validated).
- The internal API key: a request to the agent service without it gets
  401; the real backend→agent call with it succeeds.
- A live-only bug where the model occasionally wrapped its final answer
  as a fake tool call (`"json"`, not a real registered tool) — fixed by
  forcing `tool_choice="none"` once the deterministic pipeline has
  actually produced a score, confirmed across repeated real runs.
- The scanned-resume vision fallback: a synthetic scanned PDF (real text
  rendered to an image, then embedded into a PDF with no text layer) run
  through the actual `resume_parsing_tool` pipeline, no mocks — correctly
  detected the empty text layer, rendered the page, called the open-weight
  `qwen/qwen3.8-27b` vision model on Groq, and returned a schema-valid
  `ParsedResume` with every field correct in ~1.2s, zero retries.
- The `/register` page: found live (registration failed end to end) that
  the form sent a free-text `companyName` where the backend requires a
  `tenantId` UUID, and offered role options (`USER`/`MANAGER`/`ADMIN`)
  that don't exist in this module's `Role` enum at all — only
  `IT_VENDOR`/`HIRING_MANAGER` do. Fixed the form to collect `tenantId`
  and offer the two real roles; confirmed working end to end afterward.

Full detail on all of this — including two infrastructure bugs found
along the way (Postgres 18's data-directory layout change, MinIO's
Docker Hub image deprecation) — is in the [Backend README](backend/README.md#whats-been-verified-live-not-just-mocked).

## Testing

```bash
cd backend && npm test    # 29 tests
cd agent && pytest        # 73 tests
```

Covers: experience/skill/location scoring boundaries, RBAC and
cross-tenant/cross-manager leakage, prompt-injection mitigation (real
attack strings), schema-validated retry-on-malformed-output, the full
Upload → Submit → Recommend → Shortlist flow through real controller code
against a shared in-memory data store, and rate-limit enforcement.
