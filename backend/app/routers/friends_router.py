import hashlib
import os
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import SECRET_KEY, get_current_user
from ..database import get_db

router = APIRouter(prefix="/api/friends", tags=["friends"])


# ---------------------------------------------------------------- invite codes

def invite_code(user: models.User) -> str:
    """Stable per-user code embedded in the QR image.

    Derived from the server secret so it can't be guessed from the user id, and
    it changes if the account's email changes.
    """
    raw = f"{user.id}:{user.email}:{SECRET_KEY}".encode()
    return f"{user.id}-{hashlib.sha256(raw).hexdigest()[:16]}"


def user_from_code(db: Session, code: str) -> models.User | None:
    head, _, _ = code.strip().partition("-")
    if not head.isdigit():
        return None
    user = db.get(models.User, int(head))
    if user is None or invite_code(user) != code.strip():
        return None
    return user


# ---------------------------------------------------------------- helpers

def _link(db: Session, a: int, b: int) -> models.Friendship | None:
    return (
        db.query(models.Friendship)
        .filter(
            or_(
                (models.Friendship.requester_id == a) & (models.Friendship.addressee_id == b),
                (models.Friendship.requester_id == b) & (models.Friendship.addressee_id == a),
            )
        )
        .first()
    )


def are_friends(db: Session, a: int, b: int) -> bool:
    link = _link(db, a, b)
    return bool(link and link.status == "accepted")


def _unread_from(db: Session, sender_id: int, me: int) -> int:
    return (
        db.query(models.Message)
        .filter_by(sender_id=sender_id, recipient_id=me, read_at=None)
        .count()
    )


# ---------------------------------------------------------------- friends list

@router.get("", response_model=list[schemas.FriendOut])
def my_friends(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    links = (
        db.query(models.Friendship)
        .filter(
            models.Friendship.status == "accepted",
            or_(models.Friendship.requester_id == user.id,
                models.Friendship.addressee_id == user.id),
        )
        .all()
    )
    out = []
    for link in links:
        other = link.addressee if link.requester_id == user.id else link.requester
        out.append(schemas.FriendOut(
            user=schemas.UserOut.model_validate(other),
            friendship_id=link.id,
            since=link.responded_at,
            unread=_unread_from(db, other.id, user.id),
        ))
    out.sort(key=lambda f: (-f.unread, f.user.name.lower()))
    return out


@router.get("/requests", response_model=list[schemas.FriendRequestOut])
def pending_requests(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    links = (
        db.query(models.Friendship)
        .filter(
            models.Friendship.status == "pending",
            or_(models.Friendship.requester_id == user.id,
                models.Friendship.addressee_id == user.id),
        )
        .order_by(models.Friendship.created_at.desc())
        .all()
    )
    return [
        schemas.FriendRequestOut(
            friendship_id=l.id,
            user=schemas.UserOut.model_validate(
                l.addressee if l.requester_id == user.id else l.requester
            ),
            direction="outgoing" if l.requester_id == user.id else "incoming",
            created_at=l.created_at,
        )
        for l in links
    ]


@router.get("/invite-code")
def my_invite_code(user: models.User = Depends(get_current_user)):
    """The value encoded in this user's QR code."""
    return {"code": invite_code(user), "username": user.username}


@router.post("/request", response_model=schemas.FriendRequestOut,
             summary="Send a friend request by username, email, or scanned code")
def send_request(payload: schemas.FriendInvite,
                 user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    target: models.User | None = None
    if payload.code:
        target = user_from_code(db, payload.code)
        if target is None:
            raise HTTPException(400, "That invite code isn't valid.")
    elif payload.username:
        target = db.query(models.User).filter_by(username=payload.username.strip().lower()).first()
    elif payload.email:
        target = db.query(models.User).filter_by(email=payload.email.lower()).first()
    else:
        raise HTTPException(400, "Provide a username, an email, or a scanned code.")

    if target is None:
        raise HTTPException(404, "No SmartSplit account matches that.")
    if target.id == user.id:
        raise HTTPException(400, "You can't add yourself.")

    existing = _link(db, user.id, target.id)
    if existing:
        if existing.status == "accepted":
            raise HTTPException(400, f"You and {target.name} are already friends.")
        if existing.requester_id == user.id:
            raise HTTPException(400, "You've already sent them a request.")
        # they asked first — treat this as accepting
        existing.status = "accepted"
        existing.responded_at = datetime.utcnow()
        db.commit()
        return schemas.FriendRequestOut(
            friendship_id=existing.id, user=schemas.UserOut.model_validate(target),
            direction="incoming", created_at=existing.created_at,
        )

    link = models.Friendship(requester_id=user.id, addressee_id=target.id, status="pending")
    db.add(link)
    db.commit()
    db.refresh(link)
    return schemas.FriendRequestOut(
        friendship_id=link.id, user=schemas.UserOut.model_validate(target),
        direction="outgoing", created_at=link.created_at,
    )


@router.post("/requests/{friendship_id}/accept", response_model=schemas.FriendOut)
def accept_request(friendship_id: int,
                   user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    link = db.get(models.Friendship, friendship_id)
    if link is None or link.addressee_id != user.id:
        raise HTTPException(404, "Request not found.")
    if link.status == "accepted":
        raise HTTPException(400, "Already friends.")
    link.status = "accepted"
    link.responded_at = datetime.utcnow()
    db.commit()
    return schemas.FriendOut(
        user=schemas.UserOut.model_validate(link.requester),
        friendship_id=link.id, since=link.responded_at, unread=0,
    )


@router.delete("/requests/{friendship_id}", summary="Decline or cancel a request")
def drop_request(friendship_id: int,
                 user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    link = db.get(models.Friendship, friendship_id)
    if link is None or user.id not in (link.requester_id, link.addressee_id):
        raise HTTPException(404, "Request not found.")
    db.delete(link)
    db.commit()
    return {"ok": True}


@router.delete("/{user_id}", summary="Unfriend someone")
def unfriend(user_id: int,
             user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    link = _link(db, user.id, user_id)
    if link is None:
        raise HTTPException(404, "You aren't friends with that person.")
    db.delete(link)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- chat

@router.get("/{user_id}/messages", response_model=list[schemas.MessageOut])
def conversation(user_id: int, user: models.User = Depends(get_current_user),
                 db: Session = Depends(get_db)):
    if not are_friends(db, user.id, user_id):
        raise HTTPException(403, "You can only message friends.")
    rows = (
        db.query(models.Message)
        .filter(
            or_(
                (models.Message.sender_id == user.id) & (models.Message.recipient_id == user_id),
                (models.Message.sender_id == user_id) & (models.Message.recipient_id == user.id),
            )
        )
        .order_by(models.Message.created_at.asc())
        .limit(500)
        .all()
    )
    now = datetime.utcnow()
    for m in rows:
        if m.recipient_id == user.id and m.read_at is None:
            m.read_at = now
    db.commit()
    return [
        schemas.MessageOut(
            id=m.id, sender_id=m.sender_id, recipient_id=m.recipient_id,
            body=m.body, created_at=m.created_at, mine=m.sender_id == user.id,
        )
        for m in rows
    ]


@router.post("/{user_id}/messages", response_model=schemas.MessageOut)
def send_message(user_id: int, payload: schemas.MessageCreate,
                 user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not are_friends(db, user.id, user_id):
        raise HTTPException(403, "You can only message friends.")
    body = payload.body.strip()
    if not body:
        raise HTTPException(400, "Message is empty.")
    m = models.Message(sender_id=user.id, recipient_id=user_id, body=body)
    db.add(m)
    db.commit()
    db.refresh(m)
    return schemas.MessageOut(
        id=m.id, sender_id=m.sender_id, recipient_id=m.recipient_id,
        body=m.body, created_at=m.created_at, mine=True,
    )
