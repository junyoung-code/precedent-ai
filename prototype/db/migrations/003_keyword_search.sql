ALTER TABLE precedents
ADD COLUMN IF NOT EXISTS search_vector tsvector GENERATED ALWAYS AS (
  to_tsvector(
    'simple',
    coalesce(court, '') || ' ' ||
    coalesce(case_number, '') || ' ' ||
    coalesce(case_name, '') || ' ' ||
    coalesce(source_text, '')
  )
) STORED;

CREATE INDEX IF NOT EXISTS precedents_search_vector_idx
ON precedents USING gin (search_vector);
