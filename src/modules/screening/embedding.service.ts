import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { withDbRetry } from "../../utils/db-retry.js";
import { logger } from "../../utils/logger.js";
import { getEmbeddings } from "../../providers/openrouter.ai.js";
import { chunkText } from "./chunking.service.js";

export interface RetrievedChunk {
  id: string;
  chunkIndex: number;
  content: string;
  similarity: number;
  distance: number;
}

/**
 * Formats a numeric array into a PostgreSQL vector literal '[0.1,0.2,...]'.
 */
export const formatVectorLiteral = (vector: number[]): string => {
  return `[${vector.join(",")}]`;
};

/**
 * Ingests and embeds a resume's text into vector-indexed chunks in PostgreSQL.
 */
export const ingestResumeEmbeddings = async (
  resumeId: string,
  text: string
): Promise<{ chunkCount: number; indexed: boolean }> => {
  const chunks = chunkText(text, 900, 120);
  if (chunks.length === 0) {
    return { chunkCount: 0, indexed: false };
  }

  // 1. Generate embeddings using OpenRouter
  const embeddings = await getEmbeddings(chunks);

  // 2. Clear old chunks for idempotency
  await withDbRetry(() =>
    prisma.resumeChunk.deleteMany({
      where: { resumeId }
    })
  );

  // 3. Insert chunks and attach vectors
  for (let i = 0; i < chunks.length; i++) {
    const content = chunks[i]!;
    const vector = embeddings[i];

    const created = await withDbRetry(() =>
      prisma.resumeChunk.create({
        data: {
          resumeId,
          chunkIndex: i,
          content,
          tokenCount: content.split(/\s+/).filter(Boolean).length
        },
        select: { id: true }
      })
    );

    if (vector && vector.length > 0) {
      const vectorLiteral = formatVectorLiteral(vector);
      await withDbRetry(() =>
        prisma.$executeRaw(
          Prisma.sql`UPDATE "ResumeChunk" SET embedding = ${vectorLiteral}::vector WHERE id = ${created.id}::uuid`
        )
      );
    }
  }

  logger.info("resume_embeddings_ingested", {
    resumeId,
    chunkCount: chunks.length
  });

  return { chunkCount: chunks.length, indexed: true };
};

/**
 * Performs semantic search over a resume's chunks using pgvector cosine distance (<=>).
 * Returns the most semantically relevant passages with similarity scores.
 */
export const retrieveSimilarResumeChunks = async (
  resumeId: string,
  query: string,
  topK = 5
): Promise<RetrievedChunk[]> => {
  const [queryEmbedding] = await getEmbeddings([query]);
  if (!queryEmbedding || queryEmbedding.length === 0) {
    return [];
  }

  const vectorLiteral = formatVectorLiteral(queryEmbedding);

  const rawResults = await withDbRetry(() =>
    prisma.$queryRaw<
      Array<{
        id: string;
        chunkIndex: number;
        content: string;
        similarity: number;
        distance: number;
      }>
    >(
      Prisma.sql`
        SELECT id, "chunkIndex", content,
               (1 - (embedding <=> ${vectorLiteral}::vector))::float AS similarity,
               (embedding <=> ${vectorLiteral}::vector)::float AS distance
        FROM "ResumeChunk"
        WHERE "resumeId" = ${resumeId}::uuid
          AND embedding IS NOT NULL
        ORDER BY embedding <=> ${vectorLiteral}::vector ASC
        LIMIT ${topK}
      `
    )
  );

  return rawResults.map((r) => ({
    id: r.id,
    chunkIndex: r.chunkIndex,
    content: r.content,
    similarity: Math.round(r.similarity * 1000) / 1000,
    distance: Math.round(r.distance * 1000) / 1000
  }));
};
