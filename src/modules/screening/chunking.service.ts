/**
 * Splits document text into overlapping chunks designed for semantic retrieval.
 * Preserves sentence and paragraph boundaries when possible.
 */
export const chunkText = (text: string, size = 900, overlap = 120): string[] => {
  if (size <= 0 || overlap < 0 || overlap >= size) {
    throw new Error("Require size > overlap >= 0");
  }

  const cleanText = text.replace(/\r\n/g, "\n").trim();
  if (!cleanText) return [];

  if (cleanText.length <= size) {
    return [cleanText];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < cleanText.length) {
    let end = start + size;

    if (end < cleanText.length) {
      // Look for natural sentence or paragraph boundaries within the last 20% of the chunk
      const searchRegion = cleanText.slice(start + Math.floor(size * 0.75), end);
      const boundaryMatch = searchRegion.match(/(\.\s+|\n\n|\n)/);

      if (boundaryMatch && boundaryMatch.index !== undefined) {
        end = start + Math.floor(size * 0.75) + boundaryMatch.index + boundaryMatch[0].length;
      }
    } else {
      end = cleanText.length;
    }

    const chunk = cleanText.slice(start, end).trim();
    if (chunk) {
      chunks.push(chunk);
    }

    if (end >= cleanText.length) {
      break;
    }

    start = Math.max(start + 1, end - overlap);
  }

  return chunks;
};
