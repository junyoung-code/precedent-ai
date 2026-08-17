import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  const result = await pool.query(
    `SELECT
       (SELECT count(*) FROM precedent_fact_tags
        WHERE extraction_version = 'rule-v2') AS "factTagsV2",
       (SELECT count(*) FROM precedent_summaries
        WHERE summary_version = 'grounded-v2') AS "summariesV2",
       (SELECT count(*) FROM precedent_summaries s
        JOIN precedents p ON p.id = s.precedent_id
        WHERE s.source_hash <> p.source_hash) AS "staleHashes",
       (SELECT count(*)
        FROM precedent_summaries s
        CROSS JOIN LATERAL jsonb_array_elements(s.sentences) sentence
        CROSS JOIN LATERAL jsonb_array_elements_text(sentence->'paragraphIds') paragraph_id
        WHERE NOT EXISTS (
          SELECT 1 FROM precedent_paragraphs pp
          WHERE pp.precedent_id = s.precedent_id
            AND pp.paragraph_id = paragraph_id
        )) AS "invalidAnchors"`,
  );
  console.log(JSON.stringify(result.rows[0], null, 2));
} finally {
  await pool.end();
}
