CREATE TABLE verification_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  precedent_id uuid NOT NULL REFERENCES precedents(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('verified', 'searchable', 'rejected')),
  metadata_match boolean NOT NULL,
  content_match boolean NOT NULL,
  link_status integer,
  error_code text,
  reviewed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX verification_reviews_precedent_reviewed_idx
  ON verification_reviews (precedent_id, reviewed_at DESC);
