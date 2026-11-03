-- Add source_subtype to track Revscale lead_finder vs email_campaign
-- and Apollo enrichment sub-types
ALTER TABLE leads ADD COLUMN IF NOT EXISTS source_subtype text;

-- Index for filtering by source + subtype on the dashboard
CREATE INDEX IF NOT EXISTS leads_source_subtype_idx ON leads (source, source_subtype);
