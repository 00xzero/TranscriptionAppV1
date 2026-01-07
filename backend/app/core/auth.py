"""
Authentication dependency for API routes.

Enforces SINGLE_USER_TOKEN validation via Bearer token or X-API-Key header.
"""
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials, APIKeyHeader
from typing import Optional

from .config import settings

# Support both Bearer token and X-API-Key header
bearer_scheme = HTTPBearer(auto_error=False)
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


def verify_token(
    bearer: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    api_key: Optional[str] = Depends(api_key_header),
) -> str:
    """
    Verify authentication via Bearer token or X-API-Key header.
    
    Returns the validated token string.
    Raises 401 if no valid token is provided.
    """
    token = None
    
    # Check Bearer token first
    if bearer and bearer.credentials:
        token = bearer.credentials
    # Fall back to X-API-Key header
    elif api_key:
        token = api_key
    
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Validate against configured token
    if token != settings.single_user_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    return token


# Dependency alias for cleaner imports
require_auth = verify_token
