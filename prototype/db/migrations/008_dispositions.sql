-- The court's own order (주문), quoted verbatim from the judgment, plus a
-- deterministic label for what kind of order it is. Nothing here is generated
-- text and nothing here describes a user's case.
CREATE TABLE IF NOT EXISTS precedent_dispositions (
  precedent_id uuid PRIMARY KEY REFERENCES precedents(id) ON DELETE CASCADE,
  extraction_version text NOT NULL,
  order_text text NOT NULL CHECK (length(btrim(order_text)) > 0),
  paragraph_ids text[] NOT NULL CHECK (cardinality(paragraph_ids) > 0),
  kind text NOT NULL CHECK (kind IN (
    'remand',
    'final_appeal_dismissed',
    'appeal_dismissed',
    'acquitted',
    'sentenced',
    'reversed_and_sentenced',
    'multiple',
    'civil',
    'other'
  )),
  extracted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS precedent_dispositions_kind_idx
ON precedent_dispositions (kind);
