import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/utils/password.js";
import { ingestResumeEmbeddings } from "../src/modules/screening/embedding.service.js";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding Smart Resume Screener & Talent Pipeline API database...");

  const defaultPassword = await hashPassword("Password123!");

  // 1. Seed Users
  const adminUser = await prisma.user.upsert({
    where: { email: "admin@talentstream.test" },
    update: {},
    create: {
      email: "admin@talentstream.test",
      passwordHash: defaultPassword,
      emailVerifiedAt: new Date(),
      accountStatus: "ACTIVE",
      candidateProfile: {
        create: {
          name: "Sarah Admin"
        }
      }
    }
  });

  const recruiterUser = await prisma.user.upsert({
    where: { email: "recruiter@talentstream.test" },
    update: {},
    create: {
      email: "recruiter@talentstream.test",
      passwordHash: defaultPassword,
      emailVerifiedAt: new Date(),
      accountStatus: "ACTIVE",
      candidateProfile: {
        create: {
          name: "Dave Recruiter"
        }
      }
    }
  });

  const candidateUser = await prisma.user.upsert({
    where: { email: "candidate@talentstream.test" },
    update: {},
    create: {
      email: "candidate@talentstream.test",
      passwordHash: defaultPassword,
      emailVerifiedAt: new Date(),
      accountStatus: "ACTIVE",
      candidateProfile: {
        create: {
          name: "Alex Candidate"
        }
      }
    }
  });

  // 2. Seed Organization
  const organization = await prisma.organization.upsert({
    where: { slug: "acme-tech" },
    update: {},
    create: {
      name: "Acme Technologies",
      slug: "acme-tech"
    }
  });

  // 3. Memberships
  await prisma.organizationMembership.upsert({
    where: {
      userId_organizationId: {
        userId: adminUser.id,
        organizationId: organization.id
      }
    },
    update: { role: "ADMIN", status: "ACTIVE" },
    create: {
      userId: adminUser.id,
      organizationId: organization.id,
      role: "ADMIN",
      status: "ACTIVE"
    }
  });

  await prisma.organizationMembership.upsert({
    where: {
      userId_organizationId: {
        userId: recruiterUser.id,
        organizationId: organization.id
      }
    },
    update: { role: "RECRUITER", status: "ACTIVE" },
    create: {
      userId: recruiterUser.id,
      organizationId: organization.id,
      role: "RECRUITER",
      status: "ACTIVE"
    }
  });

  // 4. Seed Published Job with Requirements
  let publishedJob = await prisma.job.findFirst({
    where: { organizationId: organization.id, title: "Senior Full Stack Engineer" }
  });

  if (!publishedJob) {
    publishedJob = await prisma.job.create({
      data: {
        organizationId: organization.id,
        title: "Senior Full Stack Engineer",
        description: "Join Acme Technologies to architect resilient recruitment microservices using TypeScript, Node.js, and PostgreSQL.",
        status: "PUBLISHED",
        publishedAt: new Date(),
        requirements: {
          create: [
            {
              name: "TypeScript",
              description: "5+ years enterprise TypeScript experience",
              type: "REQUIRED",
              weight: 10
            },
            {
              name: "PostgreSQL",
              description: "Deep knowledge of relational query optimization",
              type: "REQUIRED",
              weight: 10
            },
            {
              name: "Docker",
              description: "Container lifecycle and compose pipelines",
              type: "PREFERRED",
              weight: 5
            },
            {
              name: "React",
              description: "Modern frontend SPA architecture",
              type: "PREFERRED",
              weight: 5
            }
          ]
        }
      }
    });
  }

  // 5. Seed Candidate Resume & Profile
  let resume = await prisma.resume.findFirst({
    where: { candidateId: candidateUser.id, originalName: "Alex_Candidate_Resume.pdf" }
  });

  if (!resume) {
    resume = await prisma.resume.create({
      data: {
        candidateId: candidateUser.id,
        storageKey: `resumes/${candidateUser.id}/seed-resume.pdf`,
        originalName: "Alex_Candidate_Resume.pdf",
        mimeType: "application/pdf",
        sizeBytes: 104857,
        checksum: "seed-resume-checksum",
        parseStatus: "COMPLETE",
        profile: {
          create: {
            parserVersion: "1.0.0",
            extractionStatus: "SUCCESS",
            extractedData: {
              text: "Alex Candidate\nSenior Full Stack Engineer with 6+ years building microservices in TypeScript, PostgreSQL, and React.",
              wordCount: 16,
              extractedAt: new Date().toISOString()
            }
          }
        }
      }
    });
  }

  // 5b. Ensure pgvector embeddings and chunks exist for seeded resume
  const existingChunks = await prisma.resumeChunk.count({ where: { resumeId: resume.id } });
  if (existingChunks === 0) {
    try {
      await ingestResumeEmbeddings(
        resume.id,
        "Alex Candidate\nSenior Full Stack Engineer with 6+ years building microservices in TypeScript, PostgreSQL, and React."
      );
      console.log("Seeded pgvector embeddings into ResumeChunk for candidate resume.");
    } catch (err) {
      console.warn("Could not seed vector embeddings (API key or network issue):", err instanceof Error ? err.message : String(err));
    }
  }

  // 6. Seed Application & Screening Run
  let application = await prisma.application.findFirst({
    where: { candidateId: candidateUser.id, jobId: publishedJob.id }
  });

  if (!application) {
    application = await prisma.application.create({
      data: {
        candidateId: candidateUser.id,
        jobId: publishedJob.id,
        resumeId: resume.id,
        status: "IN_REVIEW",
        coverLetter: "Excited to bring my full-stack background to Acme Technologies!",
        events: {
          create: [
            {
              actorUserId: candidateUser.id,
              fromStatus: null,
              toStatus: "SUBMITTED",
              candidateVisible: true
            },
            {
              actorUserId: recruiterUser.id,
              fromStatus: "SUBMITTED",
              toStatus: "SCREENING",
              reason: "Screening run queued",
              candidateVisible: false
            },
            {
              fromStatus: "SCREENING",
              toStatus: "IN_REVIEW",
              reason: "Automated screening completed with score 85",
              candidateVisible: false
            }
          ]
        },
        notes: {
          create: [
            {
              authorId: recruiterUser.id,
              body: "Strong candidate with comprehensive TypeScript and PostgreSQL competencies. Shortlist for technical interview."
            }
          ]
        },
        screeningRuns: {
          create: [
            {
              status: "COMPLETE",
              score: 85.0,
              provider: "google-gemini",
              model: "gemini-1.5-flash",
              promptVersion: "1.0.0",
              scoreBreakdown: {
                deterministicScore: 80,
                aiAdvisoryScore: 90,
                combinedScore: 85,
                requiredPassed: 2,
                requiredTotal: 2,
                preferredPassed: 1,
                preferredTotal: 2
              },
              evidence: {
                summary: "Candidate exhibits high technical alignment with core TypeScript and database requirements.",
                strengths: [
                  "Demonstrated 6+ years TypeScript and backend experience",
                  "Verified PostgreSQL query and schema design"
                ],
                gaps: [
                  "Containerization experience (Docker) requires interview validation"
                ],
                recommendation: "ADVANCE",
                suggestedQuestions: [
                  "How do you design database migration rollbacks in mission-critical applications?"
                ]
              },
              finishedAt: new Date()
            }
          ]
        }
      }
    });
  }

  // 7. Seed Audit Log Entries
  await prisma.auditLog.createMany({
    data: [
      {
        actorId: adminUser.id,
        organizationId: organization.id,
        action: "organization.create",
        resourceType: "Organization",
        resourceId: organization.id,
        metadata: { name: organization.name }
      },
      {
        actorId: adminUser.id,
        organizationId: organization.id,
        action: "job.create",
        resourceType: "Job",
        resourceId: publishedJob.id,
        metadata: { title: publishedJob.title }
      }
    ]
  });

  console.log("Seeding completed successfully!");
  console.log("Seed Accounts (Password: Password123!):");
  console.log(`- Admin: ${adminUser.email}`);
  console.log(`- Recruiter: ${recruiterUser.email}`);
  console.log(`- Candidate: ${candidateUser.email}`);
  console.log(`- Organization: ${organization.name} (${organization.slug})`);
}

main()
  .catch((error) => {
    console.error("Seeding failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());