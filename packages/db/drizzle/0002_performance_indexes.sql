-- Performance indexes: selective, high-ROI only
-- These cover the hottest read paths with minimal write overhead

-- Trigram extension for ILIKE search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1. Party name search (used on every list page, invoice search correlated subquery)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_parties_name_trgm
ON parties USING gin (name gin_trgm_ops);

-- 2. Invoice number search (used on invoice list search)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_number_trgm
ON invoices USING gin (invoice_number gin_trgm_ops);

-- 3. Unpaid invoices partial index (used on every payment recording flow)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_unpaid
ON invoices (business_id, party_id, invoice_date)
WHERE status NOT IN ('paid', 'cancelled', 'draft')
  AND document_type = 'invoice';

-- 4. Case-insensitive name lookups for import dedup (LOWER() expression index)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_parties_name_lower
ON parties (business_id, LOWER(name));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_items_name_lower
ON items (business_id, LOWER(name));
