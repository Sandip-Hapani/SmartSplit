import re

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from .. import mailer, models, otp, schemas
from ..auth import get_current_user
from ..database import get_db

router = APIRouter(prefix="/api/account", tags=["account"])

USERNAME_RE = re.compile(r"^[a-z0-9_.]{3,30}$")
RESERVED = {"admin", "root", "smartsplit", "support", "help", "api", "me", "settings", "system"}


def normalize_username(raw: str) -> str:
    return raw.strip().lower().lstrip("@")


def generate_username(db: Session, email: str) -> str:
    """A free handle derived from the email, for accounts created without one."""
    base = re.sub(r"[^a-z0-9_.]", "", email.split("@")[0].lower()).strip(".")[:24] or "user"
    if len(base) < 3:
        base = f"{base}user"
    candidate, n = base, 1
    while db.query(models.User).filter_by(username=candidate).first():
        n += 1
        candidate = f"{base}{n}"
    return candidate


def username_problem(db: Session, candidate: str, me: models.User | None) -> str:
    """Empty string when the handle is free to take."""
    if not USERNAME_RE.match(candidate):
        return ("Use 3–30 characters: lowercase letters, numbers, dots or underscores.")
    if candidate in RESERVED:
        return "That username is reserved."
    owner = db.query(models.User).filter_by(username=candidate).first()
    if owner and (me is None or owner.id != me.id):
        return "That username is already taken."
    return ""


@router.get("/username-available", response_model=schemas.UsernameCheck)
def username_available(username: str = Query(min_length=1),
                       user: models.User = Depends(get_current_user),
                       db: Session = Depends(get_db)):
    problem = username_problem(db, normalize_username(username), user)
    return schemas.UsernameCheck(available=not problem, reason=problem)


@router.get("/search", response_model=list[schemas.UserOut],
            summary="Find people by username, name, or email")
def search_people(q: str = Query(min_length=2),
                  user: models.User = Depends(get_current_user),
                  db: Session = Depends(get_db)):
    like = f"%{q.strip().lower()}%"
    rows = (
        db.query(models.User)
        .filter(
            models.User.id != user.id,
            or_(models.User.username.ilike(like),
                models.User.name.ilike(like),
                models.User.email.ilike(like)),
        )
        .limit(15)
        .all()
    )
    return [schemas.UserOut.model_validate(u) for u in rows]


@router.put("", response_model=schemas.UserOut, summary="Update name, username, or theme")
def update_profile(payload: schemas.ProfileUpdate,
                   user: models.User = Depends(get_current_user),
                   db: Session = Depends(get_db)):
    if payload.username is not None:
        candidate = normalize_username(payload.username)
        problem = username_problem(db, candidate, user)
        if problem:
            raise HTTPException(400, problem)
        user.username = candidate
    if payload.name is not None:
        user.name = payload.name.strip()
    if payload.theme is not None:
        user.theme = payload.theme
    db.commit()
    db.refresh(user)
    return user


# ---------------------------------------------------------------- email change

@router.post("/email/request", response_model=schemas.OTPRequestOut,
             summary="Send a code to the new address to prove ownership")
def request_email_change(payload: schemas.EmailChangeRequest,
                         user: models.User = Depends(get_current_user),
                         db: Session = Depends(get_db)):
    new_email = payload.new_email.lower()
    if new_email == user.email:
        raise HTTPException(400, "That's already your email address.")
    if db.query(models.User).filter_by(email=new_email).first():
        raise HTTPException(400, "Another account already uses that address.")

    # The code goes to the NEW address — that's what proves the user owns it.
    code = otp.issue(db, new_email, purpose="email_change")
    try:
        sent = mailer.send_otp(new_email, code, purpose="verify")
    except Exception:
        raise HTTPException(502, "Could not send the email. Check the SMTP settings and try again.")

    return schemas.OTPRequestOut(
        sent=sent, is_new_user=False,
        expires_in_minutes=mailer.OTP_TTL_MINUTES,
        dev_code=None if sent else code,
        message=f"Code sent to {new_email}." if sent
                else "SMTP is not configured — the code is returned here for local development.",
    )


@router.post("/email/confirm", response_model=schemas.UserOut)
def confirm_email_change(payload: schemas.EmailChangeConfirm,
                         user: models.User = Depends(get_current_user),
                         db: Session = Depends(get_db)):
    new_email = payload.new_email.lower()
    if db.query(models.User).filter_by(email=new_email).first():
        raise HTTPException(400, "Another account already uses that address.")
    otp.consume(db, new_email, payload.code, purpose="email_change")
    user.email = new_email
    user.email_verified = True
    db.commit()
    db.refresh(user)
    return user
