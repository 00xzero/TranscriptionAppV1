-- Migration: Create RPC function for atomic chunk saving
-- This function atomically deletes existing chunks and inserts new ones
-- within a single transaction to prevent partial state on failures.

CREATE OR REPLACE FUNCTION save_consolidated_chunks(
    p_project_id UUID,
    p_chunks JSONB
)
RETURNS TABLE(chunk_count INT, chunk_word_count INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_chunk JSONB;
    v_chunk_id UUID;
    v_word_id UUID;
    v_order_idx INT;
    v_chunk_count INT := 0;
    v_chunk_word_count INT := 0;
BEGIN
    -- Delete existing chunks for this project (cascade deletes chunk_words)
    DELETE FROM chunks WHERE project_id = p_project_id;
    
    -- Insert new chunks and their word mappings
    FOR v_chunk IN SELECT * FROM jsonb_array_elements(p_chunks)
    LOOP
        -- Insert chunk
        INSERT INTO chunks (
            project_id,
            speaker_id,
            start_ms,
            end_ms,
            text,
            source_segment_ids,
            is_edited,
            is_filler,
            algo_version
        ) VALUES (
            p_project_id,
            (v_chunk->>'speakerId')::UUID,
            (v_chunk->>'startMs')::INT,
            (v_chunk->>'endMs')::INT,
            v_chunk->>'text',
            ARRAY(SELECT jsonb_array_elements_text(v_chunk->'sourceSegmentIds'))::UUID[],
            FALSE,
            (v_chunk->>'isFiller')::BOOLEAN,
            v_chunk->>'algoVersion'
        )
        RETURNING id INTO v_chunk_id;
        
        v_chunk_count := v_chunk_count + 1;
        
        -- Insert chunk_words for this chunk
        v_order_idx := 0;
        FOR v_word_id IN SELECT (jsonb_array_elements_text(v_chunk->'wordIds'))::UUID
        LOOP
            INSERT INTO chunk_words (chunk_id, word_id, order_index)
            VALUES (v_chunk_id, v_word_id, v_order_idx);
            
            v_order_idx := v_order_idx + 1;
            v_chunk_word_count := v_chunk_word_count + 1;
        END LOOP;
    END LOOP;
    
    RETURN QUERY SELECT v_chunk_count, v_chunk_word_count;
END;
$$;

-- Grant execute permission to service_role only
GRANT EXECUTE ON FUNCTION save_consolidated_chunks(UUID, JSONB) TO service_role;

COMMENT ON FUNCTION save_consolidated_chunks IS 
'Atomically saves consolidated chunks and their word mappings for a project. 
Deletes existing chunks first, then inserts all new chunks and chunk_words 
within a single transaction to ensure data integrity.';
