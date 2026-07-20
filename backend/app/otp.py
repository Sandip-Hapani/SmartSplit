"""One-time-code issuing and checking."""

import secrets
from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy.orm import Session

from . import models
from .auth import hash_password, verify_password
from .mailer import OTP_TTL_MINUTES

CODE_LENGTH = 6
MAX_ATTEMPTS = 5
RESEND_COOLDOWN_SECONDS = 45


def generate_code() -> str:
    return "".join(secrets.choice("0123456789") for _ in range(CODE_LENGTH))


def issue(db: Session, email: str, purpose: str) -> str:
    """Invalidate any outstanding codes and create a fresh one."""
    now = datetime.utcnow()

    recent = (
        db.query(models.EmailOTP)
        .filter(models.EmailOTP.email == email, models.EmailOTP.purpose == purpose)
        .order_by(models.EmailOTP.created_at.desc())
        .first()
    )
    if recent and recent.consumed_at is None:
        age = (now - recent.created_at).total_seconds()
        if age < RESEND_COOLDOWN_SECONDS:
            raise HTTPException(
                429,
                f"A code was just sent. Try again in {int(RESEND_COOLDOWN_SECONDS - age)}s.",
            )

    # only one live code per email+purpose
    (
        db.query(models.EmailOTP)
        .filter(
            models.EmailOTP.email == email,
            models.EmailOTP.purpose == purpose,
            models.EmailOTP.consumed_at.is_(None),
        )
        .update({"consumed_at": now}, synchronize_session=False)
    )

    code = generate_code()
    db.add(
        models.EmailOTP(
            email=email,
            code_hash=hash_password(code),
            purpose=purpose,
            expires_at=now + timedelta(minutes=OTP_TTL_MINUTES),
        )
    )
    db.commit()
    return code


def consume(db: Session, email: str, code: str, purpose: str) -> None:
    """Validate a code and burn it. Raises HTTPException when it isn't usable."""
    now = datetime.utcnow()
    otp = (
        db.query(models.EmailOTP)
        .filter(
            models.EmailOTP.email == email,
            models.EmailOTP.purpose == purpose,
            models.EmailOTP.consumed_at.is_(None),
        )
        .order_by(models.EmailOTP.created_at.desc())
        .first()
    )
    if otp is None:
        raise HTTPException(400, "No active code for this email. Request a new one.")
    if otp.expires_at < now:
        otp.consumed_at = now
        db.commit()
        raise HTTPException(400, "That code has expired. Request a new one.")
    if otp.attempts >= MAX_ATTEMPTS:
        otp.consumed_at = now
        db.commit()
        raise HTTPException(429, "Too many incorrect attempts. Request a new code.")

    if not verify_password(code.strip(), otp.code_hash):
        otp.attempts += 1
        db.commit()
        left = MAX_ATTEMPTS - otp.attempts
        raise HTTPException(400, f"Incorrect code. {left} attempt{'s' if left != 1 else ''} left.")

    otp.consumed_at = now
    db.commit()
