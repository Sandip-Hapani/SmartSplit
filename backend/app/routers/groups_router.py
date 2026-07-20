from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import get_current_user, require_membership
from ..database import get_db
from ..services.history import UNDOABLE, log, undo
from ..services.simplify import compute_balances, direct_debts, simplify_debts

router = APIRouter(prefix="/api/groups", tags=["groups"])


def _group_out(db: Session, group: models.Group) -> schemas.GroupOut:
    members = [schemas.UserOut.model_validate(m.user) for m in group.members]
    return schemas.GroupOut(
        id=group.id, name=group.name, created_by=group.created_by,
        simplify_debts=group.simplify_debts, members=members,
    )


def _activity_out(a: models.Activity, group_name: str | None = None) -> schemas.ActivityOut:
    return schemas.ActivityOut(
        id=a.id, type=a.type, description=a.description,
        user_name=a.user.name if a.user else None, created_at=a.created_at,
        can_undo=(a.type in UNDOABLE and not a.undone and bool(a.payload)),
        undone=a.undone, undo_of_id=a.undo_of_id,
        group_id=a.group_id, group_name=group_name,
    )


@router.get("", response_model=list[schemas.GroupOut])
def my_groups(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    memberships = db.query(models.GroupMember).filter_by(user_id=user.id).all()
    return [_group_out(db, m.group) for m in memberships]


@router.post("", response_model=schemas.GroupOut)
def create_group(payload: schemas.GroupCreate, user: models.User = Depends(get_current_user),
                 db: Session = Depends(get_db)):
    group = models.Group(name=payload.name, created_by=user.id)
    db.add(group)
    db.flush()
    db.add(models.GroupMember(group_id=group.id, user_id=user.id))
    log(db, group.id, user.id, "group_created", f"{user.name} created group \"{group.name}\"")
    db.commit()
    db.refresh(group)
    return _group_out(db, group)


@router.get("/{group_id}", response_model=schemas.GroupOut)
def get_group(group_id: int, user: models.User = Depends(get_current_user),
              db: Session = Depends(get_db)):
    group = require_membership(db, group_id, user)
    return _group_out(db, group)


@router.put("/{group_id}", response_model=schemas.GroupOut, summary="Rename or change settings")
def update_group(group_id: int, payload: schemas.GroupUpdate,
                 user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    group = require_membership(db, group_id, user)
    if payload.name is not None and payload.name.strip() != group.name:
        old = group.name
        group.name = payload.name.strip()
        log(db, group_id, user.id, "group_renamed",
            f'{user.name} renamed the group from "{old}" to "{group.name}"')
    if payload.simplify_debts is not None and payload.simplify_debts != group.simplify_debts:
        group.simplify_debts = payload.simplify_debts
        state = "on" if payload.simplify_debts else "off"
        log(db, group_id, user.id, "group_settings",
            f"{user.name} turned debt simplification {state}")
    db.commit()
    db.refresh(group)
    return _group_out(db, group)


@router.post("/{group_id}/members", response_model=schemas.GroupOut)
def add_member(group_id: int, payload: schemas.AddMember,
               user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    group = require_membership(db, group_id, user)
    if payload.user_id is not None:
        new_user = db.get(models.User, payload.user_id)
    elif payload.username:
        new_user = db.query(models.User).filter_by(
            username=payload.username.strip().lower().lstrip("@")).first()
    elif payload.email:
        new_user = db.query(models.User).filter_by(email=payload.email.lower()).first()
    else:
        raise HTTPException(400, "Provide an email, a username, or a user id")
    if not new_user:
        raise HTTPException(404, "No registered user matches — ask them to sign up first")
    if db.query(models.GroupMember).filter_by(group_id=group_id, user_id=new_user.id).first():
        raise HTTPException(400, "Already a member")
    db.add(models.GroupMember(group_id=group_id, user_id=new_user.id))
    log(db, group_id, user.id, "member_added", f"{user.name} added {new_user.name} to the group",
        {"user_id": new_user.id})
    db.commit()
    db.refresh(group)
    return _group_out(db, group)


@router.get("/{group_id}/balances", response_model=list[schemas.BalanceOut])
def balances(group_id: int, user: models.User = Depends(get_current_user),
             db: Session = Depends(get_db)):
    require_membership(db, group_id, user)
    bals = compute_balances(db, group_id)
    users = {u.id: u for u in db.query(models.User).filter(models.User.id.in_(bals)).all()}
    return [
        schemas.BalanceOut(user_id=uid, user_name=users[uid].name, balance=bal)
        for uid, bal in sorted(bals.items(), key=lambda x: -x[1])
    ]


@router.get("/{group_id}/simplify", response_model=list[schemas.TransferOut],
            summary="Suggested payments, honouring the group's simplification setting")
def simplify(group_id: int, user: models.User = Depends(get_current_user),
             db: Session = Depends(get_db)):
    group = require_membership(db, group_id, user)
    bals = compute_balances(db, group_id)
    # With simplification off, debts stay between the people who actually shared
    # the expense instead of being netted across everyone.
    transfers = simplify_debts(bals) if group.simplify_debts else direct_debts(db, group_id)
    ids = set(bals) | {u for t in transfers for u in t[:2]}
    users = {u.id: u for u in db.query(models.User).filter(models.User.id.in_(ids)).all()}
    return [
        schemas.TransferOut(
            from_user=f, from_name=users[f].name, to_user=t, to_name=users[t].name, amount=a
        )
        for f, t, a in transfers
    ]


@router.post("/{group_id}/settlements", response_model=schemas.SettlementOut)
def settle(group_id: int, payload: schemas.SettlementCreate,
           user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_membership(db, group_id, user)
    member_ids = {m.user_id for m in db.query(models.GroupMember).filter_by(group_id=group_id)}
    if payload.from_user not in member_ids or payload.to_user not in member_ids:
        raise HTTPException(400, "Both users must be group members")
    if payload.from_user == payload.to_user:
        raise HTTPException(400, "Cannot settle with yourself")
    s = models.Settlement(
        group_id=group_id, from_user=payload.from_user, to_user=payload.to_user,
        amount=payload.amount, **({"date": payload.date} if payload.date else {}),
    )
    db.add(s)
    db.flush()
    users = {u.id: u for u in db.query(models.User).filter(models.User.id.in_([s.from_user, s.to_user]))}
    log(db, group_id, user.id, "settlement",
        f"{users[s.from_user].name} paid {users[s.to_user].name} €{s.amount:.2f}",
        {"settlement_id": s.id})
    db.commit()
    db.refresh(s)
    return schemas.SettlementOut(
        id=s.id, from_user=s.from_user, from_name=users[s.from_user].name,
        to_user=s.to_user, to_name=users[s.to_user].name, amount=s.amount, date=s.date,
    )


@router.get("/{group_id}/settlements", response_model=list[schemas.SettlementOut])
def list_settlements(group_id: int, user: models.User = Depends(get_current_user),
                     db: Session = Depends(get_db)):
    require_membership(db, group_id, user)
    out = []
    for s in (db.query(models.Settlement).filter_by(group_id=group_id)
              .order_by(models.Settlement.created_at.desc()).all()):
        out.append(schemas.SettlementOut(
            id=s.id, from_user=s.from_user, from_name=s.payer.name,
            to_user=s.to_user, to_name=s.payee.name, amount=s.amount, date=s.date,
        ))
    return out


@router.get("/{group_id}/activity", response_model=list[schemas.ActivityOut])
def activity(group_id: int, user: models.User = Depends(get_current_user),
             db: Session = Depends(get_db)):
    group = require_membership(db, group_id, user)
    rows = (db.query(models.Activity).filter_by(group_id=group_id)
            .order_by(models.Activity.created_at.desc()).limit(200).all())
    return [_activity_out(a, group.name) for a in rows]


@router.post("/{group_id}/activity/{activity_id}/undo", response_model=schemas.ActivityOut,
             summary="Reverse an activity by appending a new one")
def undo_activity(group_id: int, activity_id: int,
                  user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    group = require_membership(db, group_id, user)
    entry = db.get(models.Activity, activity_id)
    if entry is None or entry.group_id != group_id:
        raise HTTPException(404, "Activity not found")
    reversal = undo(db, entry, user)
    db.commit()
    db.refresh(reversal)
    return _activity_out(reversal, group.name)


# ---------------------------------------------------------------- whiteboard

@router.get("/{group_id}/notes", response_model=list[schemas.NoteOut],
            summary="Read the group's shared whiteboard")
def list_notes(group_id: int, user: models.User = Depends(get_current_user),
               db: Session = Depends(get_db)):
    require_membership(db, group_id, user)
    rows = (db.query(models.GroupNote).filter_by(group_id=group_id)
            .order_by(models.GroupNote.created_at.desc()).all())
    return [
        schemas.NoteOut(
            id=n.id, body=n.body, user_id=n.user_id, author_name=n.author.name,
            created_at=n.created_at, updated_at=n.updated_at,
        )
        for n in rows
    ]


@router.post("/{group_id}/notes", response_model=schemas.NoteOut)
def add_note(group_id: int, payload: schemas.NoteCreate,
             user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_membership(db, group_id, user)
    note = models.GroupNote(group_id=group_id, user_id=user.id, body=payload.body.strip())
    db.add(note)
    db.commit()
    db.refresh(note)
    return schemas.NoteOut(
        id=note.id, body=note.body, user_id=note.user_id, author_name=user.name,
        created_at=note.created_at, updated_at=note.updated_at,
    )


@router.put("/{group_id}/notes/{note_id}", response_model=schemas.NoteOut)
def edit_note(group_id: int, note_id: int, payload: schemas.NoteCreate,
              user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_membership(db, group_id, user)
    note = db.get(models.GroupNote, note_id)
    if note is None or note.group_id != group_id:
        raise HTTPException(404, "Note not found")
    if note.user_id != user.id:
        raise HTTPException(403, "Only the author can edit a note.")
    note.body = payload.body.strip()
    note.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(note)
    return schemas.NoteOut(
        id=note.id, body=note.body, user_id=note.user_id, author_name=note.author.name,
        created_at=note.created_at, updated_at=note.updated_at,
    )


@router.delete("/{group_id}/notes/{note_id}")
def delete_note(group_id: int, note_id: int,
                user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_membership(db, group_id, user)
    note = db.get(models.GroupNote, note_id)
    if note is None or note.group_id != group_id:
        raise HTTPException(404, "Note not found")
    if note.user_id != user.id:
        raise HTTPException(403, "Only the author can delete a note.")
    db.delete(note)
    db.commit()
    return {"ok": True}
