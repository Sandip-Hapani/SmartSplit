"""Turn an ExpenseCreate payload into per-user owed amounts that sum exactly
to the expense amount (cent-accurate rounding)."""
from fastapi import HTTPException

from ..schemas import ExpenseCreate

TOL = 0.011


def _round_preserving_sum(raw: dict[int, float], target: float) -> dict[int, float]:
    """Round each share to cents, then push the leftover cents onto users in a
    stable order so the rounded shares sum exactly to target."""
    cents = {uid: int(round(v * 100)) for uid, v in raw.items()}
    target_cents = int(round(target * 100))
    diff = target_cents - sum(cents.values())
    for uid in sorted(cents, key=lambda u: -raw[u]):
        if diff == 0:
            break
        step = 1 if diff > 0 else -1
        cents[uid] += step
        diff -= step
    return {uid: c / 100 for uid, c in cents.items()}


def compute_splits(payload: ExpenseCreate, member_ids: set[int]) -> dict[int, float]:
    st = payload.split_type

    if st == "equal":
        ids = payload.participant_ids or sorted(member_ids)
        _check_members(ids, member_ids)
        share = payload.amount / len(ids)
        return _round_preserving_sum({uid: share for uid in ids}, payload.amount)

    if st == "exact":
        ids = [s.user_id for s in payload.splits]
        _check_members(ids, member_ids)
        total = sum(s.value for s in payload.splits)
        if abs(total - payload.amount) > TOL:
            raise HTTPException(400, f"Exact amounts sum to {total:.2f}, expense is {payload.amount:.2f}")
        return _round_preserving_sum({s.user_id: s.value for s in payload.splits}, payload.amount)

    if st == "percent":
        ids = [s.user_id for s in payload.splits]
        _check_members(ids, member_ids)
        pct = sum(s.value for s in payload.splits)
        if abs(pct - 100) > 0.1:
            raise HTTPException(400, f"Percentages sum to {pct:.1f}, must be 100")
        raw = {s.user_id: payload.amount * s.value / 100 for s in payload.splits}
        return _round_preserving_sum(raw, payload.amount)

    if st == "shares":
        ids = [s.user_id for s in payload.splits]
        _check_members(ids, member_ids)
        weight = sum(s.value for s in payload.splits)
        if weight <= 0:
            raise HTTPException(400, "Total shares must be positive")
        raw = {s.user_id: payload.amount * s.value / weight for s in payload.splits}
        return _round_preserving_sum(raw, payload.amount)

    if st == "itemized":
        if not payload.items:
            raise HTTPException(400, "Itemized expense needs items")
        totals: dict[int, float] = {}
        items_sum = 0.0
        for item in payload.items:
            if not item.participant_ids:
                raise HTTPException(400, f"Item '{item.name}' has no participants")
            _check_members(item.participant_ids, member_ids)
            items_sum += item.total
            # round each item's shares so every item is itself cent-consistent
            share = item.total / len(item.participant_ids)
            item_shares = _round_preserving_sum(
                {uid: share for uid in item.participant_ids}, item.total
            )
            for uid, amt in item_shares.items():
                totals[uid] = round(totals.get(uid, 0) + amt, 2)
        if abs(items_sum - payload.amount) > TOL:
            raise HTTPException(
                400,
                f"Items sum to {items_sum:.2f} but expense amount is {payload.amount:.2f}",
            )
        return totals

    raise HTTPException(400, f"Unknown split_type '{st}'")


def _check_members(ids: list[int], member_ids: set[int]) -> None:
    if not ids:
        raise HTTPException(400, "No participants given")
    if len(set(ids)) != len(ids):
        raise HTTPException(400, "Duplicate participants")
    outsiders = set(ids) - member_ids
    if outsiders:
        raise HTTPException(400, f"Users {sorted(outsiders)} are not members of this group")
