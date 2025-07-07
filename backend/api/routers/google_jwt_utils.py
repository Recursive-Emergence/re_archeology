import requests
from jose import jwt
from jose.exceptions import JWTError
import logging

GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"

logger = logging.getLogger(__name__)

_jwks_cache = None

def get_google_public_keys():
    global _jwks_cache
    if _jwks_cache is not None:
        return _jwks_cache
    resp = requests.get(GOOGLE_JWKS_URL)
    resp.raise_for_status()
    jwks = resp.json()
    _jwks_cache = jwks
    return jwks

def decode_google_jwt(token, audience):
    jwks = get_google_public_keys()
    try:
        payload = jwt.decode(
            token,
            jwks,
            algorithms=["RS256"],
            audience=audience,
            options={"verify_aud": True, "verify_exp": True}
        )
        return payload
    except JWTError as e:
        logger.warning(f"Google JWT decode failed: {e}")
        raise
