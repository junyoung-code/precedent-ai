CREATE TABLE IF NOT EXISTS precedent_fact_tags (
  precedent_id uuid PRIMARY KEY REFERENCES precedents(id) ON DELETE CASCADE,
  extraction_version text NOT NULL,
  medium text NOT NULL CHECK (medium IN (
    'unknown', 'bank_transfer', 'kakao', 'game_chat', 'sns_mention', 'direct_delivery', 'digital_message'
  )),
  message_form text NOT NULL CHECK (message_form IN ('text', 'image')),
  recipient_identification text NOT NULL CHECK (recipient_identification IN (
    'unknown', 'mention', 'bank_account', 'public_post', 'direct_account'
  )),
  reached_recipient text NOT NULL CHECK (reached_recipient IN ('unknown', 'yes', 'no')),
  relationship text NOT NULL CHECK (relationship IN (
    'unknown', 'partner_or_ex', 'game_user', 'neighbor', 'acquaintance', 'online_user', 'stranger'
  )),
  context text NOT NULL CHECK (context IN ('unknown', 'conflict', 'sexual_conversation', 'one_sided')),
  expression_type text NOT NULL CHECK (expression_type IN (
    'other', 'sexual_image', 'insult_with_sexual_terms', 'sexual_text'
  )),
  repetition text NOT NULL CHECK (repetition IN ('unknown', 'once', 'repeated')),
  additional_channels text[] NOT NULL DEFAULT '{}',
  issue_tags text[] NOT NULL DEFAULT '{}',
  evidence jsonb NOT NULL DEFAULT '{}',
  extracted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS precedent_fact_tags_issue_tags_idx
ON precedent_fact_tags USING gin (issue_tags);

CREATE INDEX IF NOT EXISTS precedent_fact_tags_additional_channels_idx
ON precedent_fact_tags USING gin (additional_channels);

CREATE INDEX IF NOT EXISTS precedent_fact_tags_version_idx
ON precedent_fact_tags (extraction_version, extracted_at DESC);
