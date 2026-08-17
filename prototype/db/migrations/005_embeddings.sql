ALTER TABLE precedents
  ADD COLUMN IF NOT EXISTS embedding_model text,
  ADD COLUMN IF NOT EXISTS embedding_input_hash char(64),
  ADD COLUMN IF NOT EXISTS embedding_source_hash char(64),
  ADD COLUMN IF NOT EXISTS embedded_at timestamptz;

CREATE INDEX IF NOT EXISTS precedents_embedding_cosine_idx
  ON precedents USING hnsw (embedding vector_cosine_ops);
