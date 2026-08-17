import { compareFactTags, extractFactTags } from "../src/lib/fact-tags.js";
import { buildQueryEmbeddingInput } from "./embedding-input.mjs";
import { toVectorLiteral } from "./precedent-embeddings.mjs";
import {
  classifyPrecedentFocus,
  focusPenalty,
  isFocusedCommunicationObscenity,
} from "./precedent-scope.mjs";
import { SUMMARY_VERSION } from "./precedent-summaries.mjs";

export const MINIMUM_RETRIEVAL_SCORE = 55;
export const LEXICAL_SCORE_CAP = 0.5;

function searchError(code, message) {
  return Object.assign(new Error(message), { code });
}

function publicFacts(facts) {
  const { normalizedText: _normalizedText, ...safe } = facts;
  return safe;
}

function isCommunicationObscenityQuery(facts) {
  return facts.expressionType !== "other" || facts.issueTags.includes("성적표현");
}

function rowFacts(row) {
  return {
    medium: row.medium || "unknown",
    messageForm: row.messageForm || "text",
    recipientIdentification: row.recipientIdentification || "unknown",
    reachedRecipient: row.reachedRecipient || "unknown",
    relationship: row.relationship || "unknown",
    context: row.context || "unknown",
    expressionType: row.expressionType || "other",
    repetition: row.repetition || "unknown",
    additionalChannels: row.additionalChannels || [],
    issueTags: row.issueTags || [],
    extractionVersion: row.factExtractionVersion || null,
  };
}

function publicStoredSummary(row) {
  if (!isFocusedCommunicationObscenity(row.caseName)
    || row.summaryVersion !== SUMMARY_VERSION
    || !Array.isArray(row.summarySentences)
    || row.summarySentences.length < 1
    || row.summarySentences.length > 3) return null;

  const summary = [];
  for (const sentence of row.summarySentences) {
    const text = typeof sentence?.text === "string" ? sentence.text.trim() : "";
    const paragraphIds = Array.isArray(sentence?.paragraphIds) ? sentence.paragraphIds : [];
    if (!text || paragraphIds.length < 1 || paragraphIds.some((id) => typeof id !== "string" || !id)) return null;
    summary.push({
      text,
      sourceAnchor: paragraphIds.map((id) => `판결문 문단 ${id}`).join(", "),
    });
  }
  return summary;
}

function publicRow(row) {
  const { summarySentences: _summarySentences, summaryVersion: _summaryVersion, ...safe } = row;
  return { ...safe, summary: publicStoredSummary(row) };
}

function lexicalScore(value) {
  const ratio = (Number(value) || 0) / LEXICAL_SCORE_CAP;
  return Math.round(Math.max(0, Math.min(ratio, 1)) * 100);
}

function scoredFocus(caseName, baseScore) {
  const precedentFocus = classifyPrecedentFocus(caseName);
  const penalty = focusPenalty(precedentFocus);
  return {
    precedentFocus,
    focusPenalty: penalty,
    retrievalScore: Math.max(0, Math.round(baseScore - penalty)),
  };
}

export function rankTaggedCandidates(queryFacts, rows, limit) {
  return rows
    .map((row) => {
      const facts = rowFacts(row);
      const comparison = compareFactTags(queryFacts, facts);
      const keywordScore = Number(row.keywordScore) || 0;
      const score = scoredFocus(
        row.caseName,
        lexicalScore(keywordScore) * 0.45 + comparison.factScore * 0.45 + comparison.issueScore * 0.1,
      );

      return {
        ...publicRow(row),
        keywordScore,
        tagScore: comparison.factScore,
        issueScore: comparison.issueScore,
        ...score,
        matchedFacts: comparison.matchedFacts,
        differentFacts: comparison.differentFacts,
        factTags: facts,
      };
    })
    .sort((left, right) =>
      right.retrievalScore - left.retrievalScore
      || right.tagScore - left.tagScore
      || String(right.decisionDate).localeCompare(String(left.decisionDate))
      || String(left.id).localeCompare(String(right.id)))
    .filter((row) => row.retrievalScore >= MINIMUM_RETRIEVAL_SCORE)
    .slice(0, limit);
}

export function rankHybridCandidates(queryFacts, rows, limit) {
  const ranked = rows
    .map((row) => {
      const facts = rowFacts(row);
      const comparison = compareFactTags(queryFacts, facts);
      const semanticScore = Math.max(0, Math.min(Number(row.semanticScore) || 0, 1));
      const score = scoredFocus(
        row.caseName,
        semanticScore * 100 * 0.45 + comparison.factScore * 0.45 + comparison.issueScore * 0.1,
      );
      return {
        ...publicRow(row),
        semanticScore: Math.round(semanticScore * 100),
        tagScore: comparison.factScore,
        issueScore: comparison.issueScore,
        ...score,
        matchedFacts: comparison.matchedFacts,
        differentFacts: comparison.differentFacts,
        factTags: facts,
      };
    })
    .sort((left, right) =>
      right.retrievalScore - left.retrievalScore
      || String(right.decisionDate).localeCompare(String(left.decisionDate))
      || String(left.id).localeCompare(String(right.id)))
    .filter((row) => row.retrievalScore >= MINIMUM_RETRIEVAL_SCORE);

  return ranked.slice(0, limit);
}

export function normalizeSearchQuery(query, limit = 5) {
  const tokens = String(query || "")
    .normalize("NFKC")
    .split(/\s+/)
    .map((token) => token.replace(/[^\p{L}\p{N}]+/gu, ""))
    .filter((token) => token.length >= 2)
    .slice(0, 12);

  if (tokens.length === 0) {
    throw searchError("SEARCH_QUERY_REQUIRED", "두 글자 이상의 검색어가 필요합니다.");
  }

  return {
    text: tokens.join(" "),
    expression: [...new Set(tokens)].join(" OR "),
    limit: Math.min(Math.max(Number(limit) || 5, 1), 5),
  };
}

async function searchWithoutEmbeddings({ pool, normalized, queryFacts, fallbackCode = null }) {
  const [countResult, searchResult] = await Promise.all([
    pool.query(
      `SELECT count(*) FROM precedents
       WHERE searchable = true
         AND case_name ILIKE '%통신매체이용음란%'`,
    ),
    pool.query(
      `SELECT
         p.id,
         p.court,
         p.case_number AS "caseNumber",
         p.case_name AS "caseName",
         to_char(p.decision_date, 'YYYY-MM-DD') AS "decisionDate",
         p.official_url AS "officialUrl",
         to_char(p.link_checked_at, 'YYYY-MM-DD') AS "verifiedAt",
         ts_rank_cd(p.search_vector, websearch_to_tsquery('simple', $1)) AS "keywordScore",
         left(regexp_replace(p.source_text, '<[^>]+>', ' ', 'g'), 360) AS snippet,
         f.extraction_version AS "factExtractionVersion",
         f.medium,
         f.message_form AS "messageForm",
         f.recipient_identification AS "recipientIdentification",
         f.reached_recipient AS "reachedRecipient",
         f.relationship,
         f.context,
         f.expression_type AS "expressionType",
         f.repetition,
         COALESCE(f.additional_channels, '{}') AS "additionalChannels",
         COALESCE(f.issue_tags, '{}') AS "issueTags",
         s.summary_version AS "summaryVersion",
         s.sentences AS "summarySentences"
       FROM precedents p
       LEFT JOIN precedent_fact_tags f ON f.precedent_id = p.id
       LEFT JOIN precedent_summaries s
         ON s.precedent_id = p.id
        AND s.source_hash = p.source_hash
       WHERE p.searchable = true
         AND p.case_name ILIKE '%통신매체이용음란%'
         AND (
           p.search_vector @@ websearch_to_tsquery('simple', $1)
           OR ($2 <> 'unknown' AND f.medium = $2)
           OR ($3 <> 'unknown' AND f.message_form = $3)
           OR ($4 <> 'unknown' AND f.recipient_identification = $4)
           OR ($5 <> 'unknown' AND f.reached_recipient = $5)
           OR ($6 <> 'unknown' AND f.relationship = $6)
           OR ($7 <> 'unknown' AND f.context = $7)
           OR ($8 <> 'other' AND f.expression_type = $8)
           OR ($9 <> 'unknown' AND f.repetition = $9)
           OR (cardinality($10::text[]) > 0 AND f.issue_tags && $10::text[])
         )
       ORDER BY "keywordScore" DESC, p.decision_date DESC, p.id
       LIMIT $11`,
      [
        normalized.expression,
        queryFacts.medium,
        queryFacts.messageForm,
        queryFacts.recipientIdentification,
        queryFacts.reachedRecipient,
        queryFacts.relationship,
        queryFacts.context,
        queryFacts.expressionType,
        queryFacts.repetition,
        queryFacts.issueTags,
        50,
      ],
    ),
  ]);

  return {
    query: normalized.text,
    queryFacts: publicFacts(queryFacts),
    availableCount: Number(countResult.rows[0].count),
    comparedCount: searchResult.rows.length,
    scoring: {
      status: fallbackCode ? "fallback_without_embeddings" : "provisional_without_embeddings",
      fallbackCode,
      lexicalWeight: 0.45,
      factTagWeight: 0.45,
      issueTagWeight: 0.1,
      lexicalScoreCap: LEXICAL_SCORE_CAP,
      minimumScore: MINIMUM_RETRIEVAL_SCORE,
    },
    results: rankTaggedCandidates(queryFacts, searchResult.rows, normalized.limit),
  };
}

async function searchOutOfScope({ pool, normalized, queryFacts }) {
  const countResult = await pool.query(
    `SELECT count(*) FROM precedents
     WHERE searchable = true
       AND case_name ILIKE '%통신매체이용음란%'`,
  );

  return {
    query: normalized.text,
    queryFacts: publicFacts(queryFacts),
    availableCount: Number(countResult.rows[0].count),
    comparedCount: 0,
    scoring: {
      status: "query_out_of_scope",
      minimumScore: MINIMUM_RETRIEVAL_SCORE,
    },
    results: [],
  };
}

export async function searchPrecedents({ pool, query, limit = 5, embeddingClient = null }) {
  const normalized = normalizeSearchQuery(query, limit);
  const queryFacts = extractFactTags(query);
  if (!isCommunicationObscenityQuery(queryFacts)) {
    return searchOutOfScope({ pool, normalized, queryFacts });
  }
  if (!embeddingClient) return searchWithoutEmbeddings({ pool, normalized, queryFacts });

  let queryVector;
  try {
    queryVector = await embeddingClient.embed(buildQueryEmbeddingInput(query));
  } catch (error) {
    return searchWithoutEmbeddings({
      pool,
      normalized,
      queryFacts,
      fallbackCode: error.code || "EMBEDDING_API_UNAVAILABLE",
    });
  }

  const [countResult, searchResult] = await Promise.all([
    pool.query(
       `SELECT count(*) FROM precedents
       WHERE searchable = true
         AND case_name ILIKE '%통신매체이용음란%'
         AND verified_at IS NOT NULL
         AND link_checked_at >= now() - interval '24 hours'
         AND link_status BETWEEN 200 AND 399
         AND embedding IS NOT NULL`,
    ),
    pool.query(
      `SELECT
         p.id,
         p.court,
         p.case_number AS "caseNumber",
         p.case_name AS "caseName",
         to_char(p.decision_date, 'YYYY-MM-DD') AS "decisionDate",
         p.official_url AS "officialUrl",
         to_char(p.link_checked_at, 'YYYY-MM-DD') AS "verifiedAt",
         1 - (p.embedding <=> $1::vector) AS "semanticScore",
         left(regexp_replace(p.source_text, '<[^>]+>', ' ', 'g'), 360) AS snippet,
         f.extraction_version AS "factExtractionVersion",
         f.medium,
         f.message_form AS "messageForm",
         f.recipient_identification AS "recipientIdentification",
         f.reached_recipient AS "reachedRecipient",
         f.relationship,
         f.context,
         f.expression_type AS "expressionType",
         f.repetition,
         COALESCE(f.additional_channels, '{}') AS "additionalChannels",
         COALESCE(f.issue_tags, '{}') AS "issueTags",
         s.summary_version AS "summaryVersion",
         s.sentences AS "summarySentences"
       FROM precedents p
       LEFT JOIN precedent_fact_tags f ON f.precedent_id = p.id
       LEFT JOIN precedent_summaries s
         ON s.precedent_id = p.id
        AND s.source_hash = p.source_hash
       WHERE p.searchable = true
         AND p.case_name ILIKE '%통신매체이용음란%'
         AND p.verified_at IS NOT NULL
         AND p.link_checked_at >= now() - interval '24 hours'
         AND p.link_status BETWEEN 200 AND 399
         AND p.embedding IS NOT NULL
       ORDER BY p.embedding <=> $1::vector, p.decision_date DESC, p.id
       LIMIT 20`,
      [toVectorLiteral(queryVector)],
    ),
  ]);

  if (searchResult.rows.length === 0) {
    return searchWithoutEmbeddings({
      pool,
      normalized,
      queryFacts,
      fallbackCode: "NO_EMBEDDED_CANDIDATES",
    });
  }

  return {
    query: normalized.text,
    queryFacts: publicFacts(queryFacts),
    availableCount: Number(countResult.rows[0].count),
    comparedCount: searchResult.rows.length,
    scoring: {
      status: "hybrid_embeddings",
      semanticWeight: 0.45,
      factTagWeight: 0.45,
      issueTagWeight: 0.1,
      minimumScore: MINIMUM_RETRIEVAL_SCORE,
    },
    results: rankHybridCandidates(queryFacts, searchResult.rows, normalized.limit),
  };
}
