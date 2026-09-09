-- Lets the web-case refresh write down what it spent.
--
-- The refresh has been costing money invisibly. It runs behind a response that
-- has already gone out, at most once a day per query key, and it makes two
-- model calls — one of them with the web_search tool, which is billed per call
-- on top of the tokens. None of it reached api_usage, because the callback that
-- would have reported it was never wired up.
--
-- Kept as its own purpose rather than folded into case_analysis because the two
-- are charged to different things: an analysis belongs to one reader, and a
-- batch is shared by everyone whose situation reduces to the same tags. Reading
-- them as one number would say a search costs more than it does.
--
-- Nothing about this row identifies a reader or a query. Same as 010: a model
-- name and some integers.
ALTER TABLE api_usage DROP CONSTRAINT IF EXISTS api_usage_purpose_check;

ALTER TABLE api_usage ADD CONSTRAINT api_usage_purpose_check
  CHECK (purpose IN (
    'search_embedding', 'case_analysis', 'summary', 'backfill_embedding', 'web_batch', 'other'
  ));
