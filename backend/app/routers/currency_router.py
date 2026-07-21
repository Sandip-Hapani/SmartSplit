from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import get_current_user, require_membership
from ..database import get_db
from ..services import currency as fx

router = APIRouter(tags=["currencies"])


@router.get("/api/currencies", response_model=schemas.CurrencyList,
            summary="Currencies this deployment supports")
def list_currencies(db: Session = Depends(get_db)):
    return schemas.CurrencyList(
        currencies=[
            schemas.CurrencyOut(code=code, symbol=sym, name=name, decimals=fx.decimals(code))
            for code, (sym, name) in sorted(fx.CURRENCIES.items())
        ],
        rates_as_of=fx.rates_as_of(db),
    )


@router.post("/api/currencies/refresh", summary="Force a rate refresh")
def refresh(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    stored = fx.refresh_rates(db, force=True)
    if not stored:
        raise HTTPException(502, "Could not reach any exchange-rate source. "
                                 "Cached rates are still in use.")
    return {"updated": stored, "as_of": fx.rates_as_of(db)}


@router.get("/api/groups/{group_id}/rates", response_model=list[schemas.RateOut],
            summary="Rates this group would use, against its own currency")
def group_rates(group_id: int, user: models.User = Depends(get_current_user),
                db: Session = Depends(get_db)):
    group = require_membership(db, group_id, user)
    base = fx.normalize(group.default_currency)

    # only the currencies this group actually uses are interesting
    used = {
        fx.normalize(e.currency)
        for e in db.query(models.Expense).filter_by(group_id=group_id).all()
    } | {
        fx.normalize(s.currency)
        for s in db.query(models.Settlement).filter_by(group_id=group_id).all()
    } | {base}

    pinned = {
        (r.base, r.quote): r
        for r in db.query(models.ExchangeRate).filter_by(group_id=group_id).all()
    }
    out = []
    for code in sorted(used - {base}):
        rate = fx.get_rate(db, code, base, group_id)
        if rate is None:
            continue
        pin = pinned.get((code, base))
        out.append(schemas.RateOut(
            base=code, quote=base, rate=round(rate, 6),
            source="manual" if pin else "live",
            as_of=pin.as_of if pin else fx.rates_as_of(db),
        ))
    return out


@router.put("/api/groups/{group_id}/rates", response_model=schemas.RateOut,
            summary="Pin a rate for this group, overriding the live one")
def pin_rate(group_id: int, payload: schemas.RatePin,
             user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_membership(db, group_id, user)
    base, quote = fx.normalize(payload.base, ""), fx.normalize(payload.quote, "")
    if not base or not quote:
        raise HTTPException(400, "Unsupported currency")
    if base == quote:
        raise HTTPException(400, "Pick two different currencies")

    row = (
        db.query(models.ExchangeRate)
        .filter_by(group_id=group_id, base=base, quote=quote)
        .first()
    )
    if row is None:
        row = models.ExchangeRate(group_id=group_id, base=base, quote=quote, source="manual")
        db.add(row)
    row.rate = payload.rate
    row.source = "manual"
    db.commit()
    db.refresh(row)
    return schemas.RateOut(base=row.base, quote=row.quote, rate=row.rate,
                           source="manual", as_of=row.as_of)


@router.delete("/api/groups/{group_id}/rates/{base}/{quote}",
               summary="Drop a pinned rate and fall back to live")
def unpin_rate(group_id: int, base: str, quote: str,
               user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_membership(db, group_id, user)
    row = (
        db.query(models.ExchangeRate)
        .filter_by(group_id=group_id, base=fx.normalize(base), quote=fx.normalize(quote))
        .first()
    )
    if row is None:
        raise HTTPException(404, "No pinned rate for that pair")
    db.delete(row)
    db.commit()
    return {"ok": True}
