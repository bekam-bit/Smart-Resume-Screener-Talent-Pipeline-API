import { extractText } from "unpdf";
import mammoth from "mammoth";
import { prisma } from "../../config/prisma.js";
import { getObject } from "../../providers/s3.storage.js";
import { AppError } from "../../utils/app-error.js";
import { withDbRetry } from "../../utils/db-retry.js";
import { logger } from "../../utils/logger.js";
import { ingestResumeEmbeddings } from "./embedding.service.js";

export interface ExtractedResume {
  text: string;
  wordCount: number;
  source: "cached" | "parsed";
}

/**
 * Normalizes extracted text by stripping non-printable characters and collapsing excessive whitespace.
 */
export const normalizeExtractedText = (raw: string): string => {
  return raw
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

/**
 * Parses raw text from a binary buffer depending on MIME type / filename.
 */
export const parseBufferToText = async (
  buffer: Buffer,
  mimeType: string,
  filename: string
): Promise<string> => {
  const lowerName = filename.toLowerCase();

  if (mimeType === "application/pdf" || lowerName.endsWith(".pdf")) {
    const parsed = await extractText(new Uint8Array(buffer));
    const raw = Array.isArray(parsed.text) ? parsed.text.join("\n") : (parsed.text ?? "");
    return normalizeExtractedText(raw);
  }

  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType === "application/msword" ||
    lowerName.endsWith(".docx")
  ) {
    const result = await mammoth.extractRawText({ buffer });
    return normalizeExtractedText(result.value ?? "");
  }

  if (mimeType.startsWith("text/") || lowerName.endsWith(".txt")) {
    return normalizeExtractedText(buffer.toString("utf-8"));
  }

  throw new AppError("UNSUPPORTED_RESUME_FORMAT", `Unsupported resume MIME type: ${mimeType}`, 400);
};

/**
 * Extracts and caches resume text from S3 into ResumeProfile.
 * If a valid profile exists, the cached text is returned immediately.
 */
export const extractResumeText = async (resumeId: string): Promise<ExtractedResume> => {
  const resume = await withDbRetry(() =>
    prisma.resume.findUnique({
      where: { id: resumeId },
      include: { profile: true }
    })
  );

  if (!resume) {
    throw new AppError("RESUME_NOT_FOUND", "Resume not found", 404);
  }

  // Check cached profile
  if (
    resume.profile &&
    resume.profile.extractionStatus === "SUCCESS" &&
    typeof resume.profile.extractedData === "object" &&
    resume.profile.extractedData !== null &&
    "text" in resume.profile.extractedData
  ) {
    const data = resume.profile.extractedData as { text: string; wordCount?: number };

    // Ensure vector chunks exist if parsed prior to embedding pipeline
    const existingChunkCount = await withDbRetry(() =>
      prisma.resumeChunk.count({ where: { resumeId } })
    );
    if (existingChunkCount === 0 && data.text) {
      ingestResumeEmbeddings(resumeId, data.text).catch((err) => {
        logger.warn("cached_resume_embedding_ingestion_deferred", {
          resumeId,
          error: err instanceof Error ? err.message : String(err)
        });
      });
    }

    return {
      text: data.text,
      wordCount: data.wordCount ?? data.text.split(/\s+/).filter(Boolean).length,
      source: "cached"
    };
  }

  // Mark processing
  await withDbRetry(() =>
    prisma.resume.update({
      where: { id: resumeId },
      data: { parseStatus: "PROCESSING" }
    })
  );

  try {
    const buffer = await getObject(resume.storageKey);
    const text = await parseBufferToText(buffer, resume.mimeType, resume.originalName);
    const wordCount = text.split(/\s+/).filter(Boolean).length;

    await withDbRetry(() =>
      prisma.$transaction(async (tx) => {
        await tx.resumeProfile.upsert({
          where: { resumeId },
          create: {
            resumeId,
            parserVersion: "1.0.0",
            extractionStatus: "SUCCESS",
            extractedData: {
              text,
              wordCount,
              extractedAt: new Date().toISOString()
            }
          },
          update: {
            parserVersion: "1.0.0",
            extractionStatus: "SUCCESS",
            extractedData: {
              text,
              wordCount,
              extractedAt: new Date().toISOString()
            }
          }
        });

        await tx.resume.update({
          where: { id: resumeId },
          data: { parseStatus: "COMPLETE" }
        });
      })
    );

    // Ingest chunks and embeddings into pgvector table ResumeChunk
    try {
      await ingestResumeEmbeddings(resumeId, text);
    } catch (embErr) {
      logger.warn("resume_embedding_ingestion_warning", {
        resumeId,
        error: embErr instanceof Error ? embErr.message : String(embErr)
      });
    }

    logger.info("resume_extracted", {
      resumeId,
      wordCount,
      length: text.length
    });

    return { text, wordCount, source: "parsed" };
  } catch (error) {
    logger.error("resume_extraction_failed", {
      resumeId,
      error: error instanceof Error ? error.message : String(error)
    });

    await withDbRetry(() =>
      prisma.$transaction(async (tx) => {
        await tx.resumeProfile.upsert({
          where: { resumeId },
          create: {
            resumeId,
            parserVersion: "1.0.0",
            extractionStatus: "FAILED",
            extractedData: {
              error: error instanceof Error ? error.message : "Unknown extraction error",
              failedAt: new Date().toISOString()
            }
          },
          update: {
            extractionStatus: "FAILED",
            extractedData: {
              error: error instanceof Error ? error.message : "Unknown extraction error",
              failedAt: new Date().toISOString()
            }
          }
        });

        await tx.resume.update({
          where: { id: resumeId },
          data: { parseStatus: "FAILED" }
        });
      })
    ).catch(() => {});

    throw new AppError("EXTRACTION_FAILED", "Failed to extract text from resume file", 422);
  }
};
