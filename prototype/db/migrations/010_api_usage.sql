-- What each external model call cost, and nothing about what it was for.
--
-- The service deletes a user's description as the search settles, so this table
-- must not become the place it survives. It records the shape of a call —
-- model, tokens, how long — and never the text, the query, or who sent it.
CREATE TABLE IF NOT EXISTS api_usage (
  id bigserial PRIMARY KEY,
  purpose text NOT NULL CHECK (purpose IN ('search_embedding', 'case_analysis', 'summary', 'backfill_embedding', 'other')),
  model text NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  cached_input_tokens integer NOT NULL DEFAULT 0 CHECK (cached_input_tokens >= 0),
  output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  web_searches integer NOT NULL DEFAULT 0 CHECK (web_searches >= 0),
  latency_ms integer NOT NULL DEFAULT 0 CHECK (latency_ms >= 0),
  ok boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS api_usage_created_at_idx ON api_usage (created_at DESC);
