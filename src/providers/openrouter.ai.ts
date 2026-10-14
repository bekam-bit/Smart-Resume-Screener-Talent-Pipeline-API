import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { AppError } from "../utils/app-error.js";

export interface OpenRouterEmbeddingResponse {
  data?: Array<{
    embedding?: number[];
    index?: number;
  }>;
}

/**
 * Generates genuine neural embeddings for one or more text passages using OpenRouter embedding models.
 * Fails fast with clear AppError diagnostics if credentials are missing or the API encounters errors,
 * preventing synthetic/corrupted vectors from polluting pgvector storage.
 */
export const getEmbeddings = async (
  texts: string | string[],
  options?: { model?: string }
): Promise<number[][]> => {
  const textArray = Array.isArray(texts) ? texts : [texts];
  if (textArray.length === 0) return [];

  const apiKey = env.OPENROUTER_API_KEY;
  const model = options?.model ?? env.OPENROUTER_EMBED_MODEL;

  if (!apiKey) {
    throw new AppError(
      "OPENROUTER_CONFIG_ERROR",
      "OpenRouter API key is not configured. Genuine AI embeddings require a valid API key.",
      500
    );
  }

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": env.OPENROUTER_SITE_URL,
      "X-Title": env.OPENROUTER_SITE_NAME
    };

    const response = await fetch(`${env.OPENROUTER_BASE_URL}/embeddings`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        input: textArray
      }),
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      logger.error("openrouter_embeddings_failed", {
        status: response.status,
        statusText: response.statusText,
        model
      });
      throw new AppError(
        "OPENROUTER_EMBEDDING_FAILED",
        `OpenRouter embeddings request failed with status ${response.status}: ${response.statusText}`,
        502
      );
    }

    const json = (await response.json()) as OpenRouterEmbeddingResponse;
    const embeddings = json.data?.map((d) => d.embedding).filter((e): e is number[] => Array.isArray(e));

    if (!embeddings || embeddings.length !== textArray.length) {
      logger.error("openrouter_embeddings_incomplete", {
        model,
        expectedLength: textArray.length,
        receivedLength: embeddings?.length ?? 0
      });
      throw new AppError(
        "OPENROUTER_EMBEDDING_INCOMPLETE",
        "OpenRouter embeddings response is malformed or missing vector data",
        502
      );
    }

    return embeddings;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    logger.error("openrouter_embeddings_error", {
      error: error instanceof Error ? error.message : String(error)
    });
    throw new AppError(
      "OPENROUTER_EMBEDDING_ERROR",
      `Failed to generate embeddings: ${error instanceof Error ? error.message : String(error)}`,
      502
    );
  }
};

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Generates text completions via OpenRouter with model fallback routing.
 */
export const completeChat = async (
  messages: ChatMessage[],
  options?: {
    model?: string;
    temperature?: number;
    responseFormatJson?: boolean;
    timeoutMs?: number;
  }
): Promise<string | null> => {
  const apiKey = env.OPENROUTER_API_KEY;
  const primaryModel = options?.model ?? env.OPENROUTER_TEXT_MODEL;

  if (!apiKey || env.NODE_ENV === "test") {
    return null;
  }

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": env.OPENROUTER_SITE_URL,
      "X-Title": env.OPENROUTER_SITE_NAME
    };

    const response = await fetch(`${env.OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: primaryModel,
        models: [
          primaryModel,
          "google/gemma-4-26b-a4b-it:free",
          "mistralai/mistral-7b-instruct:free",
          "deepseek/deepseek-chat:free"
        ],
        messages,
        temperature: options?.temperature ?? 0.2,
        ...(options?.responseFormatJson ? { response_format: { type: "json_object" } } : {})
      }),
      signal: AbortSignal.timeout(options?.timeoutMs ?? 15000)
    });

    if (!response.ok) {
      logger.warn("openrouter_chat_fallback", {
        status: response.status,
        statusText: response.statusText
      });
      return null;
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    };

    return data.choices?.[0]?.message?.content ?? null;
  } catch (error) {
    logger.warn("openrouter_chat_error", {
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
};
