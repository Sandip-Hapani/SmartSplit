"""Balance computation and min-cash-flow debt simplification.

Everything here is **per currency**. A group that spent in EUR and CHF has two
independent ledgers; they are never netted against each other, because doing so
would freeze an exchange rate into what someone owes.
"""
from collections import defaultdict

from sqlalchemy.orm import Session

from .. import models
from .currency import normalize


def payers_of(exp) -> list[tuple[int, float]]:
    """[(user_id, amount)] — falls back to the single payer for older rows."""
    if exp.payments:
        return [(p.user_id, p.amount) for p in exp.payments]
    return [(exp.paid_by, exp.amount)]


def compute_balances(db: Session, group_id: int) -> dict[str, dict[int, float]]:
    """currency -> {user_id: net balance}. Positive = is owed money."""
    members = [m.user_id for m in db.query(models.GroupMember).filter_by(group_id=group_id)]
    per_currency: dict[str, dict[int, float]] = {}

    def bucket(code: str) -> dict[int, float]:
        if code not in per_currency:
            per_currency[code] = {uid: 0.0 for uid in members}
        return per_currency[code]

    for exp in db.query(models.Expense).filter_by(group_id=group_id).all():
        b = bucket(normalize(exp.currency))
        for uid, paid in payers_of(exp):        # every payer is credited
            b[uid] = b.get(uid, 0.0) + paid
        for split in exp.splits:
            b[split.user_id] = b.get(split.user_id, 0.0) - split.amount

    for s in db.query(models.Settlement).filter_by(group_id=group_id).all():
        b = bucket(normalize(s.currency))
        b[s.from_user] = b.get(s.from_user, 0.0) + s.amount
        b[s.to_user] = b.get(s.to_user, 0.0) - s.amount

    return {
        code: {uid: round(v, 2) for uid, v in bal.items()}
        for code, bal in per_currency.items()
    }


def direct_debts(db: Session, group_id: int) -> dict[str, list[tuple[int, int, float]]]:
    """Who owes whom without netting across the group, per currency.

    Used when a group turns simplification off: each debt stays with the person
    who actually paid, and only the two people involved are netted.
    """
    pairs: dict[str, dict[tuple[int, int], float]] = defaultdict(lambda: defaultdict(float))

    for exp in db.query(models.Expense).filter_by(group_id=group_id).all():
        code = normalize(exp.currency)
        payers = payers_of(exp)
        total_paid = sum(a for _, a in payers) or exp.amount or 1.0
        # each participant owes every payer in proportion to what that payer put in
        for split in exp.splits:
            for payer_id, paid in payers:
                if split.user_id == payer_id:
                    continue
                pairs[code][(split.user_id, payer_id)] += split.amount * (paid / total_paid)

    for s in db.query(models.Settlement).filter_by(group_id=group_id).all():
        pairs[normalize(s.currency)][(s.from_user, s.to_user)] -= s.amount

    out: dict[str, list[tuple[int, int, float]]] = {}
    for code, pair in pairs.items():
        rows: list[tuple[int, int, float]] = []
        seen: set[tuple[int, int]] = set()
        for (debtor, creditor), amount in pair.items():
            key = tuple(sorted((debtor, creditor)))
            if key in seen:
                continue
            seen.add(key)
            net = amount - pair.get((creditor, debtor), 0.0)
            if net > 0.005:
                rows.append((debtor, creditor, round(net, 2)))
            elif net < -0.005:
                rows.append((creditor, debtor, round(-net, 2)))
        if rows:
            out[code] = sorted(rows, key=lambda t: -t[2])
    return out


def simplify_debts(balances: dict[int, float]) -> list[tuple[int, int, float]]:
    """Greedy min-cash-flow over one currency: returns [(from_user, to_user, amount)]."""
    creditors = [[uid, bal] for uid, bal in
                 sorted(balances.items(), key=lambda x: -x[1]) if bal > 0.005]
    debtors = [[uid, -bal] for uid, bal in
               sorted(balances.items(), key=lambda x: x[1]) if bal < -0.005]

    transfers: list[tuple[int, int, float]] = []
    i = j = 0
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


def transfers_for(db: Session, group: models.Group) -> dict[str, list[tuple[int, int, float]]]:
    """Suggested payments per currency, honouring the group's simplify setting."""
    if not group.simplify_debts:
        return direct_debts(db, group.id)
    return {
        code: t
        for code, bal in compute_balances(db, group.id).items()
        if (t := simplify_debts(bal))
    }
