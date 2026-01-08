import pytest

from app.schemas import (
    MAX_KEY_TERM_LENGTH,
    MAX_KEY_TERMS,
    _parse_and_validate_key_terms,
)


def test_parse_and_validate_key_terms_dedupe_and_trim():
    terms = [" PAS-X ", "pas-x", "Move-X", "", "  "]
    assert _parse_and_validate_key_terms(terms, allow_empty=False) == ["PAS-X", "Move-X"]


def test_parse_and_validate_key_terms_allow_empty_false():
    assert _parse_and_validate_key_terms(None, allow_empty=False) is None
    assert _parse_and_validate_key_terms([], allow_empty=False) is None
    assert _parse_and_validate_key_terms(["", "  "], allow_empty=False) is None


def test_parse_and_validate_key_terms_allow_empty_true():
    assert _parse_and_validate_key_terms(None, allow_empty=True) == []
    assert _parse_and_validate_key_terms([], allow_empty=True) == []
    assert _parse_and_validate_key_terms(["", "  "], allow_empty=True) == []


def test_parse_and_validate_key_terms_limits():
    too_many = [f"term_{i}" for i in range(MAX_KEY_TERMS + 1)]
    with pytest.raises(ValueError, match="Too many key terms"):
        _parse_and_validate_key_terms(too_many, allow_empty=False)

    long_term = "a" * (MAX_KEY_TERM_LENGTH + 1)
    with pytest.raises(ValueError, match="Key term too long"):
        _parse_and_validate_key_terms([long_term], allow_empty=False)
