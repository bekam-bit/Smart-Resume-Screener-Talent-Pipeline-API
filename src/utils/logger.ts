type LogFields = Record<string, unknown>;

/** Keys whose values must never reach the logs (tokens, secrets, resume content). */
const SENSITIVE_KEY_PATTERN = /token|password|secret|authorization|cookie|api[-_]?key|resume|body|content/i;
const REDACTED = "[redacted]";

const sanitize = (value: unknown, depth = 0): unknown => {
  if (value === null || value === undefined) return value;
  if (depth > 4) return "[truncated]";
  if (Buffer.isBuffer(value)) return `[buffer ${value.length}b]`;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitize(item, depth + 1));
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as LogFields)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : sanitize(entry, depth + 1);
    }
    return output;
  }
  if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}...` : value;
  return value;
};

const write = (level: "info" | "warn" | "error", event: string, fields?: LogFields) => {
  const entry = JSON.stringify({
    level,
    time: new Date().toISOString(),
    event,
    ...(sanitize(fields ?? {}) as LogFields)
  });
  if (level === "error") console.error(entry);
  else if (level === "warn") console.warn(entry);
  else console.log(entry);
};

export const logger = {
  info: (event: string, fields?: LogFields) => write("info", event, fields),
  warn: (event: string, fields?: LogFields) => write("warn", event, fields),
  error: (event: string, fields?: LogFields) => write("error", event, fields)
};