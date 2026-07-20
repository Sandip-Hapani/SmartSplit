from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import get_current_user, require_membership
from ..database import get_db
from ..services.splits import compute_splits

router = APIRouter(prefix="/api/groups/{group_id}/recurring", tags=["recurring"])


def _advance(d: date, frequency: str) -> date:
    if frequency == "weekly":
        return d + timedelta(weeks=1)
    # monthly: clamp day to month length
    month = d.month % 12 + 1
    year = d.year + (1 if d.month == 12 else 0)
    day = min(d.day, [31, 29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28,
                      31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1])
    return date(year, month, day)


def materialize_due(db: Session, group_id: int) -> int:
    """Create real expenses for every recurring expense whose next_date has
    arrived. Called lazily whenever the group's recurring list is fetched."""
    created = 0
    today = date.today()
    rows = (db.query(models.RecurringExpense)
            .filter_by(group_id=group_id, active=True)
            .filter(models.RecurringExpense.next_date <= today).all())
    member_ids = {m.user_id for m in db.query(models.GroupMember).filter_by(group_id=group_id)}
    for rec in rows:
        while rec.next_date <= today:
            payload = schemas.ExpenseCreate(
                description=rec.description, amount=rec.amount, paid_by=rec.paid_by,
                split_type="equal", participant_ids=sorted(member_ids), date=rec.next_date,
            )
            per_user = compute_splits(payload, member_ids)
            exp = models.Expense(
                group_id=group_id, description=rec.description, amount=rec.amount,
                date=rec.next_date, paid_by=rec.paid_by, split_type="equal",
                notes="(recurring)", created_by=rec.created_by,
            )
            db.add(exp)
            db.flush()
            for uid, amt in per_user.items():
                db.add(models.ExpenseSplit(expense_id=exp.id, user_id=uid, amount=amt))
            db.add(models.Activity(
                group_id=group_id, user_id=rec.created_by, type="expense_added",
                description=f"Recurring expense \"{rec.description}\" (€{rec.amount:.2f}) was added automatically",
            ))
            rec.next_date = _advance(rec.next_date, rec.frequency)
            created += 1
    if created:
        db.commit()
    return created


def _out(rec: models.RecurringExpense) -> schemas.RecurringOut:
    return schemas.RecurringOut(
        id=rec.id, description=rec.description, amount=rec.amount, paid_by=rec.paid_by,
        payer_name=rec.payer.name, frequency=rec.frequency, next_date=rec.next_date,
        active=rec.active,
    )


@router.get("", response_model=list[schemas.RecurringOut])
def list_recurring(group_id: int, user: models.User = Depends(get_current_user),
                   db: Session = Depends(get_db)):
    require_membership(db, group_id, user)
    materialize_due(db, group_id)
    rows = db.query(models.RecurringExpense).filter_by(group_id=group_id).all()
    return [_out(r) for r in rows]


@router.post("", response_model=schemas.RecurringOut)
def create_recurring(group_id: int, payload: schemas.RecurringCreate,
                     user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_membership(db, group_id, user)
    member_ids = {m.user_id for m in db.query(models.GroupMember).filter_by(group_id=group_id)}
    if payload.paid_by not in member_ids:
        raise HTTPException(400, "Payer must be a group member")
    if payload.frequency not in ("weekly", "monthly"):
        raise HTTPException(400, "Frequency must be weekly or monthly")
    rec = models.RecurringExpense(
        group_id=group_id, description=payload.description, amount=payload.amount,
        paid_by=payload.paid_by, frequency=payload.frequency, next_date=payload.next_date,
        created_by=user.id,
    )
    db.add(rec)
    db.add(models.Activity(
        group_id=group_id, user_id=user.id, type="recurring_added",
        description=f"{user.name} set up recurring \"{payload.description}\" ({payload.frequency}, €{payload.amount:.2f})",
    ))
    db.commit()
    db.refresh(rec)
    return _out(rec)


@router.delete("/{recurring_id}")
def deactivate_recurring(group_id: int, recurring_id: int,
                         user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_membership(db, group_id, user)
    rec = db.get(models.RecurringExpense, recurring_id)
    if not rec or rec.group_id != group_id:
        raise HTTPException(404, "Not found")
    rec.active = False
    db.commit()
    return {"ok": True}
