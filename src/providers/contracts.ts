export interface AiProvider {
  screenResume(input: { resumeText: string; jobDescription: string }): Promise<unknown>;
}

export interface EmailProvider {
  send(input: { recipient: string; subject: string; body: string }): Promise<{ messageId: string }>;
}

export interface ObjectStorageProvider {
  put(input: { key: string; content: Buffer; contentType: string }): Promise<void>;
  get(key: string): Promise<Buffer>;
}