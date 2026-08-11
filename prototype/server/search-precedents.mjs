function searchError(code, message) {
  return Object.assign(new Error(message), { code });
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

export async function searchPrecedents({ pool, query, limit = 5 }) {
  const normalized = normalizeSearchQuery(query, limit);
  const [countResult, searchResult] = await Promise.all([
    pool.query("SELECT count(*) FROM precedents WHERE searchable = true"),
    pool.query(
      `SELECT
         p.id,
         p.court,
         p.case_number AS "caseNumber",
         p.case_name AS "caseName",
         to_char(p.decision_date, 'YYYY-MM-DD') AS "decisionDate",
         p.official_url AS "officialUrl",
         ts_rank_cd(p.search_vector, websearch_to_tsquery('simple', $1)) AS "keywordScore",
         left(regexp_replace(p.source_text, '<[^>]+>', ' ', 'g'), 360) AS snippet
       FROM precedents p
       WHERE p.searchable = true
         AND p.search_vector @@ websearch_to_tsquery('simple', $1)
       ORDER BY "keywordScore" DESC, p.decision_date DESC, p.id
       LIMIT $2`,
      [normalized.expression, normalized.limit],
    ),
  ]);

  return {
    query: normalized.text,
    comparedCount: Number(countResult.rows[0].count),
    results: searchResult.rows.map((row) => ({
      ...row,
      keywordScore: Number(row.keywordScore),
    })),
  };
}
