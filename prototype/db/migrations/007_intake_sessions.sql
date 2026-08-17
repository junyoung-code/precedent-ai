CREATE TABLE IF NOT EXISTS intake_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role text NOT NULL CHECK (role IN ('victim', 'reported')),
  redacted_text text NOT NULL,
  facts jsonb NOT NULL,
  questions jsonb NOT NULL,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at = created_at + interval '1 hour')
);

CREATE INDEX IF NOT EXISTS intake_sessions_expires_at_idx ON intake_sessions (expires_at);
