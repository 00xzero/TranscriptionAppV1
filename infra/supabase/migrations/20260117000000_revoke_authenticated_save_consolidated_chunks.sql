-- Revoke authenticated execute access on save_consolidated_chunks
REVOKE EXECUTE ON FUNCTION save_consolidated_chunks(UUID, JSONB) FROM authenticated;
