"""Spending summaries and CSV export."""

from __future__ import annotations

import csv
import io
from datetime import date

from sqlalchemy.orm import Session

from .. import models

MONTHS_BACK = 12


def _month_key(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def _shift(year: int, month: int, delta: int) -> tuple[int, int]:
    idx = year * 12 + (month - 1) + delta
    return idx // 12, idx % 12 + 1


def _expenses_for(db: Session, group_ids: list[int]) -> list[models.Expense]:
    if not group_ids:
        return []
    return (
        db.query(models.Expense)
        .filter(models.Expense.group_id.in_(group_ids))
        .order_by(models.Expense.date.asc(), models.Expense.id.asc())
        .all()
    )


def my_group_ids(db: Session, user_id: int) -> list[int]:
    return [m.group_id for m in db.query(models.GroupMember).filter_by(user_id=user_id)]


def build_stats(db: Session, group_ids: list[int], user_id: int, today: date | None = None) -> dict:
    """Totals plus a month-by-month series.

    `total` is what the group spent; `mine` is this user's share of it, so the
    two are directly comparable on one axis.
    """
    today = today or date.today()
    expenses = _expenses_for(db, group_ids)

    this_key = _month_key(today)
    ly, lm = _shift(today.year, today.month, -1)
    last_key = f"{ly:04d}-{lm:02d}"

    buckets: dict[str, dict[str, float]] = {}
    all_total = all_mine = 0.0
    for exp in expenses:
        key = _month_key(exp.date)
        b = buckets.setdefault(key, {"total": 0.0, "mine": 0.0, "count": 0})
        share = sum(s.amount for s in exp.splits if s.user_id == user_id)
        b["total"] += exp.amount
        b["mine"] += share
        b["count"] += 1
        all_total += exp.amount
        all_mine += share

    # a continuous run of months so the chart has no gaps
    series = []
    for i in range(MONTHS_BACK - 1, -1, -1):
        y, m = _shift(today.year, today.month, -i)
        key = f"{y:04d}-{m:02d}"
        b = buckets.get(key, {"total": 0.0, "mine": 0.0, "count": 0})
        series.append({
            "month": key,
            "label": date(y, m, 1).strftime("%b"),
            "year": y,
            "total": round(b["total"], 2),
            "mine": round(b["mine"], 2),
            "count": int(b["count"]),
        })

    this_b = buckets.get(this_key, {"total": 0.0, "mine": 0.0, "count": 0})
    last_b = buckets.get(last_key, {"total": 0.0, "mine": 0.0, "count": 0})

    return {
        "currency": "EUR",
        "expense_count": len(expenses),
        "all_time_total": round(all_total, 2),
        "all_time_mine": round(all_mine, 2),
        "this_month_total": round(this_b["total"], 2),
        "this_month_mine": round(this_b["mine"], 2),
        "this_month_label": date(today.year, today.month, 1).strftime("%B %Y"),
        "last_month_total": round(last_b["total"], 2),
        "last_month_mine": round(last_b["mine"], 2),
        "last_month_label": date(ly, lm, 1).strftime("%B %Y"),
        "monthly": series,
    }


def short_name(name: str) -> str:
    """"Chaitali Tamboliya" -> "Chaitali T." — how settlements read in the ledger."""
    parts = (name or "").split()
    if len(parts) < 2:
        return name or "Someone"
    return f"{parts[0]} {parts[-1][0]}."


def _money(v: float) -> str:
    return f"{v:.2f}"


def expenses_csv(db: Session, group_ids: list[int], user_id: int,
                 with_group_column: bool = False, today: date | None = None) -> str:
    """Splitwise-style ledger.

    One column per person; each cell is that person's net effect on the row —
    what they paid minus what they owed. So a row sums to zero, positive means
    they are up on it, and the closing balance row is just each column's sum.

    Settlements appear inline as "A paid B" rows, which is what makes the
    balance column reconcile. This layout does not depend on the group's
    simplification setting: simplification only affects *suggested* transfers,
    never the underlying ledger or the net balances.
    """
    today = today or date.today()
    group_ids = group_ids or []
    group_names = {
        g.id: g.name
        for g in db.query(models.Group).filter(models.Group.id.in_(group_ids or [0])).all()
    }

    expenses = _expenses_for(db, group_ids)
    settlements = (
        db.query(models.Settlement)
        .filter(models.Settlement.group_id.in_(group_ids or [0]))
        .order_by(models.Settlement.date.asc(), models.Settlement.id.asc())
        .all()
        if group_ids else []
    )

    # Column order: current members first (by the order they joined), then
    # anyone who only appears in history, flagged so the numbers still add up.
    current: list[int] = []
    for m in (db.query(models.GroupMember)
              .filter(models.GroupMember.group_id.in_(group_ids or [0]))
              .order_by(models.GroupMember.id.asc()).all()):
        if m.user_id not in current:
            current.append(m.user_id)

    referenced: list[int] = []
    for exp in expenses:
        for uid in [exp.paid_by] + [s.user_id for s in exp.splits]:
            if uid not in current and uid not in referenced:
                referenced.append(uid)
    for s in settlements:
        for uid in (s.from_user, s.to_user):
            if uid not in current and uid not in referenced:
                referenced.append(uid)

    people = current + referenced
    users = {u.id: u for u in db.query(models.User).filter(models.User.id.in_(people or [0])).all()}
    headers = [
        f"{users[uid].name} (removed)" if uid in referenced else users[uid].name
        for uid in people if uid in users
    ]
    people = [uid for uid in people if uid in users]

    lead = ["Date"] + (["Group"] if with_group_column else [])
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(lead + ["Description", "Category", "Cost", "Currency"] + headers)
    writer.writerow([])  # Splitwise leaves this blank line under the header

    totals = {uid: 0.0 for uid in people}
    currency = "EUR"

    rows: list[tuple] = []
    for exp in expenses:
        owed = {s.user_id: s.amount for s in exp.splits}
        effect = {
            uid: (exp.amount if uid == exp.paid_by else 0.0) - owed.get(uid, 0.0)
            for uid in people
        }
        currency = exp.currency or currency
        rows.append((
            exp.date, exp.id, exp.group_id, exp.description, "General",
            exp.amount, exp.currency or "EUR", effect,
        ))

    for s in settlements:
        payer = users.get(s.from_user)
        payee = users.get(s.to_user)
        effect = {uid: 0.0 for uid in people}
        effect[s.from_user] = effect.get(s.from_user, 0.0) + s.amount
        effect[s.to_user] = effect.get(s.to_user, 0.0) - s.amount
        rows.append((
            s.date, s.id, s.group_id,
            f"{short_name(payer.name if payer else '')} paid "
            f"{short_name(payee.name if payee else '')}",
            "Payment", s.amount, currency, effect,
        ))

    rows.sort(key=lambda r: (r[0] or date.min, r[1]))

    for d, _id, gid, desc, category, cost, cur, effect in rows:
        line = [d.isoformat() if d else ""]
        if with_group_column:
            line.append(group_names.get(gid, ""))
        line += [desc, category, _money(cost), cur]
        for uid in people:
            v = round(effect.get(uid, 0.0), 2)
            totals[uid] += v
            line.append(_money(v))
        writer.writerow(line)

    writer.writerow([])
    closing = [today.isoformat()]
    if with_group_column:
        closing.append(" ")
    closing += ["Total balance", " ", " ", currency]
    closing += [_money(round(totals[uid], 2)) for uid in people]
    writer.writerow(closing)
    return buf.getvalue()
