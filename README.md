# Smart Resume Screener & Talent Pipeline API

Backend-first foundation for a secure, explainable recruitment workflow. The API will manage organizations, jobs, candidate resumes, applications, asynchronous screening runs, recruiter review, and pipeline events. AI output is advisory and job-related; hiring decisions remain with authorized people.

## First-round foundation

- TypeScript, Node.js, and Express API
- Zod-based environment validation
- PostgreSQL integration through Prisma
- Initial domain schema for users, organizations, jobs, resumes, applications, screening, events, notes, sessions, and audit logs
- Liveness and database readiness endpoints
- Repeatable Prisma database commands and a non-production seed
- Domain module, provider, worker, middleware, and schema boundaries
- Vitest and Supertest integration-test setup

## Prerequisites

- Node.js 20 or newer
- PostgreSQL 14 or newer, or a compatible hosted PostgreSQL database
- A `DATABASE_URL` connection string

## Setup

```powershell
npm install
Copy-Item .env.example .env
```

Update `.env` with a database connection string. The local `.env` is intentionally ignored by Git and must never be committed.

Generate the Prisma client and synchronize the development database:

```powershell
npm run db:validate
npm run db:generate
npm run db:push
npm run db:seed
```

`db:push` is convenient during this initial design round. Once the schema is stable, use committed migrations instead:

```powershell
npm run db:migrate -- --name initial_schema
```

Run the API:

```powershell
npm run dev
```

The default health endpoints are:

- `GET http://localhost:4000/api/v1/health/live`
- `GET http://localhost:4000/api/v1/health/ready`

## Project layout

```text
prisma/
  schema.prisma
  seed.ts
src/
  app.ts
  server.ts
  config/
  middlewares/
  modules/
    auth/ organizations/ users/ jobs/ resumes/
    applications/ screening/ notifications/ audit/
  providers/
  routes/
  schemas/
  utils/
  workers/
tests/
  integration/
docs/
```

Module route files are currently unmounted boundaries. The next implementation round should add authentication and refresh-token rotation, then organization-scoped authorization before exposing job and application routes.

## Useful commands

```powershell
npm run typecheck
npm run build
npm test
npm run db:studio
```

The test suite uses Vitest with Supertest and can run without a database for HTTP behavior that does not require persistence. Use `npm run test:watch` during development.

## Security baseline

Resume files must remain in private storage. Do not log resume contents, tokens, provider credentials, or sensitive personal data. The schema is a starting point for the MVP and should be reviewed against the final retention policy and permission matrix before real candidate data is used.