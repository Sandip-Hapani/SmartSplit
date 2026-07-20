"""Balance computation and min-cash-flow debt simplification."""
from collections import defaultdict

from sqlalchemy.orm import Session

from .. import models


def compute_balances(db: Session, group_id: int) -> dict[int, float]:
    """user_id -> net balance. Positive = is owed money."""
    balances: dict[int, float] = defaultdict(float)

    members = db.query(models.GroupMember).filter_by(group_id=group_id).all()
    for m in members:
        balances[m.user_id] = 0.0

    expenses = db.query(models.Expense).filter_by(group_id=group_id).all()
    for exp in expenses:
        balances[exp.paid_by] += exp.amount
        for split in exp.splits:
            balances[split.user_id] -= split.amount

    settlements = db.query(models.Settlement).filter_by(group_id=group_id).all()
    for s in settlements:
        balances[s.from_user] += s.amount
        balances[s.to_user] -= s.amount

    return {uid: round(bal, 2) for uid, bal in balances.items()}


def direct_debts(db: Session, group_id: int) -> list[tuple[int, int, float]]:
    """Who owes whom without netting across the group.

    Used when a group turns simplification off: each debt stays with the person
    who actually paid, and only the two people involved are netted against each
    other. Returns [(from_user, to_user, amount)].
    """
    pair: dict[tuple[int, int], float] = defaultdict(float)

    for exp in db.query(models.Expense).filter_by(group_id=group_id).all():
        for split in exp.splits:
            if split.user_id != exp.paid_by:
                pair[(split.user_id, exp.paid_by)] += split.amount

    for s in db.query(models.Settlement).filter_by(group_id=group_id).all():
        pair[(s.from_user, s.to_user)] -= s.amount

    out: list[tuple[int, int, float]] = []
    seen: set[tuple[int, int]] = set()
    for (debtor, creditor), amount in pair.items():
        key = tuple(sorted((debtor, creditor)))
        if key in seen:
            continue
        seen.add(key)
        net = amount - pair.get((creditor, debtor), 0.0)
        if net > 0.005:
            out.append((debtor, creditor, round(net, 2)))
        elif net < -0.005:
            out.append((creditor, debtor, round(-net, 2)))
    return sorted(out, key=lambda t: -t[2])


def simplify_debts(balances: dict[int, float]) -> list[tuple[int, int, float]]:
    """Greedy min-cash-flow: returns [(from_user, to_user, amount)]."""
    creditors = sorted(
        ((uid, bal) for uid, bal in balances.items() if bal > 0.005),
        key=lambda x: -x[1],
    )
    debtors = sorted(
        ((uid, -bal) for uid, bal in balances.items() if bal < -0.005),
        key=lambda x: -x[1],
    )
    transfers: list[tuple[int, int, float]] = []
    i = j = 0
    creditors = [[uid, amt] for uid, amt in creditors]
    debtors = [[uid, amt] for uid, amt in debtors]
    while i < len(debtors) and j < len(creditors):
        pay = min(debtors[i][1], creditors[j][1])
        transfers.append((debtors[i][0], creditors[j][0], round(pay, 2)))
        debtors[i][1] -= pay
        creditors[j][1] -= pay
        if debtors[i][1] < 0.005:
            i += 1
        if creditors[j][1] < 0.005:
            j += 1
    return transfers
