// The offence this service is built around. Kept here so the collector, the
// analysis and the tests all name the same article.
export const COMMUNICATION_OBSCENITY_ARTICLE = {
  lawId: "011187",
  articleNo: "13",
};

const UPSERT_SQL = `INSERT INTO statutes
  (law_id, article_no, law_name, article_title, body, enforced_on, official_url, fetched_at)
 VALUES ($1, $2, $3, $4, $5, $6, $7, now())
 ON CONFLICT (law_id, article_no) DO UPDATE SET
   law_name = EXCLUDED.law_name,
   article_title = EXCLUDED.article_title,
   body = EXCLUDED.body,
   enforced_on = EXCLUDED.enforced_on,
   official_url = EXCLUDED.official_url,
   fetched_at = now()`;

export async function syncStatuteArticle({ pool, api, lawId, articleNo }) {
  const { article } = await api.fetchStatuteArticle({ lawId, articleNo });
  await pool.query(UPSERT_SQL, [
    article.lawId,
    article.articleNo,
    article.lawName,
    article.articleTitle,
    article.body,
    article.enforcedOn,
    article.officialUrl,
  ]);
  return article;
}

export async function readStatuteArticle({ pool, lawId, articleNo }) {
  const result = await pool.query(
    `SELECT law_id AS "lawId", article_no AS "articleNo", law_name AS "lawName",
            article_title AS "articleTitle", body,
            to_char(enforced_on, 'YYYY-MM-DD') AS "enforcedOn",
            official_url AS "officialUrl"
     FROM statutes WHERE law_id = $1 AND article_no = $2`,
    [String(lawId), String(articleNo)],
  );
  return result.rows[0] || null;
}
