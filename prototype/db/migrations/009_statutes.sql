-- The statute article a case is judged under, quoted from the official text.
-- Nothing here is generated and nothing here describes a user's case.
CREATE TABLE IF NOT EXISTS statutes (
  law_id text NOT NULL,
  article_no text NOT NULL,
  law_name text NOT NULL,
  article_title text NOT NULL,
  body text NOT NULL CHECK (length(btrim(body)) > 0),
  enforced_on date NOT NULL,
  official_url text NOT NULL CHECK (official_url LIKE 'https://www.law.go.kr/%'),
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (law_id, article_no)
);
