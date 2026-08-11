CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE data_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL UNIQUE,
  name text NOT NULL,
  base_url text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES data_sources(id),
  query text NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  fetched_count integer NOT NULL DEFAULT 0,
  changed_count integer NOT NULL DEFAULT 0,
  error_code text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE source_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES data_sources(id),
  sync_run_id uuid NOT NULL REFERENCES sync_runs(id),
  external_id text NOT NULL,
  raw_hash char(64) NOT NULL,
  raw_payload jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, external_id, raw_hash)
);

CREATE TABLE precedents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_record_id text NOT NULL,
  court text NOT NULL,
  case_number text NOT NULL,
  case_name text NOT NULL,
  decision_date date NOT NULL,
  official_url text NOT NULL,
  source_text text NOT NULL,
  source_hash char(64) NOT NULL,
  collected_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  link_checked_at timestamptz,
  link_status integer,
  searchable boolean NOT NULL DEFAULT false,
  embedding vector(1536),
  UNIQUE (provider, provider_record_id),
  UNIQUE (court, case_number, decision_date),
  CHECK (searchable = false OR verified_at IS NOT NULL),
  CHECK (searchable = false OR link_status BETWEEN 200 AND 399)
);

CREATE TABLE precedent_sources (
  precedent_id uuid NOT NULL REFERENCES precedents(id) ON DELETE CASCADE,
  source_document_id uuid NOT NULL REFERENCES source_documents(id),
  official_url text NOT NULL,
  is_primary boolean NOT NULL DEFAULT true,
  verified_at timestamptz,
  PRIMARY KEY (precedent_id, source_document_id)
);

CREATE TABLE precedent_paragraphs (
  precedent_id uuid NOT NULL REFERENCES precedents(id) ON DELETE CASCADE,
  paragraph_id text NOT NULL,
  ordinal integer NOT NULL,
  body text NOT NULL,
  PRIMARY KEY (precedent_id, paragraph_id),
  UNIQUE (precedent_id, ordinal)
);

CREATE TABLE source_rights (
  provider text PRIMARY KEY,
  storage_allowed boolean NOT NULL,
  indexing_allowed boolean NOT NULL,
  summary_allowed boolean NOT NULL,
  display_allowed boolean NOT NULL,
  redistribution_allowed boolean NOT NULL,
  terms_version text NOT NULL,
  evidence_document_id text NOT NULL,
  reviewed_at timestamptz NOT NULL
);

INSERT INTO data_sources (provider, name, base_url)
VALUES ('law_open_data', '국가법령정보센터 공동활용 Open API', 'https://www.law.go.kr/DRF')
ON CONFLICT (provider) DO NOTHING;
