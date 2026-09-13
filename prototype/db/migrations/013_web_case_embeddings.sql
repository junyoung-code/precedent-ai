-- A vector per community post, so a reader can be matched to the one that
-- actually resembles their situation.
--
-- Until now the panel picked from a batch shared by everyone whose case reduced
-- to the same two tags, and narrowed it on those same two. Measured over the
-- gallery posts, the rule extractor fills 3.2 of its 8 fields — the rules were
-- written for a description somebody wrote answering intake questions, and a
-- gallery does not write that way. So the tags cannot carry the matching, and
-- this is the same answer the precedent side already uses.
--
-- Keyed by address rather than kept in web_case_cache.cases, for two reasons: a
-- 1536-float array per post would make that row hundreds of kilobytes, and a
-- vector stored beside the batch would be thrown away and paid for again every
-- time the batch refreshed. A post is embedded once, ever.
--
-- Nothing a user wrote is here, same as 011. The key is the address of a page
-- somebody else published, and the value is a vector of the neutral summary
-- this service wrote about it.
CREATE TABLE IF NOT EXISTS web_case_embeddings (
  url text PRIMARY KEY,
  embedding vector(1536) NOT NULL,
  model text NOT NULL,
  -- Of the built input, not the post. A summary that did not change is not
  -- embedded again.
  input_hash char(64) NOT NULL,
  embedded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS web_case_embeddings_cosine_idx
  ON web_case_embeddings USING hnsw (embedding vector_cosine_ops);
