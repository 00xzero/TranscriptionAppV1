"""
API Tests for Key Terms Feature

Tests for POST /projects with key_terms parameter.
Validates parsing, deduplication, storage, and limit enforcement.

Run with:
    cd backend && python -m pytest tests/test_key_terms.py -v
"""

import os
import pytest
import requests


# =============================================================================
# Configuration
# =============================================================================

BASE_URL = os.getenv("TEST_BASE_URL", "http://localhost:8000")
API_TOKEN = os.getenv("TEST_API_TOKEN", "devtoken")


def get_auth_headers():
    """Return authentication headers for API requests."""
    return {"Authorization": f"Bearer {API_TOKEN}"}


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
# Fixtures
# =============================================================================

@pytest.fixture
def cleanup_projects():
    """Track created projects for cleanup after tests."""
    created_ids = []
    yield created_ids
    # Cleanup after test
    for project_id in created_ids:
        try:
            requests.delete(f"{BASE_URL}/projects/{project_id}", headers=get_auth_headers())
        except Exception:
            pass


# =============================================================================
# Test: Key Terms on Project Create
# =============================================================================

class TestKeyTermsCreate:
    """Tests for key_terms parameter in POST /projects."""

    def test_create_project_with_key_terms(self, cleanup_projects):
        """POST /projects with key_terms should store and return them."""
        response = requests.post(
            f"{BASE_URL}/projects",
            headers=get_auth_headers(),
            json={
                "title": "test-key-terms",
                "filename": "test.mp3",
                "content_type": "audio/mpeg",
                "key_terms": ["PAS-X", "Helsingborg", "Move-X"]
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        cleanup_projects.append(data["project"]["id"])
        
        assert "key_terms" in data["project"]
        assert data["project"]["key_terms"] == ["PAS-X", "Helsingborg", "Move-X"]

    def test_create_project_without_key_terms(self, cleanup_projects):
        """POST /projects without key_terms should work normally."""
        response = requests.post(
            f"{BASE_URL}/projects",
            headers=get_auth_headers(),
            json={
                "title": "test-no-key-terms",
                "filename": "test.mp3",
                "content_type": "audio/mpeg"
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        cleanup_projects.append(data["project"]["id"])
        
        # key_terms should be None or absent
        assert data["project"].get("key_terms") is None

    def test_create_project_with_empty_key_terms(self, cleanup_projects):
        """POST /projects with empty key_terms array should be treated as omitted."""
        response = requests.post(
            f"{BASE_URL}/projects",
            headers=get_auth_headers(),
            json={
                "title": "test-empty-key-terms",
                "filename": "test.mp3",
                "content_type": "audio/mpeg",
                "key_terms": []
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        cleanup_projects.append(data["project"]["id"])
        
        assert data["project"].get("key_terms") is None

    def test_key_terms_deduplication(self, cleanup_projects):
        """Duplicate key terms (case-insensitive) should be deduplicated."""
        response = requests.post(
            f"{BASE_URL}/projects",
            headers=get_auth_headers(),
            json={
                "title": "test-dedupe",
                "filename": "test.mp3",
                "content_type": "audio/mpeg",
                "key_terms": ["PAS-X", "pas-x", "PAS-x", "Helsingborg"]
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        cleanup_projects.append(data["project"]["id"])
        
        # Should only have 2 unique terms (first-seen casing preserved)
        assert len(data["project"]["key_terms"]) == 2
        assert "PAS-X" in data["project"]["key_terms"]
        assert "Helsingborg" in data["project"]["key_terms"]


# =============================================================================
# Test: Key Terms Validation
# =============================================================================

class TestKeyTermsValidation:
    """Tests for key_terms validation limits."""

    def test_reject_more_than_100_terms(self):
        """POST /projects with >100 key terms should return 422."""
        terms = [f"term_{i}" for i in range(101)]
        
        response = requests.post(
            f"{BASE_URL}/projects",
            headers=get_auth_headers(),
            json={
                "title": "test-too-many-terms",
                "filename": "test.mp3",
                "content_type": "audio/mpeg",
                "key_terms": terms
            }
        )
        
        assert response.status_code == 422  # Pydantic validation error
        data = response.json()
        assert "detail" in data

    def test_reject_term_longer_than_64_chars(self):
        """POST /projects with term >64 chars should return 422."""
        long_term = "a" * 65
        
        response = requests.post(
            f"{BASE_URL}/projects",
            headers=get_auth_headers(),
            json={
                "title": "test-long-term",
                "filename": "test.mp3",
                "content_type": "audio/mpeg",
                "key_terms": [long_term]
            }
        )
        
        assert response.status_code == 422  # Pydantic validation error
        data = response.json()
        assert "detail" in data

    def test_accept_exactly_100_terms(self, cleanup_projects):
        """POST /projects with exactly 100 terms should succeed."""
        terms = [f"term_{i}" for i in range(100)]
        
        response = requests.post(
            f"{BASE_URL}/projects",
            headers=get_auth_headers(),
            json={
                "title": "test-100-terms",
                "filename": "test.mp3",
                "content_type": "audio/mpeg",
                "key_terms": terms
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        cleanup_projects.append(data["project"]["id"])
        assert len(data["project"]["key_terms"]) == 100

    def test_accept_term_exactly_64_chars(self, cleanup_projects):
        """POST /projects with term exactly 64 chars should succeed."""
        term = "a" * 64
        
        response = requests.post(
            f"{BASE_URL}/projects",
            headers=get_auth_headers(),
            json={
                "title": "test-64-char-term",
                "filename": "test.mp3",
                "content_type": "audio/mpeg",
                "key_terms": [term]
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        cleanup_projects.append(data["project"]["id"])
        assert data["project"]["key_terms"] == [term]


# =============================================================================
# Test: Key Terms Parsing
# =============================================================================

class TestKeyTermsParsing:
    """Tests for key_terms parsing edge cases."""

    def test_whitespace_trimming(self, cleanup_projects):
        """Key terms with surrounding whitespace should be trimmed."""
        response = requests.post(
            f"{BASE_URL}/projects",
            headers=get_auth_headers(),
            json={
                "title": "test-whitespace",
                "filename": "test.mp3",
                "content_type": "audio/mpeg",
                "key_terms": ["  PAS-X  ", "  Helsingborg  "]
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        cleanup_projects.append(data["project"]["id"])
        
        # Terms should be trimmed
        assert data["project"]["key_terms"] == ["PAS-X", "Helsingborg"]

    def test_empty_strings_filtered(self, cleanup_projects):
        """Empty strings in key_terms should be filtered out."""
        response = requests.post(
            f"{BASE_URL}/projects",
            headers=get_auth_headers(),
            json={
                "title": "test-empty-strings",
                "filename": "test.mp3",
                "content_type": "audio/mpeg",
                "key_terms": ["PAS-X", "", "  ", "Helsingborg"]
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        cleanup_projects.append(data["project"]["id"])
        
        # Only non-empty terms should remain
        assert data["project"]["key_terms"] == ["PAS-X", "Helsingborg"]

    def test_special_characters_allowed(self, cleanup_projects):
        """Key terms with special characters should be allowed."""
        response = requests.post(
            f"{BASE_URL}/projects",
            headers=get_auth_headers(),
            json={
                "title": "test-special-chars",
                "filename": "test.mp3",
                "content_type": "audio/mpeg",
                "key_terms": ["PAS-X", "Move™", "Über", "日本語"]
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        cleanup_projects.append(data["project"]["id"])
        
        assert len(data["project"]["key_terms"]) == 4


# =============================================================================
# Run Tests
# =============================================================================

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
