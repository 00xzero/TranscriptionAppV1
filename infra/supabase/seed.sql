-- ============================================================================
-- Seed Data for Local Development
-- ============================================================================
--
-- NOTE: This seed file requires a test user to exist in auth.users.
-- When running Supabase locally, create a test user first via:
--   1. Supabase Dashboard > Authentication > Users > Add User
--   2. Or via the Auth API
--
-- Then replace the placeholder UUID below with the actual user ID.
-- ============================================================================

-- Placeholder for test user ID (replace after creating user in local Supabase)
-- To find your test user ID: SELECT id FROM auth.users LIMIT 1;

DO $$
DECLARE
    test_user_id UUID;
    transcript_1_id UUID := '11111111-1111-1111-1111-111111111111';
    transcript_2_id UUID := '22222222-2222-2222-2222-222222222222';
    speaker_1_id UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    speaker_2_id UUID := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    segment_1_id UUID := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    segment_2_id UUID := 'dddddddd-dddd-dddd-dddd-dddddddddddd';
BEGIN
    -- Get the first user from auth.users (assumes test user exists)
    SELECT id INTO test_user_id FROM auth.users LIMIT 1;

    IF test_user_id IS NULL THEN
        RAISE NOTICE 'No test user found. Please create a user first.';
        RETURN;
    END IF;

    RAISE NOTICE 'Seeding data for user: %', test_user_id;

    -- ========================================================================
    -- Transcript 1: Completed transcription
    -- ========================================================================
    INSERT INTO transcripts (id, user_id, title, status, duration_seconds, source_object_key)
    VALUES (
        transcript_1_id,
        test_user_id,
        'Sample Interview',
        'completed',
        120,
        test_user_id || '/' || transcript_1_id || '/interview.mp3'
    ) ON CONFLICT (id) DO NOTHING;

    -- Speakers for Transcript 1
    INSERT INTO speakers (id, transcript_id, label, color) VALUES
        (speaker_1_id, transcript_1_id, 'Interviewer', '#3B82F6'),
        (speaker_2_id, transcript_1_id, 'Guest', '#10B981')
    ON CONFLICT (id) DO NOTHING;

    -- Segments for Transcript 1
    INSERT INTO segments (id, transcript_id, speaker_id, start_ms, end_ms, text) VALUES
        (segment_1_id, transcript_1_id, speaker_1_id, 0, 5000, 'Welcome to the show. Today we have a special guest.'),
        (segment_2_id, transcript_1_id, speaker_2_id, 5500, 10000, 'Thank you for having me. It is great to be here.')
    ON CONFLICT (id) DO NOTHING;

    -- Watchlist for Transcript 1
    INSERT INTO watchlist (transcript_id, term, canonical) VALUES
        (transcript_1_id, 'AI', 'Artificial Intelligence'),
        (transcript_1_id, 'ML', 'Machine Learning')
    ON CONFLICT DO NOTHING;

    -- ========================================================================
    -- Transcript 2: Pending upload
    -- ========================================================================
    INSERT INTO transcripts (id, user_id, title, status)
    VALUES (
        transcript_2_id,
        test_user_id,
        'Meeting Recording',
        'created'
    ) ON CONFLICT (id) DO NOTHING;

    RAISE NOTICE 'Seed data created successfully!';
END $$;
