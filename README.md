# Smart Resume Screener & Talent Pipeline API

Production-grade, backend-first REST API for an explainable, recruiter-controlled talent acquisition workflow. The platform manages organizations, job requisitions, candidate resume parsing, application pipelines, deterministic requirement scoring, asynchronous AI advisory screening, recruiter notes, and append-only audit logging.

> **AI Advisory Principle**: AI output is strictly job-related and advisory. Hiring decisions remain exclusively with authorized human decision-makers.

---

## Architecture Overview

```
                               ┌────────────────────────────────────────┐
                               │               Client Apps              │
                               │   (Recruiter Portal / Candidate App)   │
                               └───────────────────┬────────────────────┘
                                                   │
                                            HTTPS / JSON
                                                   │
                                                   ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       Express API Layer                                          │
│  - Request Context & Correlation ID (`x-request-id`)     - Argon2id Password Hashing             │
│  - Helmet Security & Strict CORS                         - JWT Access Tokens (15m)               │
│  - Zod Request Body / Query / Param Validation           - Rotating HttpOnly Refresh Cookies     │
│  - Tenant-scoped RBAC (ADMIN / RECRUITER)                - Standard Error & List Envelopes       │
└────────┬──────────────────────┬──────────────────────────┬─────────────────────────────┬─────────┘
         │                      │                          │                             │
         ▼                      ▼                          ▼                             ▼
┌────────────────┐     ┌─────────────────┐       ┌────────────────────┐       ┌────────────────────┐
│ Organizations  │     │ Jobs & Pipeline │       │ Profile & Resumes  │       │ Screening Engine   │
│ & Memberships  │     │ Applications    │       │ S3 Private Storage │       │ Matcher & OpenRouter│
└────────┬───────┘     └────────┬────────┘       └─────────┬──────────┘       └──────────┬─────────┘
         │                      │                          │                             │
         └──────────────────────┼──────────────────────────┼─────────────────────────────┘
                                │                          │
                                ▼                          ▼
                 ┌─────────────────────────────┐   ┌───────────────────────────┐
                 │     PostgreSQL / Neon       │   │    S3 Object Storage      │
                 │   Transactional Database    │   │  (Private Resume Assets)  │
                 └──────────────┬──────────────┘   └───────────────────────────┘
                                │
          ┌─────────────────────┴─────────────────────┐
          ▼                                           ▼
┌───────────────────────────────────┐       ┌───────────────────────────────────┐
│     Email Worker (Outbox)         │       │     Screening Worker              │
│ - Transactional Outbox Pattern    │       │ - Buffer text extraction (unpdf)  │
│ - Exponential backoff retry       │       │ - Deterministic requirement score │
│ - Resend Email Provider           │       │ - OpenRouter RAG advisory synthesis│
└───────────────────────────────────┘       └───────────────────────────────────┘
```

---

## Features & Implementation Roadmap

- **Feature A: Security & Observability Baseline**
  - Structured JSON logging (`logger.ts`) with automatic sensitive-field redaction (passwords, tokens, resume bodies).
  - Traceable request correlation (`x-request-id` propagated to response and logs).
  - Zod request validation middlewares (`validateBody`, `validateParams`, `validateQuery`) returning structured error envelopes with field-level issues.
  - Standardized list envelope `{ data: [...], meta: { page, pageSize, total, totalPages } }`.

- **Feature B: Multi-Tenant Organizations & RBAC**
  - Tenant isolation: All resources scoped by `organizationId`.
  - Roles: `ADMIN` (full control including member management & audit logs) and `RECRUITER` (job & application management).
  - Membership lifecycle: `INVITED`, `ACTIVE`, `REMOVED` with tokenized email invitations.

- **Feature C: Job Requisitions & Requirements**
  - Job lifecycle: `DRAFT` ➔ `PUBLISHED` ➔ `PAUSED` ➔ `CLOSED`.
  - Weighted requirements: `REQUIRED` (default weight 10) and `PREFERRED` (default weight 5) criteria.
  - Public job search endpoint (`GET /api/v1/jobs?q=...`) with title and description search.

- **Feature D: Profile & Private Resume Management**
  - Candidate profile CRUD.
  - Private S3-compatible object storage upload (`POST /api/v1/me/resumes`) with strict MIME validation (PDF and DOCX only) and size cap.
  - Time-limited presigned GET URLs (`GET /api/v1/me/resumes/:resumeId/download-url`) — raw binary files are never proxied through the API.

- **Feature E: Applications & Pipeline State Machine**
  - Candidate job application with duplicate submission guard.
  - Deterministic state machine transitions:
    `SUBMITTED` ➔ `SCREENING` ➔ `IN_REVIEW` ➔ `SHORTLISTED` ➔ `INTERVIEW` ➔ `OFFER` ➔ `HIRED` / `REJECTED` / `WITHDRAWN`.
  - Candidate withdrawal permission rules.
  - Recruiter notes and candidate-visible / internal pipeline audit events.

- **Feature F: Transactional Email Outbox & Background Worker**
  - Resilient Outbox pattern (`EmailOutbox` table) preventing distributed transaction failures.
  - Continuous `EmailWorker` with batch polling and exponential backoff retry.
  - Email templates for verification, password reset, and organization invitations.

- **Feature G: Asynchronous Resume Screening Engine**
  - Text extraction from binary buffers using `unpdf` (PDF) and `mammoth` (DOCX).
  - Extraction caching in `ResumeProfile` to avoid repeated parsing.
  - Deterministic matcher: keyword/phrase boundary evaluation, requirement weights, and context snippet extraction.
  - Grounded OpenRouter RAG AI adapter: structured JSON output with `summary`, `strengths`, `gaps`, `recommendation`, and `suggestedQuestions`.
  - Resilient deterministic advisory fallback if external AI APIs are offline or rate-limited.
  - Background `ScreeningWorker` processing queued screening runs and advancing applications to `IN_REVIEW`.

- **Feature H: Organization Audit Logs**
  - Append-only audit trail (`AuditLog` table).
  - Protected endpoint `GET /api/v1/organizations/:organizationId/audit-logs` restricted to `ADMIN` role.
  - Multi-field filtering by `actorId`, `action`, `resourceType`, and date range (`startDate`, `endDate`).

---

## API Endpoints Reference

### Health & Observability
- `GET /api/v1/health/live` — Liveness check.
- `GET /api/v1/health/ready` — Readiness check (verifies database connectivity).

### Authentication
- `POST /api/v1/auth/register` — Register a new account.
- `POST /api/v1/auth/login` — Authenticate and receive access token + refresh cookie.
- `POST /api/v1/auth/refresh` — Rotate refresh token session.
- `POST /api/v1/auth/logout` — Revoke active refresh session.
- `POST /api/v1/auth/logout-all` — Revoke all active sessions for user.
- `POST /api/v1/auth/verify-email` — Verify email via token.
- `POST /api/v1/auth/password/forgot` — Request password reset link.
- `POST /api/v1/auth/password/reset` — Reset password using token.

### Candidate Profile & Resumes
- `GET /api/v1/me` — Get current profile.
- `PUT /api/v1/me` — Update current profile.
- `POST /api/v1/me/resumes` — Upload resume (PDF or DOCX multipart).
- `GET /api/v1/me/resumes` — List uploaded resumes.
- `GET /api/v1/me/resumes/:resumeId/download-url` — Get temporary presigned download URL.
- `DELETE /api/v1/me/resumes/:resumeId` — Delete resume and S3 asset.

### Public Job Board
- `GET /api/v1/jobs` — Search published jobs (paginated, keyword search).
- `GET /api/v1/jobs/:jobId` — Get public job details.
- `POST /api/v1/jobs/:jobId/applications` — Submit application with resume.
- `GET /api/v1/applications` — List candidate's submitted applications.
- `GET /api/v1/applications/:applicationId` — Get candidate application details.
- `POST /api/v1/applications/:applicationId/withdraw` — Withdraw active application.

### Organization Management (Recruiter / Admin)
- `GET /api/v1/organizations` — List user's active organizations.
- `POST /api/v1/organizations` — Create organization.
- `GET /api/v1/organizations/:organizationId` — Get organization details.
- `PATCH /api/v1/organizations/:organizationId` — Update organization.
- `GET /api/v1/organizations/:organizationId/members` — List members (paginated).
- `POST /api/v1/organizations/:organizationId/members` — Invite new member.
- `PATCH /api/v1/organizations/:organizationId/members/:userId` — Update member role.
- `DELETE /api/v1/organizations/:organizationId/members/:userId` — Remove member.

### Organization Jobs & Requirements
- `GET /api/v1/organizations/:organizationId/jobs` — List organization jobs.
- `POST /api/v1/organizations/:organizationId/jobs` — Create draft job.
- `GET /api/v1/organizations/:organizationId/jobs/:jobId` — Get job details.
- `PATCH /api/v1/organizations/:organizationId/jobs/:jobId` — Update job details.
- `PATCH /api/v1/organizations/:organizationId/jobs/:jobId/status` — Transition job status.
- `POST /api/v1/organizations/:organizationId/jobs/:jobId/requirements` — Add requirement.
- `DELETE /api/v1/organizations/:organizationId/jobs/:jobId/requirements/:reqId` — Delete requirement.

### Organization Applications & Pipeline
- `GET /api/v1/organizations/:organizationId/jobs/:jobId/applications` — List applications for job.
- `GET /api/v1/organizations/:organizationId/applications/:applicationId` — Get application details.
- `PATCH /api/v1/organizations/:organizationId/applications/:applicationId/status` — Advance candidate in pipeline.
- `POST /api/v1/organizations/:organizationId/applications/:applicationId/notes` — Add recruiter note.
- `GET /api/v1/organizations/:organizationId/applications/:applicationId/events` — View application audit history.

### Automated Resume Screening
- `POST /api/v1/organizations/:organizationId/applications/:applicationId/screen` — Trigger screening run.
- `GET /api/v1/organizations/:organizationId/applications/:applicationId/screening-runs` — List screening runs.
- `GET /api/v1/organizations/:organizationId/applications/:applicationId/screening-runs/:runId` — Get screening run breakdown and evidence.

### Organization Audit Logs (Admin Only)
- `GET /api/v1/organizations/:organizationId/audit-logs` — Paginated audit logs with multi-field filtering.

---

## Environment Variables

Copy `.env.example` to `.env` and configure:

```env
PORT=4000
NODE_ENV=development
API_PREFIX=/api/v1

# PostgreSQL connection string
DATABASE_URL="postgresql://user:password@host/database?sslmode=require"

# Authentication Secrets
JWT_ACCESS_SECRET="your-32-byte-hex-secret-here"
ACCESS_TOKEN_TTL_SECONDS=900
REFRESH_TOKEN_TTL_SECONDS=604800
COOKIE_SECURE=false

# Client URLs
FRONTEND_ORIGINS="http://localhost:4000"
FRONTEND_APP_URL="http://localhost:4000"

# Email Delivery (Resend)
RESEND_API_KEY="re_..."
EMAIL_FROM="Smart Resume Screener <onboarding@resend.dev>"

# AI Advisory Screening & Neural Embeddings (OpenRouter)
OPENROUTER_API_KEY="sk-or-v1-..."
OPENROUTER_TEXT_MODEL="google/gemma-4-26b-a4b-it:free"
OPENROUTER_EMBED_MODEL="nvidia/llama-nemotron-embed-vl-1b-v2:free"

# Object Storage (S3-compatible endpoint)
AWS_ENDPOINT_URL_S3="https://...s3.endpoint"
AWS_ACCESS_KEY_ID="nak_..."
AWS_SECRET_ACCESS_KEY="nsk_..."
AWS_REGION="us-east-1"
S3_BUCKET="resume-assets"
S3_PRESIGN_EXPIRY_SECONDS=300
MAX_RESUME_SIZE_BYTES=5242880
```

---

## Setup & Running Locally

### 1. Install Dependencies
```powershell
npm install
```

### 2. Database Migration & Seeding
```powershell
npm run db:generate
npm run db:push
npm run db:seed
```

Pre-seeded test credentials:
- **Admin**: `admin@talentstream.test` (`Password123!`)
- **Recruiter**: `recruiter@talentstream.test` (`Password123!`)
- **Candidate**: `candidate@talentstream.test` (`Password123!`)
- **Organization**: `Acme Technologies` (`acme-tech`)

### 3. Start Development Server
```powershell
npm run dev
```

### 4. Run Background Workers
Run the email outbox worker:
```powershell
npm run worker:email
```

Run the screening evaluation worker:
```powershell
npm run worker:screening
```

---

## Testing & Verification

Run the complete test suite:
```powershell
npm test
```

Run specific feature suites:
```powershell
npm test -- tests/integration/email-outbox.test.ts
npm test -- tests/integration/screening-worker.test.ts
npm test -- tests/integration/audit.test.ts
```

Check TypeScript types:
```powershell
npm run typecheck
```

---

## OpenAPI & Postman

- **OpenAPI 3.1 Specification**: [`docs/openapi.json`](docs/openapi.json)
- **Postman Collection**: [`postman/collection.json`](postman/collection.json)
- **Postman Environment**: [`postman/environment.json`](postman/environment.json)