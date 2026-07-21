"""Activity logging with enough detail to reverse an action.

Undo never deletes history. Reversing entry N appends a new entry that points
back at N and marks it undone, so the log always reads as what actually
happened, in order — the same model as a revert commit.
"""

from __future__ import annotations

import json
from datetime import date, datetime

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .. import models

# Types the UI is allowed to offer an undo button for.
UNDOABLE = {"expense_added", "expense_edited", "expense_deleted", "settlement", "member_added"}


def log(db: Session, group_id: int, user_id: int, type_: str, description: str,
        payload: dict | None = None) -> models.Activity:
    entry = models.Activity(
        group_id=group_id, user_id=user_id, type=type_, description=description,
        payload=json.dumps(payload, default=str) if payload else None,
    )
    db.add(entry)
    return entry


# ---------------------------------------------------------------- snapshots

def snapshot_expense(exp: models.Expense) -> dict:
    """Everything needed to rebuild this expense exactly."""
    return {
        "id": exp.id,
        "description": exp.description,
        "amount": exp.amount,
        "currency": exp.currency,
        "date": exp.date.isoformat() if exp.date else None,
        "paid_by": exp.paid_by,
        "split_type": exp.split_type,
        "notes": exp.notes or "",
        "created_by": exp.created_by,
        "splits": [{"user_id": s.user_id, "amount": s.amount} for s in exp.splits],
        "items": [
            {
                "name": i.name, "quantity": i.quantity, "unit": i.unit or "", "total": i.total,
                "participant_ids": [p.user_id for p in i.participants],
            }
            for i in exp.items
        ],
    }


def restore_expense(db: Session, group_id: int, snap: dict) -> models.Expense:
    """Recreate an expense from a snapshot, reusing its original id when free."""
    exp = models.Expense(
        group_id=group_id,
        description=snap["description"],
        amount=snap["amount"],
        currency=snap.get("currency") or "EUR",
        date=date.fromisoformat(snap["date"]) if snap.get("date") else None,
        paid_by=snap["paid_by"],
        split_type=snap.get("split_type") or "equal",
        notes=snap.get("notes") or "",
        created_by=snap.get("created_by"),
    )
    if snap.get("id") and db.get(models.Expense, snap["id"]) is None:
        exp.id = snap["id"]
    db.add(exp)
    db.flush()

    for s in snap.get("splits", []):
        exp.splits.append(models.ExpenseSplit(user_id=s["user_id"], amount=s["amount"]))
    for i in snap.get("items", []):
        item = models.ExpenseItem(
            name=i["name"], quantity=i.get("quantity", 1),
            unit=i.get("unit") or "", total=i["total"],
        )
        for uid in i.get("participant_ids", []):
            item.participants.append(models.ExpenseItemParticipant(user_id=uid))
        exp.items.append(item)
    db.flush()
    return exp


def _overwrite_expense(db: Session, exp: models.Expense, snap: dict) -> None:
    exp.description = snap["description"]
    exp.amount = snap["amount"]
    exp.currency = snap.get("currency") or "EUR"
    if snap.get("date"):
        exp.date = date.fromisoformat(snap["date"])
    exp.paid_by = snap["paid_by"]
    exp.split_type = snap.get("split_type") or "equal"
    exp.notes = snap.get("notes") or ""

    exp.splits.clear()
    exp.items.clear()
    db.flush()
    for s in snap.get("splits", []):
        exp.splits.append(models.ExpenseSplit(user_id=s["user_id"], amount=s["amount"]))
    for i in snap.get("items", []):
        item = models.ExpenseItem(
            name=i["name"], quantity=i.get("quantity", 1),
            unit=i.get("unit") or "", total=i["total"],
        )
        for uid in i.get("participant_ids", []):
            item.participants.append(models.ExpenseItemParticipant(user_id=uid))
        exp.items.append(item)


# ---------------------------------------------------------------- undo

def undo(db: Session, entry: models.Activity, actor: models.User) -> models.Activity:
    """Reverse one activity and append the entry recording that reversal."""
    if entry.undone:
        raise HTTPException(400, "That change has already been undone.")
    if entry.type not in UNDOABLE:
        raise HTTPException(400, "This kind of activity can't be undone.")

    data = json.loads(entry.payload) if entry.payload else {}
    if not data:
        raise HTTPException(400, "This entry predates undo support, so it can't be reversed.")

    gid = entry.group_id

    if entry.type == "expense_added":
        exp = db.get(models.Expense, data.get("expense_id"))
        if exp is None or exp.group_id != gid:
            raise HTTPException(409, "That expense no longer exists.")
        what = f'"{exp.description}"'
        db.delete(exp)
        description = f"{actor.name} undid adding {what}"

    elif entry.type == "expense_deleted":
        snap = data.get("before") or {}
        if snap.get("id") and db.get(models.Expense, snap["id"]) is not None:
            raise HTTPException(409, "That expense already exists again.")
        restore_expense(db, gid, snap)
        description = f'{actor.name} restored "{snap.get("description", "an expense")}"'

    elif entry.type == "expense_edited":
        snap = data.get("before") or {}
        exp = db.get(models.Expense, snap.get("id") or 0)
        if exp is None or exp.group_id != gid:
            raise HTTPException(409, "That expense no longer exists.")
        _overwrite_expense(db, exp, snap)
        description = f'{actor.name} reverted the edit to "{exp.description}"'

    elif entry.type == "settlement":
        s = db.get(models.Settlement, data.get("settlement_id") or 0)
        if s is None or s.group_id != gid:
            raise HTTPException(409, "That settlement no longer exists.")
        amount = s.amount
        db.delete(s)
        description = f"{actor.name} undid a settlement of €{amount:.2f}"

    elif entry.type == "member_added":
        uid = data.get("user_id")
        membership = db.query(models.GroupMember).filter_by(group_id=gid, user_id=uid).first()
        if membership is None:
            raise HTTPException(409, "That person is no longer in the group.")
        if _has_activity(db, gid, uid):
            raise HTTPException(
                409, "That member already has expenses in this group, so removing them "
                     "would leave the balances inconsistent."
            )
        removed = db.get(models.User, uid)
        db.delete(membership)
        description = f"{actor.name} removed {removed.name if removed else 'a member'} from the group"

    else:  # pragma: no cover - guarded by UNDOABLE above
        raise HTTPException(400, "This kind of activity can't be undone.")

    entry.undone = True
    # Removing a member is its own user-facing action, not a generic reversal,
    # so it gets its own type (and therefore its own icon) in the feed.
    reversal_type = "member_removed" if entry.type == "member_added" else "undo"
    reversal = log(db, gid, actor.id, reversal_type, description,
                   {"undid_activity_id": entry.id, "undid_type": entry.type})
    reversal.undo_of_id = entry.id
    db.flush()
    return reversal


def _has_activity(db: Session, group_id: int, user_id: int) -> bool:
    """True when removing this member would strand money references."""
    paid = db.query(models.Expense).filter_by(group_id=group_id, paid_by=user_id).first()
    if paid:
        return True
    owes = (
        db.query(models.ExpenseSplit)
        .join(models.Expense, models.ExpenseSplit.expense_id == models.Expense.id)
        .filter(models.Expense.group_id == group_id, models.ExpenseSplit.user_id == user_id)
        .first()
    )
    if owes:
        return True
    settled = (
        db.query(models.Settlement)
        .filter(
            models.Settlement.group_id == group_id,
            (models.Settlement.from_user == user_id) | (models.Settlement.to_user == user_id),
        )
        .first()
    )
    return settled is not None
