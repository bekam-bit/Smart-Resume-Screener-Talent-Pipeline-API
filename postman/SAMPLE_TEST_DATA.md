# Complete API Test Data Guide (Thunder Client & Postman)

Base URL: `http://localhost:4000/api/v1`

---

## Pre-seeded Credentials (from `npm run db:seed`)
| Role | Email | Password |
|---|---|---|
| **Admin** | `admin@talentstream.test` | `Password123!` |
| **Recruiter** | `recruiter@talentstream.test` | `Password123!` |
| **Candidate** | `candidate@talentstream.test` | `Password123!` |

---

## 1. Health Probes

### 1.1 Liveness Probe
* **Method**: `GET`
* **URL**: `http://localhost:4000/api/v1/health/live`
* **Headers**: None
* **Body**: None
* **Expected Response**: `200 OK`
```json
{ "status": "ok" }
```

### 1.2 Readiness Probe
* **Method**: `GET`
* **URL**: `http://localhost:4000/api/v1/health/ready`
* **Headers**: None
* **Body**: None
* **Expected Response**: `200 OK` (or `503` if database is down)
```json
{ "status": "ok", "database": "reachable" }
```

---

## 2. Authentication & Sessions

### 2.1 Register New User
* **Method**: `POST`
* **URL**: `http://localhost:4000/api/v1/auth/register`
* **Headers**: `Content-Type: application/json`
* **Body**:
```json
{
  "email": "newcandidate@talentstream.test",
  "password": "SecurePassword123!",
  "name": "Alex Candidate"
}
```
* **Expected Response**: `201 Created`
```json
{
  "user": {
    "id": "e2f7b8e1-9234-4b92-95f3-7922d0d00001",
    "email": "newcandidate@talentstream.test",
    "emailVerifiedAt": null
  },
  "verificationRequired": true,
  "verificationToken": "a1b2c3d4e5f60718293a4b5c6d7e8f901234567890abcdef1234567890abcdef"
}
```

### 2.2 [Error] Register - Duplicate Email
* **Method**: `POST`
* **URL**: `http://localhost:4000/api/v1/auth/register`
* **Headers**: `Content-Type: application/json`
* **Body**:
```json
{
  "email": "admin@talentstream.test",
  "password": "SecurePassword123!",
  "name": "Sarah Admin"
}
```
* **Expected Response**: `409 Conflict`
```json
{
  "success": false,
  "error": { "code": "EMAIL_IN_USE", "message": "An account already exists for this email" }
}
```

### 2.3 [Error] Register - Password Too Short (<12 chars)
* **Method**: `POST`
* **URL**: `http://localhost:4000/api/v1/auth/register`
* **Headers**: `Content-Type: application/json`
* **Body**:
```json
{
  "email": "shortpw@talentstream.test",
  "password": "Pass1",
  "name": "Short Password User"
}
```
* **Expected Response**: `400 Bad Request`
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request payload",
    "details": [{ "field": "password", "message": "Too small: expected at least 12 characters" }]
  }
}
```

### 2.4 [Error] Register - Invalid Email Format
* **Method**: `POST`
* **URL**: `http://localhost:4000/api/v1/auth/register`
* **Headers**: `Content-Type: application/json`
* **Body**:
```json
{
  "email": "not-a-valid-email",
  "password": "SecurePassword123!",
  "name": "Bad Email User"
}
```
* **Expected Response**: `400 Bad Request`

### 2.5 Verify Email
* **Method**: `POST`
* **URL**: `http://localhost:4000/api/v1/auth/verify-email`
* **Headers**: `Content-Type: application/json`
* **Body**:
```json
{
  "token": "REPLACE_WITH_VERIFICATION_TOKEN"
}
```
* **Expected Response**: `200 OK`
```json
{ "message": "Email verified" }
```

### 2.6 [Error] Verify Email - Invalid / Expired Token
* **Method**: `POST`
* **URL**: `http://localhost:4000/api/v1/auth/verify-email`
* **Headers**: `Content-Type: application/json`
* **Body**:
```json
{
  "token": "0000000000000000000000000000000000000000000000000000000000000000"
}
```
* **Expected Response**: `400 Bad Request` (`INVALID_VERIFICATION_TOKEN`)

### 2.7 Resend Email Verification
* **Method**: `POST`
* **URL**: `http://localhost:4000/api/v1/auth/verify-email/resend`
* **Headers**: `Content-Type: application/json`
* **Body**:
```json
{
  "email": "newcandidate@talentstream.test"
}
```
* **Expected Response**: `200 OK`

### 2.8 Forgot Password
* **Method**: `POST`
* **URL**: `http://localhost:4000/api/v1/auth/password/forgot`
* **Headers**: `Content-Type: application/json`
* **Body**:
```json
{
  "email": "admin@talentstream.test"
}
```
* **Expected Response**: `200 OK` (returns `resetToken` in development mode)

### 2.9 Reset Password
* **Method**: `POST`
* **URL**: `http://localhost:4000/api/v1/auth/password/reset`
* **Headers**: `Content-Type: application/json`
* **Body**:
```json
{
  "token": "REPLACE_WITH_RESET_TOKEN",
  "password": "NewSecurePassword123!"
}
```
* **Expected Response**: `200 OK`

### 2.10 Login (Admin)
* **Method**: `POST`
* **URL**: `http://localhost:4000/api/v1/auth/login`
* **Headers**: `Content-Type: application/json`
* **Body**:
```json
{
  "email": "admin@talentstream.test",
  "password": "Password123!"
}
```
* **Expected Response**: `200 OK` (Sets `refresh_token` in cookie header)
```json
{
  "user": {
    "id": "USER_ID",
    "email": "admin@talentstream.test",
    "emailVerifiedAt": "2026-10-17T09:00:00.000Z"
  },
  "accessToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

### 2.11 [Error] Login - Invalid Credentials
* **Method**: `POST`
* **URL**: `http://localhost:4000/api/v1/auth/login`
* **Headers**: `Content-Type: application/json`
* **Body**:
```json
{
  "email": "admin@talentstream.test",
  "password": "IncorrectPassword!"
}
```
* **Expected Response**: `401 Unauthorized` (`INVALID_CREDENTIALS`)

### 2.12 Refresh Access Token
* **Method**: `POST`
* **URL**: `http://localhost:4000/api/v1/auth/refresh`
* **Headers**: `Cookie: refresh_token=REPLACE_WITH_COOKIE_TOKEN`
* **Body**: None
* **Expected Response**: `200 OK` (`{ "user": {...}, "accessToken": "..." }`)

### 2.13 [Error] Refresh - Missing Cookie
* **Method**: `POST`
* **URL**: `http://localhost:4000/api/v1/auth/refresh`
* **Headers**: None
* **Expected Response**: `401 Unauthorized` (`MISSING_REFRESH_TOKEN`)

### 2.14 Logout Single Session
* **Method**: `POST`
* **URL**: `http://localhost:4000/api/v1/auth/logout`
* **Headers**: `Cookie: refresh_token=REPLACE_WITH_COOKIE_TOKEN`
* **Expected Response**: `204 No Content`

### 2.15 Logout All Sessions
* **Method**: `POST`
* **URL**: `http://localhost:4000/api/v1/auth/logout-all`
* **Headers**: `Authorization: Bearer <accessToken>`
* **Expected Response**: `204 No Content`

---

## 3. Profile & Resumes (`/api/v1/me`)

### 3.1 Get Candidate Profile
* **Method**: `GET`
* **URL**: `http://localhost:4000/api/v1/me/profile`
* **Headers**: `Authorization: Bearer <accessToken>`
* **Expected Response**: `200 OK`

### 3.2 Update Candidate Profile
* **Method**: `PATCH`
* **URL**: `http://localhost:4000/api/v1/me/profile`
* **Headers**:
  * `Authorization: Bearer <accessToken>`
  * `Content-Type: application/json`
* **Body**:
```json
{
  "name": "Alex Updated Candidate",
  "phone": "+1-555-0199",
  "portfolioUrl": "https://alex-portfolio.dev",
  "location": "San Francisco, CA"
}
```
* **Expected Response**: `200 OK`

### 3.3 [Error] Update Profile - Empty Body
* **Method**: `PATCH`
* **URL**: `http://localhost:4000/api/v1/me/profile`
* **Headers**:
  * `Authorization: Bearer <accessToken>`
  * `Content-Type: application/json`
* **Body**: `{}`
* **Expected Response**: `400 Bad Request` ("Provide at least one field to update")

### 3.4 Upload Resume File (PDF / DOCX)
* **Method**: `POST`
* **URL**: `http://localhost:4000/api/v1/me/resumes`
* **Headers**: `Authorization: Bearer <accessToken>`
* **Body Type**: `multipart/form-data` (or `Form-Data` tab)
  * Field Name: `resume`
  * Field Type: `File`
  * Value: Select any `.pdf` or `.docx` file
* **Expected Response**: `201 Created`
```json
{
  "resume": {
    "id": "RESUME_UUID",
    "originalName": "Alex_Resume.pdf",
    "mimeType": "application/pdf",
    "sizeBytes": 104200,
    "createdAt": "2026-10-17T09:00:00.000Z"
  }
}
```

### 3.5 [Error] Upload Resume - Missing File
* **Method**: `POST`
* **URL**: `http://localhost:4000/api/v1/me/resumes`
* **Headers**: `Authorization: Bearer <accessToken>`
* **Body**: Empty Form Data
* **Expected Response**: `400 Bad Request` (`FILE_REQUIRED`)

### 3.6 List My Resumes
* **Method**: `GET`
* **URL**: `http://localhost:4000/api/v1/me/resumes?page=1&pageSize=10`
* **Headers**: `Authorization: Bearer <accessToken>`
* **Expected Response**: `200 OK`

### 3.7 Get Specific Resume Access & URL
* **Method**: `GET`
* **URL**: `http://localhost:4000/api/v1/me/resumes/<resumeId>`
* **Headers**: `Authorization: Bearer <accessToken>`
* **Expected Response**: `200 OK` (returns metadata and signed `downloadUrl`)

### 3.8 Delete Resume
* **Method**: `DELETE`
* **URL**: `http://localhost:4000/api/v1/me/resumes/<resumeId>`
* **Headers**: `Authorization: Bearer <accessToken>`
* **Expected Response**: `204 No Content`

---

## 4. Organizations & Member Management

### 4.1 Create Organization
* **Method**: `POST`
* **URL**: `http://localhost:4000/api/v1/organizations`
* **Headers**:
  * `Authorization: Bearer <accessToken>`
  * `Content-Type: application/json`
* **Body**:
```json
{
  "name": "CloudScale Innovations",
  "slug": "cloudscale-innovations"
}
```
* **Expected Response**: `201 Created`
```json
{
  "organization": {
    "id": "ORGANIZATION_UUID",
    "name": "CloudScale Innovations",
    "slug": "cloudscale-innovations"
  }
}
```

### 4.2 [Error] Create Organization - Duplicate Slug
* **Method**: `POST`
* **URL**: `http://localhost:4000/api/v1/organizations`
* **Headers**:
  * `Authorization: Bearer <accessToken>`
  * `Content-Type: application/json`
* **Body**:
```json
{
  "name": "Acme Clone",
  "slug": "acme-tech"
}
```
* **Expected Response**: `409 Conflict` (`SLUG_IN_USE`)

### 4.3 Get Organization Details
* **Method**: `GET`
* **URL**: `http://localhost:4000/api/v1/organizations/<organizationId>`
* **Headers**: `Authorization: Bearer <accessToken>`
* **Expected Response**: `200 OK`

### 4.4 Update Organization
* **Method**: `PATCH`
* **URL**: `http://localhost:4000/api/v1/organizations/<organizationId>`
* **Headers**:
  * `Authorization: Bearer <accessToken>`
  * `Content-Type: application/json`
* **Body**:
```json
{
  "name": "CloudScale Global Technologies"
}
```
* **Expected Response**: `200 OK`

### 4.5 List Organization Members
* **Method**: `GET`
* **URL**: `http://localhost:4000/api/v1/organizations/<organizationId>/members?page=1&pageSize=10`
* **Headers**: `Authorization: Bearer <accessToken>`
* **Expected Response**: `200 OK`

### 4.6 Add Member to Organization
* **Method**: `POST`
* **URL**: `http://localhost:4000/api/v1/organizations/<organizationId>/members`
* **Headers**:
  * `Authorization: Bearer <accessToken>`
  * `Content-Type: application/json`
* **Body**:
```json
{
  "email": "recruiter2@talentstream.test",
  "role": "RECRUITER"
}
```
* **Expected Response**: `201 Created`

### 4.7 Update Member Role / Status
* **Method**: `PATCH`
* **URL**: `http://localhost:4000/api/v1/organizations/<organizationId>/members/<memberUserId>`
* **Headers**:
  * `Authorization: Bearer <accessToken>`
  * `Content-Type: application/json`
* **Body**:
```json
{
  "role": "ADMIN",
  "status": "ACTIVE"
}
```
* **Expected Response**: `200 OK`

### 4.8 Remove Member
* **Method**: `DELETE`
* **URL**: `http://localhost:4000/api/v1/organizations/<organizationId>/members/<memberUserId>`
* **Headers**: `Authorization: Bearer <accessToken>`
* **Expected Response**: `204 No Content`

---

## 5. Jobs & Requirements

### 5.1 Create Org Job with Initial Requirements
* **Method**: `POST`
* **URL**: `http://localhost:4000/api/v1/organizations/<organizationId>/jobs`
* **Headers**:
  * `Authorization: Bearer <accessToken>`
  * `Content-Type: application/json`
* **Body**:
```json
{
  "title": "Staff Platform Engineer",
  "description": "Lead our core distributed cloud infrastructure, microservices, and high-throughput applicant ingestion pipelines using Go, TypeScript, and Kubernetes.",
  "location": "San Francisco, CA",
  "remotePolicy": "HYBRID",
  "employmentType": "FULL_TIME",
  "requirements": [
    {
      "name": "Distributed Systems Architecture",
      "description": "7+ years scaling high-availability microservices",
      "type": "REQUIRED",
      "weight": 10
    },
    {
      "name": "Kubernetes & Terraform",
      "description": "Hands-on cloud orchestration and infrastructure as code",
      "type": "PREFERRED",
      "weight": 8
    }
  ]
}
```
* **Expected Response**: `201 Created` (returns `job` object with `id`)

### 5.2 [Error] Create Job - Description Too Short (<20 chars)
* **Method**: `POST`
* **URL**: `http://localhost:4000/api/v1/organizations/<organizationId>/jobs`
* **Headers**:
  * `Authorization: Bearer <accessToken>`
  * `Content-Type: application/json`
* **Body**:
```json
{
  "title": "Short Job",
  "description": "Too brief"
}
```
* **Expected Response**: `400 Bad Request` (`VALIDATION_ERROR`)

### 5.3 List Organization Jobs
* **Method**: `GET`
* **URL**: `http://localhost:4000/api/v1/organizations/<organizationId>/jobs?page=1&pageSize=10`
* **Headers**: `Authorization: Bearer <accessToken>`
* **Expected Response**: `200 OK`

### 5.4 Get Organization Job Details
* **Method**: `GET`
* **URL**: `http://localhost:4000/api/v1/organizations/<organizationId>/jobs/<jobId>`
* **Headers**: `Authorization: Bearer <accessToken>`
* **Expected Response**: `200 OK`

### 5.5 Update Job
* **Method**: `PATCH`
* **URL**: `http://localhost:4000/api/v1/organizations/<organizationId>/jobs/<jobId>`
* **Headers**:
  * `Authorization: Bearer <accessToken>`
  * `Content-Type: application/json`
* **Body**:
```json
{
  "title": "Principal Distributed Systems Engineer",
  "remotePolicy": "REMOTE"
}
```
* **Expected Response**: `200 OK`

### 5.6 Add Standalone Job Requirement
* **Method**: `POST`
* **URL**: `http://localhost:4000/api/v1/organizations/<organizationId>/jobs/<jobId>/requirements`
* **Headers**:
  * `Authorization: Bearer <accessToken>`
  * `Content-Type: application/json`
* **Body**:
```json
{
  "name": "PostgreSQL & Redis Caching",
  "description": "Experience with complex relational queries and cache eviction patterns",
  "type": "REQUIRED",
  "weight": 9
}
```
* **Expected Response**: `201 Created` (returns `requirement` object with `id`)

### 5.7 Update Job Requirement
* **Method**: `PATCH`
* **URL**: `http://localhost:4000/api/v1/organizations/<organizationId>/jobs/<jobId>/requirements/<requirementId>`
* **Headers**:
  * `Authorization: Bearer <accessToken>`
  * `Content-Type: application/json`
* **Body**:
```json
{
  "weight": 10,
  "type": "REQUIRED"
}
```
* **Expected Response**: `200 OK`

### 5.8 Remove Job Requirement
* **Method**: `DELETE`
* **URL**: `http://localhost:4000/api/v1/organizations/<organizationId>/jobs/<jobId>/requirements/<requirementId>`
* **Headers**: `Authorization: Bearer <accessToken>`
* **Expected Response**: `204 No Content`

### 5.9 Publish Job
* **Method**: `PATCH`
* **URL**: `http://localhost:4000/api/v1/organizations/<organizationId>/jobs/<jobId>/status`
* **Headers**:
  * `Authorization: Bearer <accessToken>`
  * `Content-Type: application/json`
* **Body**:
```json
{
  "status": "PUBLISHED"
}
```
* **Expected Response**: `200 OK`

### 5.10 Search Public Jobs Board
* **Method**: `GET`
* **URL**: `http://localhost:4000/api/v1/jobs?q=Engineer&page=1&pageSize=10`
* **Headers**: None
* **Expected Response**: `200 OK`

### 5.11 Get Public Job Details
* **Method**: `GET`
* **URL**: `http://localhost:4000/api/v1/jobs/<jobId>`
* **Headers**: None
* **Expected Response**: `200 OK`

---

## 6. Candidate Job Applications

### 6.1 Apply to Published Job
* **Method**: `POST`
* **URL**: `http://localhost:4000/api/v1/jobs/<jobId>/applications`
* **Headers**:
  * `Authorization: Bearer <candidateAccessToken>`
  * `Content-Type: application/json`
* **Body**:
```json
{
  "resumeId": "REPLACE_WITH_RESUME_UUID",
  "coverLetter": "I have 8+ years building enterprise microservices and distributed data pipelines with TypeScript and PostgreSQL. Eager to contribute!"
}
```
* **Expected Response**: `201 Created`
```json
{
  "application": {
    "id": "APPLICATION_UUID",
    "status": "SUBMITTED",
    "submittedAt": "2026-10-17T09:00:00.000Z"
  }
}
```

### 6.2 [Error] Apply Twice (Duplicate Application)
* **Method**: `POST`
* **URL**: `http://localhost:4000/api/v1/jobs/<jobId>/applications`
* **Headers**:
  * `Authorization: Bearer <candidateAccessToken>`
  * `Content-Type: application/json`
* **Body**: Same body as above
* **Expected Response**: `409 Conflict` (`ALREADY_APPLIED`)

### 6.3 List My Applications (Candidate View)
* **Method**: `GET`
* **URL**: `http://localhost:4000/api/v1/applications?page=1&pageSize=10`
* **Headers**: `Authorization: Bearer <candidateAccessToken>`
* **Expected Response**: `200 OK`

### 6.4 Get My Application
* **Method**: `GET`
* **URL**: `http://localhost:4000/api/v1/applications/<applicationId>`
* **Headers**: `Authorization: Bearer <candidateAccessToken>`
* **Expected Response**: `200 OK`

### 6.5 Withdraw Application
* **Method**: `POST`
* **URL**: `http://localhost:4000/api/v1/applications/<applicationId>/withdraw`
* **Headers**: `Authorization: Bearer <candidateAccessToken>`
* **Expected Response**: `200 OK` (status becomes `WITHDRAWN`)

---

## 7. Recruiter Pipeline & Review

### 7.1 List Job Applications (Recruiter View)
* **Method**: `GET`
* **URL**: `http://localhost:4000/api/v1/organizations/<organizationId>/jobs/<jobId>/applications?page=1&pageSize=10`
* **Headers**: `Authorization: Bearer <recruiterAccessToken>`
* **Expected Response**: `200 OK`

### 7.2 Get Application by Recruiter
* **Method**: `GET`
* **URL**: `http://localhost:4000/api/v1/organizations/<organizationId>/applications/<applicationId>`
* **Headers**: `Authorization: Bearer <recruiterAccessToken>`
* **Expected Response**: `200 OK` (Includes candidate details, resume text, screening runs)

### 7.3 Advance Application Status
* **Method**: `PATCH`
* **URL**: `http://localhost:4000/api/v1/organizations/<organizationId>/applications/<applicationId>/status`
* **Headers**:
  * `Authorization: Bearer <recruiterAccessToken>`
  * `Content-Type: application/json`
* **Body**:
```json
{
  "status": "SHORTLISTED",
  "candidateVisible": true
}
```
* **Expected Response**: `200 OK`

### 7.4 Reject Application with Required Reason
* **Method**: `PATCH`
* **URL**: `http://localhost:4000/api/v1/organizations/<organizationId>/applications/<applicationId>/status`
* **Headers**:
  * `Authorization: Bearer <recruiterAccessToken>`
  * `Content-Type: application/json`
* **Body**:
```json
{
  "status": "REJECTED",
  "reason": "Seeking candidates with deeper Kafka cluster administration experience.",
  "candidateVisible": true
}
```
* **Expected Response**: `200 OK`

### 7.5 [Error] Reject Without Reason
* **Method**: `PATCH`
* **URL**: `http://localhost:4000/api/v1/organizations/<organizationId>/applications/<applicationId>/status`
* **Headers**:
  * `Authorization: Bearer <recruiterAccessToken>`
  * `Content-Type: application/json`
* **Body**:
```json
{
  "status": "REJECTED"
}
```
* **Expected Response**: `400 Bad Request` ("A reason is required when rejecting an application")

### 7.6 Add Internal Recruiter Note
* **Method**: `POST`
* **URL**: `http://localhost:4000/api/v1/organizations/<organizationId>/applications/<applicationId>/notes`
* **Headers**:
  * `Authorization: Bearer <recruiterAccessToken>`
  * `Content-Type: application/json`
* **Body**:
```json
{
  "body": "Strong match on TypeScript and database internals. Scheduled for round 1 architectural interview."
}
```
* **Expected Response**: `201 Created`

### 7.7 List Application Events & Timeline
* **Method**: `GET`
* **URL**: `http://localhost:4000/api/v1/organizations/<organizationId>/applications/<applicationId>/events`
* **Headers**: `Authorization: Bearer <recruiterAccessToken>`
* **Expected Response**: `200 OK`

---

## 8. AI Screening & Shortlisting (RAG)

### 8.1 Trigger AI Screening Run
* **Method**: `POST`
* **URL**: `http://localhost:4000/api/v1/organizations/<organizationId>/applications/<applicationId>/screen`
* **Headers**: `Authorization: Bearer <recruiterAccessToken>`
* **Expected Response**: `202 Accepted`
```json
{
  "success": true,
  "data": {
    "id": "RUN_UUID",
    "applicationId": "APPLICATION_UUID",
    "status": "QUEUED"
  }
}
```

### 8.2 List Screening Runs for Application
* **Method**: `GET`
* **URL**: `http://localhost:4000/api/v1/organizations/<organizationId>/applications/<applicationId>/screening-runs`
* **Headers**: `Authorization: Bearer <recruiterAccessToken>`
* **Expected Response**: `200 OK`

### 8.3 Get Specific Screening Run Result
* **Method**: `GET`
* **URL**: `http://localhost:4000/api/v1/organizations/<organizationId>/applications/<applicationId>/screening-runs/<runId>`
* **Headers**: `Authorization: Bearer <recruiterAccessToken>`
* **Expected Response**: `200 OK` (includes `score`, `scoreBreakdown`, `evidence`, `provider`, `model`)

### 8.4 Ask Question About Resume (RAG)
* **Method**: `POST`
* **URL**: `http://localhost:4000/api/v1/organizations/<organizationId>/applications/<applicationId>/ask`
* **Headers**:
  * `Authorization: Bearer <recruiterAccessToken>`
  * `Content-Type: application/json`
* **Body**:
```json
{
  "question": "Does the candidate demonstrate hands-on production experience with Docker container lifecycle and PostgreSQL indexing?"
}
```
* **Expected Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "answer": "Yes, Alex demonstrates hands-on production experience...",
    "citedSources": ["Source Chunk 1", "Source Chunk 3"]
  }
}
```

### 8.5 Compare Job Candidates
* **Method**: `GET`
* **URL**: `http://localhost:4000/api/v1/organizations/<organizationId>/jobs/<jobId>/candidates/compare?topCount=5&minScore=60`
* **Headers**: `Authorization: Bearer <recruiterAccessToken>`
* **Expected Response**: `200 OK`

### 8.6 Batch Shortlist Top Candidates
* **Method**: `POST`
* **URL**: `http://localhost:4000/api/v1/organizations/<organizationId>/jobs/<jobId>/shortlist`
* **Headers**:
  * `Authorization: Bearer <recruiterAccessToken>`
  * `Content-Type: application/json`
* **Body**:
```json
{
  "topCount": 3,
  "minScore": 70,
  "autoAdvance": false,
  "generateSummary": true
}
```
* **Expected Response**: `200 OK`

---

## 9. Audit Logs

### 9.1 List Organization Audit Logs
* **Method**: `GET`
* **URL**: `http://localhost:4000/api/v1/organizations/<organizationId>/audit-logs?page=1&pageSize=20`
* **Headers**: `Authorization: Bearer <adminAccessToken>`
* **Expected Response**: `200 OK`

### 9.2 List Audit Logs with Filters
* **Method**: `GET`
* **URL**: `http://localhost:4000/api/v1/organizations/<organizationId>/audit-logs?resourceType=JOB&action=JOB_CREATED&page=1&pageSize=10`
* **Headers**: `Authorization: Bearer <adminAccessToken>`
* **Expected Response**: `200 OK`

### 9.3 [Error] List Audit Logs - Invalid Date Format
* **Method**: `GET`
* **URL**: `http://localhost:4000/api/v1/organizations/<organizationId>/audit-logs?startDate=not-a-date`
* **Headers**: `Authorization: Bearer <adminAccessToken>`
* **Expected Response**: `400 Bad Request`

---

## 10. Global Error Handling

### 10.1 Route Not Found (404)
* **Method**: `GET`
* **URL**: `http://localhost:4000/api/v1/unknown-endpoint-route`
* **Expected Response**: `404 Not Found`
```json
{
  "success": false,
  "error": { "code": "NOT_FOUND", "message": "Route not found" }
}
```

### 10.2 Malformed JSON Body (400)
* **Method**: `POST`
* **URL**: `http://localhost:4000/api/v1/auth/login`
* **Headers**: `Content-Type: application/json`
* **Body**: `{ "email": "test@test.com", }` (trailing comma)
* **Expected Response**: `400 Bad Request`
```json
{
  "success": false,
  "error": { "code": "VALIDATION_ERROR", "message": "Request body is not valid JSON" }
}
```

### 10.3 Protected Route Without Token (401)
* **Method**: `GET`
* **URL**: `http://localhost:4000/api/v1/me/profile`
* **Headers**: None
* **Expected Response**: `401 Unauthorized`
```json
{
  "success": false,
  "error": { "code": "UNAUTHENTICATED", "message": "Authentication is required" }
}
```
