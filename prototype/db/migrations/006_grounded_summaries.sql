CREATE TABLE IF NOT EXISTS precedent_summaries (
  precedent_id uuid PRIMARY KEY REFERENCES precedents(id) ON DELETE CASCADE,
  source_hash char(64) NOT NULL,
  summary_version text NOT NULL,
  model text NOT NULL,
  sentences jsonb NOT NULL CHECK (jsonb_typeof(sentences) = 'array'),
  generated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS precedent_summaries_version_idx
ON precedent_summaries (summary_version, model, generated_at DESC);
