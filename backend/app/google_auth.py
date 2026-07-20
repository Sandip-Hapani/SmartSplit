"""Verification of Google Identity Services ID tokens.

The browser runs the Google sign-in flow and hands us a signed ID token
(a JWT). We check the signature against Google's public keys and confirm the
token was minted for *this* app before trusting anything inside it.
"""

import logging
import os

from fastapi import HTTPException
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token

log = logging.getLogger("smartsplit.google")

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "").strip()

_request = google_requests.Request()


def is_configured() -> bool:
    return bool(GOOGLE_CLIENT_ID)


def verify(credential: str) -> dict:
    """Validate the ID token and return the useful claims.

    Raises HTTPException on anything suspicious — a token signed by someone
    else, issued for a different client, or missing a verified email.
    """
    if not is_configured():
        raise HTTPException(503, "Google sign-in is not configured on this server.")

    try:
        claims = google_id_token.verify_oauth2_token(
            credential, _request, GOOGLE_CLIENT_ID, clock_skew_in_seconds=10
        )
    except ValueError as exc:
        log.warning("Rejected Google credential: %s", exc)
        raise HTTPException(401, "Google sign-in failed: the token could not be verified.")

    # verify_oauth2_token already checks signature, aud, and exp.
    if claims.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
        raise HTTPException(401, "Google sign-in failed: unexpected token issuer.")

    email = (claims.get("email") or "").lower()
    if not email:
        raise HTTPException(400, "That Google account has no email address attached.")
    if not claims.get("email_verified"):
        # Guards against someone claiming an address they don't control and
        # thereby taking over an existing SmartSplit account.
        raise HTTPException(403, "This Google account's email address is not verified.")

    return {
        "sub": claims["sub"],
        "email": email,
        "name": claims.get("name") or email.split("@")[0],
        "picture": claims.get("picture"),
    }
