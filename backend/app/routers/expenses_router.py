from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import get_current_user, require_membership
from ..database import get_db
from ..services.history import log, snapshot_expense
from ..services import currency as fx
from ..services.splits import compute_splits

router = APIRouter(prefix="/api/groups/{group_id}/expenses", tags=["expenses"])


def _expense_out(exp: models.Expense) -> schemas.ExpenseOut:
    return schemas.ExpenseOut(
        id=exp.id, group_id=exp.group_id, description=exp.description, amount=exp.amount,
        currency=exp.currency, date=exp.date, paid_by=exp.paid_by, payer_name=exp.payer.name,
        split_type=exp.split_type, notes=exp.notes or "", created_at=exp.created_at,
        splits=[
            schemas.SplitOut(user_id=s.user_id, user_name=s.user.name, amount=s.amount)
            for s in exp.splits
        ],
        items=[
            schemas.ItemOut(
                id=i.id, name=i.name, quantity=i.quantity, unit=i.unit or "", total=i.total,
                participants=[
                    schemas.ItemParticipantOut(user_id=p.user_id, user_name=p.user.name)
                    for p in i.participants
                ],
            )
            for i in exp.items
        ],
    )


def _apply_payload(db: Session, exp: models.Expense, payload: schemas.ExpenseCreate,
                   member_ids: set[int], group_currency: str = "EUR"):
    if payload.paid_by not in member_ids:
        raise HTTPException(400, "Payer must be a group member")
    per_user = compute_splits(payload, member_ids)

    exp.description = payload.description
    exp.amount = payload.amount
    exp.currency = fx.normalize(payload.currency, group_currency)
    if payload.date:
        exp.date = payload.date
    exp.paid_by = payload.paid_by
    exp.split_type = payload.split_type
    exp.notes = payload.notes

    exp.splits.clear()
    exp.items.clear()
    db.flush()
    for uid, amt in per_user.items():
        exp.splits.append(models.ExpenseSplit(user_id=uid, amount=amt))
    if payload.split_type == "itemized":
        for item in payload.items:
            db_item = models.ExpenseItem(
                name=item.name, quantity=item.quantity, unit=item.unit, total=item.total,
            )
            for uid in item.participant_ids:
                db_item.participants.append(models.ExpenseItemParticipant(user_id=uid))
            exp.items.append(db_item)


@router.get("", response_model=list[schemas.ExpenseOut])
def list_expenses(group_id: int, user: models.User = Depends(get_current_user),
                  db: Session = Depends(get_db)):
    require_membership(db, group_id, user)
    rows = (db.query(models.Expense).filter_by(group_id=group_id)
            .order_by(models.Expense.date.desc(), models.Expense.id.desc()).all())
    return [_expense_out(e) for e in rows]


@router.post("", response_model=schemas.ExpenseOut)
def create_expense(group_id: int, payload: schemas.ExpenseCreate,
                   user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    group = require_membership(db, group_id, user)
    member_ids = {m.user_id for m in db.query(models.GroupMember).filter_by(group_id=group_id)}
    exp = models.Expense(group_id=group_id, created_by=user.id, description="", amount=0, paid_by=user.id)
    db.add(exp)
    _apply_payload(db, exp, payload, member_ids, group.default_currency)
    db.flush()
    log(db, group_id, user.id, "expense_added",
        f"{user.name} added \"{payload.description}\" "
        f"({fx.CURRENCIES[exp.currency][0]}{payload.amount:.2f})",
        {"expense_id": exp.id})
    db.commit()
    db.refresh(exp)
    return _expense_out(exp)


@router.put("/{expense_id}", response_model=schemas.ExpenseOut)
def update_expense(group_id: int, expense_id: int, payload: schemas.ExpenseCreate,
                   user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    group = require_membership(db, group_id, user)
    exp = db.get(models.Expense, expense_id)
    if not exp or exp.group_id != group_id:
        raise HTTPException(404, "Expense not found")
    member_ids = {m.user_id for m in db.query(models.GroupMember).filter_by(group_id=group_id)}
    before = snapshot_expense(exp)
    _apply_payload(db, exp, payload, member_ids, group.default_currency)
    db.flush()
    log(db, group_id, user.id, "expense_edited",
        f"{user.name} edited \"{payload.description}\" "
        f"({fx.CURRENCIES[exp.currency][0]}{payload.amount:.2f})",
        {"before": before, "after": snapshot_expense(exp)})
    db.commit()
    db.refresh(exp)
    return _expense_out(exp)


@router.delete("/{expense_id}")
def delete_expense(group_id: int, expense_id: int,
                   user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_membership(db, group_id, user)
    exp = db.get(models.Expense, expense_id)
    if not exp or exp.group_id != group_id:
        raise HTTPException(404, "Expense not found")
    log(db, group_id, user.id, "expense_deleted",
        f"{user.name} deleted \"{exp.description}\" "
        f"({fx.CURRENCIES[fx.normalize(exp.currency)][0]}{exp.amount:.2f})",
        {"before": snapshot_expense(exp)})
    db.delete(exp)
    db.commit()
    return {"ok": True}
