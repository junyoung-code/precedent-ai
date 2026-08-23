-- Posts found on the web for one generalized query.
--
-- The query is built from fact tags before it ever leaves the server, so a row
-- is shared by everyone whose situation reduces to the same tags — which is why
-- it can be cached at all. Nothing a user wrote is stored here: the key is one
-- of a couple of dozen generated strings, and the value is links to pages other
-- people already published.
CREATE TABLE IF NOT EXISTS web_case_cache (
  query_key text PRIMARY KEY,
  cases jsonb NOT NULL,
  model text NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
