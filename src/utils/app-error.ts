export type ErrorDetail = { field: string; message: string };

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
    public readonly details?: ErrorDetail[]
  ) {
    super(message);
    this.name = "AppError";
  }
}