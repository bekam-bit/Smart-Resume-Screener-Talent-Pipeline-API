import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../config/env.js";
import { AppError } from "../utils/app-error.js";

/**
 * S3-compatible object storage. Configured for the Neon S3 endpoint via
 * `AWS_ENDPOINT_URL_S3` with path-style addressing (required by most
 * S3-compatible providers that aren't AWS). Credentials are picked up from
 * the standard AWS_* environment variables.
 */
const client = new S3Client({
  region: env.AWS_REGION,
  endpoint: env.AWS_ENDPOINT_URL_S3,
  forcePathStyle: true
});

const bucket = env.S3_BUCKET;

export const putObject = async (input: { key: string; content: Buffer; contentType: string }) => {
  try {
    await client.send(
      new PutObjectCommand({ Bucket: bucket, Key: input.key, Body: input.content, ContentType: input.contentType })
    );
  } catch (error) {
    throw new AppError(
      "STORAGE_UNAVAILABLE",
      "Could not store the uploaded file, please try again",
      503
    );
  }
};

export const getObject = async (key: string): Promise<Buffer> => {
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const bytes = await result.Body?.transformToByteArray();
    if (!bytes) throw new AppError("STORAGE_NOT_FOUND", "Stored file could not be read", 404);
    return Buffer.from(bytes);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("STORAGE_UNAVAILABLE", "Could not read the stored file", 503);
  }
};

export const deleteObject = async (key: string) => {
  try {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    // Deleting a missing object is a no-op for our purposes; surface real failures.
    console.error("Failed to delete stored object", key, error instanceof Error ? error.message : error);
  }
};

/**
 * Returns a short-lived URL that grants temporary read access to a private
 * object. Raw files are never proxied through the API.
 */
export const getPresignedGetUrl = async (key: string, expiresInSeconds = env.S3_PRESIGN_EXPIRY_SECONDS) => {
  try {
    return await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
      expiresIn: expiresInSeconds
    });
  } catch {
    throw new AppError("STORAGE_UNAVAILABLE", "Could not create a download link", 503);
  }
};

export const storageBucket = bucket;
