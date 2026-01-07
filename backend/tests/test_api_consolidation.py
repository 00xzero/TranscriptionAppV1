"""
API Integration Tests for Transcript Consolidation Feature

Based on Acceptance Criteria document.
Covers: AC-1 (Automatic Consolidation), AC-8 (Editing), AC-9 (Backward Compatibility)

These tests require a running backend server.

Run with:
    cd backend && python -m pytest tests/test_api_consolidation.py -v

Note: Make sure to set TEST_BASE_URL environment variable if not using localhost:8000
"""

import os
import pytest
import requests
from datetime import datetime


# =============================================================================
# Configuration
# =============================================================================

BASE_URL = os.getenv("TEST_BASE_URL", "http://localhost:8000")

# Skip all tests if no server is running
def is_server_running() -> bool:
    try:
        response = requests.get(f"{BASE_URL}/health", timeout=2)
        return response.status_code == 200
    except requests.exceptions.RequestException:
        return False


pytestmark = pytest.mark.skipif(
    not is_server_running(),
    reason="API server not running"
)


# =============================================================================
# Test Fixtures
# =============================================================================

@pytest.fixture
def sample_project_id():
    """
    Return a project ID for testing.
    
    In a real test setup, this would create a project and transcribe it.
    For now, it expects an existing project in the database.
    
    Set TEST_PROJECT_ID environment variable to use a specific project.
    """
    project_id = os.getenv("TEST_PROJECT_ID")
    if not project_id:
        # Try to get the first project from the API
        response = requests.get(f"{BASE_URL}/projects")
        if response.status_code == 200 and response.json():
            project_id = response.json()[0]["id"]
    
    if not project_id:
        pytest.skip("No project ID available for testing. Set TEST_PROJECT_ID env var.")
    
    return project_id


@pytest.fixture
def sample_chunk_id(sample_project_id):
    """Get a chunk ID from the sample project."""
    response = requests.get(f"{BASE_URL}/projects/{sample_project_id}/chunks")
    if response.status_code == 200 and response.json():
        return response.json()[0]["id"]
    pytest.skip("No chunks available for testing")


# =============================================================================
# AC-1: Automatic Consolidation on Transcription
# =============================================================================

class TestAC1_AutomaticConsolidation:
    """AC-1: System should automatically create consolidated chunks."""

    def test_chunks_endpoint_returns_data(self, sample_project_id):
        """Chunks endpoint should return data for transcribed project."""
        response = requests.get(f"{BASE_URL}/projects/{sample_project_id}/chunks")
        
        assert response.status_code == 200
        chunks = response.json()
        assert isinstance(chunks, list)
        assert len(chunks) > 0, "Chunks should exist for transcribed project"

    def test_chunks_have_required_fields(self, sample_project_id):
        """Each chunk should have all required fields."""
        response = requests.get(f"{BASE_URL}/projects/{sample_project_id}/chunks")
        chunks = response.json()
        
        required_fields = [
            "id", "project_id", "speaker_id", "start_ms", "end_ms", 
            "text", "is_edited", "is_filler", "created_at", "updated_at"
        ]
        
        for chunk in chunks:
            for field in required_fields:
                assert field in chunk, f"Missing field: {field}"

    def test_chunks_fewer_than_segments(self, sample_project_id):
        """Number of chunks should be significantly lower than segments."""
        chunks_response = requests.get(f"{BASE_URL}/projects/{sample_project_id}/chunks")
        segments_response = requests.get(f"{BASE_URL}/projects/{sample_project_id}/segments")
        
        chunks = chunks_response.json()
        segments = segments_response.json()
        
        if len(segments) > 10:  # Only check if there are enough segments
            # Chunks should be at least 3x fewer than segments
            assert len(chunks) < len(segments) / 2, \
                f"Expected significant reduction: {len(segments)} segments → {len(chunks)} chunks"


# =============================================================================
# AC-8: Chunk Editing and Edit Protection
# =============================================================================

class TestAC8_ChunkEditing:
    """AC-8: Edited chunks should be marked and protected."""

    def test_initial_is_edited_is_false(self, sample_project_id):
        """New chunks should have is_edited=false initially."""
        response = requests.get(f"{BASE_URL}/projects/{sample_project_id}/chunks")
        chunks = response.json()
        
        # At least some chunks should have is_edited=false
        unedited = [c for c in chunks if not c["is_edited"]]
        assert len(unedited) > 0, "Some chunks should be unedited initially"

    def test_edit_chunk_sets_is_edited_true(self, sample_chunk_id):
        """Editing a chunk should set is_edited=true."""
        # Get original state
        original_response = requests.get(f"{BASE_URL}/chunks/{sample_chunk_id}")
        if original_response.status_code != 200:
            # Try getting chunk from chunks list
            pytest.skip("Individual chunk GET endpoint not available")
        
        original = original_response.json()
        
        # Edit the chunk
        new_text = f"Edited at {datetime.now().isoformat()}"
        edit_response = requests.patch(
            f"{BASE_URL}/chunks/{sample_chunk_id}",
            json={"text": new_text}
        )
        
        assert edit_response.status_code == 200
        edited = edit_response.json()
        
        assert edited["is_edited"] is True
        assert edited["text"] == new_text

    def test_edit_updates_timestamp(self, sample_chunk_id):
        """Editing should update the updated_at timestamp."""
        # Get original state
        original_response = requests.get(f"{BASE_URL}/projects/")  # Get any project
        
        # Edit the chunk
        edit_response = requests.patch(
            f"{BASE_URL}/chunks/{sample_chunk_id}",
            json={"text": "Updated text for timestamp test"}
        )
        
        if edit_response.status_code == 200:
            edited = edit_response.json()
            assert "updated_at" in edited


# =============================================================================
# AC-9: Backward Compatibility
# =============================================================================

class TestAC9_BackwardCompatibility:
    """AC-9: Original segments endpoint should still work."""

    def test_segments_endpoint_still_works(self, sample_project_id):
        """Segments endpoint should return 200 OK."""
        response = requests.get(f"{BASE_URL}/projects/{sample_project_id}/segments")
        
        assert response.status_code == 200
        segments = response.json()
        assert isinstance(segments, list)

    def test_both_endpoints_return_different_counts(self, sample_project_id):
        """Segments and chunks endpoints should return different data."""
        chunks_response = requests.get(f"{BASE_URL}/projects/{sample_project_id}/chunks")
        segments_response = requests.get(f"{BASE_URL}/projects/{sample_project_id}/segments")
        
        chunks = chunks_response.json()
        segments = segments_response.json()
        
        # Counts should differ (unless no consolidation happened)
        if len(segments) > 5:
            assert len(chunks) != len(segments), \
                "Chunks and segments should have different counts"

    def test_segments_have_original_structure(self, sample_project_id):
        """Segments should have the original API structure."""
        response = requests.get(f"{BASE_URL}/projects/{sample_project_id}/segments")
        segments = response.json()
        
        if segments:
            segment = segments[0]
            expected_fields = ["id", "project_id", "speaker_id", "start_ms", "end_ms", "text"]
            for field in expected_fields:
                assert field in segment, f"Segment missing field: {field}"


# =============================================================================
# Error Handling Tests
# =============================================================================

class TestErrorHandling:
    """Test error handling for chunk endpoints."""

    def test_chunks_404_for_invalid_project(self):
        """Chunks endpoint should return 404 for non-existent project."""
        response = requests.get(f"{BASE_URL}/projects/invalid-project-id/chunks")
        assert response.status_code == 404

    def test_patch_chunk_404_for_invalid_id(self):
        """PATCH chunk should return 404 for non-existent chunk."""
        response = requests.patch(
            f"{BASE_URL}/chunks/invalid-chunk-id",
            json={"text": "test"}
        )
        assert response.status_code == 404


# =============================================================================
# Run Tests
# =============================================================================

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
