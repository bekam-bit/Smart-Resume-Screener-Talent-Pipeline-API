import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

/**
 * Deterministic hash-based normalized vector generator for offline fallback/testing.
 * Guarantees that similar texts produce closer cosine distance, while allowing
 * 100% test reliability when network calls are unavailable.
 */
export const generateFallbackEmbedding = (text: string, dimension = env.EMBEDDING_DIMENSION): number[] => {
  const vector = new Array<number>(dimension).fill(0);
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);

  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    let hash = 0;
    for (let c = 0; c < word.length; c++) {
      hash = (hash * 31 + word.charCodeAt(c)) & 0x7fffffff;
    }
    const idx = hash % dimension;
    vector[idx] = (vector[idx] ?? 0) + 1.0;
  }

  // L2-normalize vector for unit length
  const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  if (norm === 0) return vector;
  return vector.map((val) => val / norm);
};

export interface OpenRouterEmbeddingResponse {
  data?: Array<{
    embedding?: number[];
    index?: number;
  }>;
}

/**
 * Generates embeddings for one or more text passages using OpenRouter embedding models.
 * Automatically falls back to deterministic vector generation if offline or in test environments.
 */
export const getEmbeddings = async (
  texts: string | string[],
  options?: { model?: string }
): Promise<number[][]> => {
  const textArray = Array.isArray(texts) ? texts : [texts];
  if (textArray.length === 0) return [];

  const apiKey = env.OPENROUTER_API_KEY;
  const model = options?.model ?? env.OPENROUTER_EMBED_MODEL;

  if (!apiKey || env.NODE_ENV === "test") {
    return textArray.map((t) => generateFallbackEmbedding(t));
  }

  try {
    const response = await fetch(`${env.OPENROUTER_BASE_URL}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": env.OPENROUTER_SITE_URL,
        "X-Title": env.OPENROUTER_SITE_NAME
      },
      body: JSON.stringify({
        model,
        input: textArray
      }),
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      logger.warn("openrouter_embeddings_fallback", {
        status: response.status,
        statusText: response.statusText,
        model
      });
      return textArray.map((t) => generateFallbackEmbedding(t));
    }

    const json = (await response.json()) as OpenRouterEmbeddingResponse;
    const embeddings = json.data?.map((d) => d.embedding).filter((e): e is number[] => Array.isArray(e));

    if (!embeddings || embeddings.length !== textArray.length) {
      return textArray.map((t) => generateFallbackEmbedding(t));
    }

    return embeddings;
  } catch (error) {
    logger.warn("openrouter_embeddings_error", {
      error: error instanceof Error ? error.message : String(error)
    });
    return textArray.map((t) => generateFallbackEmbedding(t));
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
    const response = await fetch(`${env.OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": env.OPENROUTER_SITE_URL,
        "X-Title": env.OPENROUTER_SITE_NAME
      },
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
