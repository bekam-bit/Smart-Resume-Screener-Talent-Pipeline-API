import multer from "multer";
import { env } from "../config/env.js";
import { AppError } from "../utils/app-error.js";

const allowedMimeTypes = new Map<string, string>([
  ["application/pdf", "pdf"],
  [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "docx"
  ]
]);

/**
 * In-memory upload for resume files only. The buffer is forwarded to object
 * storage; nothing is ever written to the local disk. Enforces a MIME-type
 * allow-list (PDF / DOCX) and the configured size cap.
 */
export const uploadResume = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_RESUME_SIZE_BYTES, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(new AppError("UNSUPPORTED_FILE_TYPE", "Only PDF and DOCX resumes are accepted", 415));
      return;
    }
    callback(null, true);
  }
}).single("resume");

export const resumeExtensionFor = (mimeType: string) => allowedMimeTypes.get(mimeType) ?? "bin";
