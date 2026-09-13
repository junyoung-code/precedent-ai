/**
 * Vectors for the community posts, so a reader gets the one that resembles
 * their situation rather than the one that happens to share two tags.
 *
 * The panel used to narrow a shared batch on `medium` and `expressionType`
 * alone. Measured over the collected gallery posts, the rule extractor fills
 * 3.2 of its 8 fields and `medium` in only 4 of 15 — the rules read a
 * description somebody wrote answering intake questions, and a gallery does not
 * write that way. Worse, `factScore` is a ratio (`fact-tags.js:354`), so a post
 * comparable on two weak fields scores a perfect 100 and outranks a richer one
 * that disagrees about anything.
 *
 * So the matching moves to where the precedent side already does it: embed
 * both, compare by cosine. This module is the storage half of that.
 *
 * A post is embedded once, ever. The key is its address, which survives a cache
 * refresh — the batch is rewritten daily and re-embedding the same post each
 * time would be paying repeatedly for an answer that cannot change.
 */

import { DEFAULT_EMBEDDING_MODEL } from "./embedding-client.mjs";
import { buildWebCaseEmbeddingInput, hashEmbeddingInput } from "./embedding-input.mjs";
import { toVectorLiteral } from "./precedent-embeddings.mjs";

const UPSERT_SQL = `INSERT INTO web_case_embeddings (url, embedding, model, input_hash)
 VALUES ($1, $2::vector, $3, $4)
 ON CONFLICT (url) DO UPDATE SET
   embedding = EXCLUDED.embedding,
   model = EXCLUDED.model,
   input_hash = EXCLUDED.input_hash,
   embedded_at = now()`;

/**
 * What one stored post is compared on.
 *
 * The summary rather than the original body, because the body is not kept
 * anywhere — the batch stores a neutral quote and the post's own words stay on
 * the page they were written on.
 */
export function webCaseEmbeddingInput(item) {
  return buildWebCaseEmbeddingInput({
    text: `${item?.title || ""}\n${item?.quote || ""}`.trim(),
    facts: {
      medium: item?.medium,
      expressionType: item?.expression,
    },
  });
}

/**
 * Embeds the posts in a batch that do not already have a current vector.
 *
 * Never throws, and returns what it managed. A batch whose vectors could not be
 * written is still a batch worth showing — the ranking falls back to the tags,
 * which is what it did before any of this existed.
 */
export async function embedWebCases({ pool, embeddingClient, cases }) {
  if (!pool || !embeddingClient || !Array.isArray(cases) || cases.length === 0) {
    return { embedded: 0, skipped: 0, failed: 0 };
  }
  const model = embeddingClient.model || DEFAULT_EMBEDDING_MODEL;
  const urls = cases.map((item) => item.url).filter(Boolean);
  if (urls.length === 0) return { embedded: 0, skipped: 0, failed: 0 };

  let current = new Map();
  try {
    const { rows } = await pool.query(
      `SELECT url, input_hash AS "inputHash", model FROM web_case_embeddings WHERE url = ANY($1::text[])`,
      [urls],
    );
    current = new Map(rows.map((row) => [row.url, row]));
  } catch {
    return { embedded: 0, skipped: 0, failed: cases.length };
  }

  let embedded = 0;
  let skipped = 0;
  let failed = 0;
  for (const item of cases) {
    if (!item?.url) { failed += 1; continue; }
    const input = webCaseEmbeddingInput(item);
    const hash = hashEmbeddingInput(input);
    const held = current.get(item.url);
    // Same summary, same model, nothing to buy.
    if (held && held.inputHash === hash && held.model === model) { skipped += 1; continue; }
    try {
      const vector = await embeddingClient.embed(input);
      await pool.query(UPSERT_SQL, [item.url, toVectorLiteral(vector), model, hash]);
      embedded += 1;
    } catch {
      failed += 1;
    }
  }
  return { embedded, skipped, failed };
}

/**
 * How close each stored post is to what this reader described, 0 to 100.
 *
 * Returns a map keyed by address, holding only the posts that have a vector.
 * Anything missing is simply absent, and the caller ranks it on tags alone
 * rather than treating a missing vector as a distance of zero — a post nobody
 * has embedded yet is unknown, not dissimilar.
 */
export async function readWebCaseSimilarity({ pool, queryVector, urls }) {
  const wanted = (urls || []).filter(Boolean);
  if (!pool || !queryVector || wanted.length === 0) return new Map();
  try {
    const { rows } = await pool.query(
      `SELECT url, 1 - (embedding <=> $1::vector) AS "semanticScore"
         FROM web_case_embeddings
        WHERE url = ANY($2::text[])`,
      [toVectorLiteral(queryVector), wanted],
    );
    return new Map(rows.map((row) => [
      row.url,
      Math.round(Math.max(0, Math.min(Number(row.semanticScore) || 0, 1)) * 100),
    ]));
  } catch {
    return new Map();
  }
}
