from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from .. import google_auth, mailer, models, otp, schemas
from ..auth import create_access_token, get_current_user, hash_password, verify_password
from ..database import get_db
from .account_router import generate_username

router = APIRouter(prefix="/api/auth", tags=["auth"])

EMAIL_OFF = ("Email sign-in isn't available on this server because no mail service "
             "is configured. Use Google, or an email and password.")


def _dev_code(sent: bool, code: str) -> str | None:
    """Only ever expose a code when dev codes are explicitly switched on."""
    return None if sent or not mailer.ALLOW_DEV_CODES else code


@router.get("/config", response_model=schemas.AuthConfig,
            summary="Which sign-in methods this server offers")
def auth_config():
    """Lets the frontend show the Google button only when it will actually work,
    without baking the client id into the build."""
    return schemas.AuthConfig(
        google_client_id=google_auth.GOOGLE_CLIENT_ID or None,
        google_enabled=google_auth.is_configured(),
        email_otp_enabled=mailer.email_login_available(),
        email_delivery="smtp" if mailer.is_configured() else "dev",
    )


@router.post("/register", response_model=schemas.Token)
def register(payload: schemas.UserCreate, db: Session = Depends(get_db)):
    email = payload.email.lower()
    if db.query(models.User).filter_by(email=email).first():
        raise HTTPException(400, "Email already registered")
    user = models.User(email=email, name=payload.name,
                       username=generate_username(db, email),
                       hashed_password=hash_password(payload.password))
    db.add(user)
    db.commit()
    db.refresh(user)
    return schemas.Token(access_token=create_access_token(user.id), user=schemas.UserOut.model_validate(user))


@router.post("/login", response_model=schemas.Token)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(models.User).filter_by(email=form.username.lower()).first()
    if not user or not user.hashed_password or not verify_password(form.password, user.hashed_password):
        raise HTTPException(401, "Invalid email or password")
    return schemas.Token(access_token=create_access_token(user.id), user=schemas.UserOut.model_validate(user))


@router.get("/me", response_model=schemas.UserOut)
def me(user: models.User = Depends(get_current_user)):
    return user


# ---------- Sign in with Google ----------

def upsert_google_user(db: Session, profile: dict) -> models.User:
    """Find, link, or create the account behind a verified Google profile."""
    user = db.query(models.User).filter_by(google_sub=profile["sub"]).first()

    if user is None:
        # Same person signing in with Google for the first time: link it to the
        # account they already have. Safe because Google vouched for the address.
        user = db.query(models.User).filter_by(email=profile["email"]).first()
        if user is not None:
            user.google_sub = profile["sub"]

    if user is None:
        user = models.User(
            email=profile["email"],
            name=profile["name"],
            username=generate_username(db, profile["email"]),
            google_sub=profile["sub"],
            hashed_password=None,
            email_verified=True,
            avatar_url=profile.get("picture"),
        )
        db.add(user)
    else:
        user.email_verified = True
        if profile.get("picture"):
            user.avatar_url = profile["picture"]

    db.commit()
    db.refresh(user)
    return user


@router.post("/google", response_model=schemas.Token,
             summary="Sign in with a Google ID token")
def google_login(payload: schemas.GoogleLogin, db: Session = Depends(get_db)):
    """Exchange the credential from the Google button for a SmartSplit token.

    Creates the account on first use, or links Google to an existing account
    with the same verified email address.
    """
    profile = google_auth.verify(payload.credential)
    user = upsert_google_user(db, profile)
    return schemas.Token(
        access_token=create_access_token(user.id),
        user=schemas.UserOut.model_validate(user),
    )


# ---------- passwordless email OTP ----------

@router.post("/otp/request", response_model=schemas.OTPRequestOut,
             summary="Email a one-time sign-in code")
def request_otp(payload: schemas.OTPRequest, db: Session = Depends(get_db)):
    """Start a passwordless login or signup.

    Sends a 6-digit code to the address. `is_new_user` tells the client whether
    to collect a display name before verifying.
    """
    if not mailer.email_login_available():
        raise HTTPException(503, EMAIL_OFF)

    email = payload.email.lower()
    existing = db.query(models.User).filter_by(email=email).first()

    code = otp.issue(db, email, purpose="login")
    try:
        sent = mailer.send_otp(email, code, purpose="login")
    except Exception:
        raise HTTPException(502, "Could not send the email. Check the SMTP settings and try again.")

    return schemas.OTPRequestOut(
        sent=sent,
        is_new_user=existing is None,
        expires_in_minutes=mailer.OTP_TTL_MINUTES,
        dev_code=_dev_code(sent, code),
        message=(
            f"Code sent to {email}."
            if sent
            else "SMTP is not configured — the code is returned here for local development."
        ),
    )


@router.post("/otp/verify", response_model=schemas.Token,
             summary="Exchange a one-time code for a token")
def verify_otp(payload: schemas.OTPVerify, db: Session = Depends(get_db)):
    """Check the code and sign in. Creates the account if the email is new.

    A successful verification also marks the address as verified, since
    receiving the code proves ownership.
    """
    email = payload.email.lower()
    otp.consume(db, email, payload.code, purpose="login")

    user = db.query(models.User).filter_by(email=email).first()
    if user is None:
        name = (payload.name or "").strip() or email.split("@")[0]
        user = models.User(email=email, name=name, username=generate_username(db, email),
                           hashed_password=None, email_verified=True)
        db.add(user)
    else:
        user.email_verified = True
    db.commit()
    db.refresh(user)

    return schemas.Token(
        access_token=create_access_token(user.id),
        user=schemas.UserOut.model_validate(user),
    )


# ---------- verifying the address on an existing account ----------

@router.post("/verify-email/request", response_model=schemas.OTPRequestOut,
             summary="Email a code to verify the signed-in account's address")
def request_email_verification(
    user: models.User = Depends(get_current_user), db: Session = Depends(get_db)
):
    if not mailer.email_login_available():
        raise HTTPException(503, EMAIL_OFF)
    if user.email_verified:
        return schemas.OTPRequestOut(
            sent=False, is_new_user=False,
            expires_in_minutes=mailer.OTP_TTL_MINUTES,
            message="This email is already verified.",
        )

    code = otp.issue(db, user.email, purpose="verify")
    try:
        sent = mailer.send_otp(user.email, code, purpose="verify")
    except Exception:
        raise HTTPException(502, "Could not send the email. Check the SMTP settings and try again.")

    return schemas.OTPRequestOut(
        sent=sent,
        is_new_user=False,
        expires_in_minutes=mailer.OTP_TTL_MINUTES,
        dev_code=_dev_code(sent, code),
        message=f"Verification code sent to {user.email}." if sent
                else "SMTP is not configured — the code is returned here for local development.",
    )


@router.post("/verify-email/confirm", response_model=schemas.UserOut,
             summary="Confirm the address with the emailed code")
def confirm_email_verification(
    payload: schemas.VerifyEmailConfirm,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    otp.consume(db, user.email, payload.code, purpose="verify")
    user.email_verified = True
    db.commit()
    db.refresh(user)
    return user
