-- One row per post, independent of the query that found it.
--
-- Until now a post existed only inside `web_case_cache.cases` — a jsonb array
-- belonging to one generated query key. That made the key a wall. A reader's
-- situation reduces to two tags, the tags build one key, and the panel could
-- only ever choose among that key's batch: a post that matched them closely but
-- had been collected under a different key was unreachable, and 21 of the 28
-- possible keys held nothing at all.
--
-- Promoting the post to its own row is what lets the whole collection be
-- searched by vector for each reader, the way `precedents` already is. The
-- vectors themselves already live this way — `web_case_embeddings` is keyed by
-- url (013) — so this is the missing half of that decision, not a new one.
--
-- `web_case_cache` stays. It remains the record of what one query returned and
-- when, so a refresh can still be rate-limited per key; posts it finds are
-- upserted here as well, and the pool only grows.
--
-- Nothing a user wrote is stored here, same as 011 and 013. The key is the
-- address of a page somebody else published, and the columns describe that page
-- plus the neutral summary this service wrote about it.
CREATE TABLE IF NOT EXISTS web_cases (
  url text PRIMARY KEY,
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  quote text NOT NULL CHECK (length(btrim(quote)) > 0),
  source_type text NOT NULL CHECK (source_type IN ('community', 'qna', 'lawyer_qna', 'blog', 'news')),

  -- The same vocabularies extractFactTags produces, so compareFactTags can
  -- weigh a stored post against a reader's facts with no translation between.
  -- Written out here rather than trusted from the application because this
  -- table is now the durable copy: a typo'd medium used to live for one refresh
  -- and vanish, and would now persist and quietly never match anybody.
  medium text NOT NULL DEFAULT 'unknown' CHECK (medium IN (
    'kakao', 'game_chat', 'sns_mention', 'digital_message',
    'bank_transfer', 'direct_delivery', 'unknown'
  )),
  expression text NOT NULL DEFAULT 'other' CHECK (expression IN (
    'sexual_text', 'insult_with_sexual_terms', 'sexual_image', 'other'
  )),
  writer_role text NOT NULL DEFAULT 'unclear' CHECK (writer_role IN ('victim', 'reported', 'unclear')),

  -- Whether the post says how it turned out. A label on somebody's post, never
  -- added up across posts into a rate: a handful of self-selected accounts is
  -- not evidence about anybody's odds.
  ending boolean NOT NULL DEFAULT false,
  -- Set only for the baiting-for-a-settlement pattern the galleries call a
  -- 통매음 헌터. Used for ordering, never shown or stated.
  situation text CHECK (situation IS NULL OR situation IN ('hunter_pattern')),

  collected_by text NOT NULL CHECK (collected_by IN ('claude', 'openai_web_search', 'dcinside')),
  collected_at timestamptz NOT NULL DEFAULT now(),

  -- Checked on a schedule rather than during a refresh. The old link check ran
  -- every url in a batch through one Promise.all; Lawtalk answered 502 from the
  -- sixth request on, and each 502 was read as "gone" and dropped a live post.
  link_status int,
  link_checked_at timestamptz
);

CREATE INDEX IF NOT EXISTS web_cases_medium_idx ON web_cases (medium);
CREATE INDEX IF NOT EXISTS web_cases_link_status_idx ON web_cases (link_status);
