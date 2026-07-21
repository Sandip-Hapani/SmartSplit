"""Currencies and exchange rates.

Balances are kept **per currency** — a €20 debt and a $15 debt are two separate
things and are settled separately. No rate is ever baked into what someone owes,
so nobody gains or loses when rates move. Conversion exists only for *display*:
totals, charts, and the optional "show everything in X" view.

Rates come from the ECB reference feed (Frankfurter, no API key) and are cached
in the database, with a second free provider as backup for currencies the ECB
doesn't publish. A group can pin its own rate, which then wins for that group.
"""

from __future__ import annotations

import json
import logging
import urllib.request
from datetime import date, datetime

from sqlalchemy.orm import Session

from .. import models

log = logging.getLogger("smartsplit.currency")

PIVOT = "EUR"  # every cached live rate is stored as 1 EUR = <rate> QUOTE
_UA = {"User-Agent": "SmartSplit/0.1 (self-hosted expense sharing)"}
_SOURCES = [
    "https://api.frankfurter.dev/v1/latest?base=EUR",
    "https://open.er-api.com/v6/latest/EUR",
]

# code -> (symbol, name). Symbol is what the UI puts in front of an amount.
CURRENCIES: dict[str, tuple[str, str]] = {
    "EUR": ("€", "Euro"),
    "USD": ("$", "US Dollar"),
    "GBP": ("£", "British Pound"),
    "INR": ("₹", "Indian Rupee"),
    "CHF": ("CHF", "Swiss Franc"),
    "JPY": ("¥", "Japanese Yen"),
    "AUD": ("A$", "Australian Dollar"),
    "CAD": ("C$", "Canadian Dollar"),
    "SEK": ("kr", "Swedish Krona"),
    "NOK": ("kr", "Norwegian Krone"),
    "DKK": ("kr", "Danish Krone"),
    "PLN": ("zł", "Polish Zloty"),
    "CZK": ("Kč", "Czech Koruna"),
    "HUF": ("Ft", "Hungarian Forint"),
    "TRY": ("₺", "Turkish Lira"),
    "SGD": ("S$", "Singapore Dollar"),
    "HKD": ("HK$", "Hong Kong Dollar"),
    "NZD": ("NZ$", "New Zealand Dollar"),
    "ZAR": ("R", "South African Rand"),
    "BRL": ("R$", "Brazilian Real"),
    "MXN": ("MX$", "Mexican Peso"),
    "CNY": ("¥", "Chinese Yuan"),
    "KRW": ("₩", "South Korean Won"),
    "THB": ("฿", "Thai Baht"),
    "IDR": ("Rp", "Indonesian Rupiah"),
    "MYR": ("RM", "Malaysian Ringgit"),
    "PHP": ("₱", "Philippine Peso"),
    "ILS": ("₪", "Israeli Shekel"),
    "AED": ("AED", "UAE Dirham"),
}

# Currencies that conventionally have no minor unit.
ZERO_DECIMAL = {"JPY", "KRW", "IDR", "HUF"}


def is_supported(code: str) -> bool:
    return (code or "").upper() in CURRENCIES


def normalize(code: str | None, fallback: str = "EUR") -> str:
    code = (code or "").upper()
    return code if code in CURRENCIES else fallback


def decimals(code: str) -> int:
    return 0 if normalize(code) in ZERO_DECIMAL else 2


def quantize(amount: float, code: str) -> float:
    return round(amount, decimals(code))


# ---------------------------------------------------------------- fetching

def _fetch() -> tuple[dict[str, float], date] | None:
    for url in _SOURCES:
        try:
            req = urllib.request.Request(url, headers=_UA)
            with urllib.request.urlopen(req, timeout=20) as r:
                data = json.loads(r.read())
            rates = {k.upper(): float(v) for k, v in (data.get("rates") or {}).items()}
            if not rates:
                continue
            raw = data.get("date") or ""
            try:
                as_of = date.fromisoformat(raw)
            except ValueError:
                as_of = date.today()
            log.info("Fetched %s rates from %s (%s)", len(rates), url, as_of)
            return rates, as_of
        except Exception as exc:
            log.warning("Rate source %s failed: %s", url, exc)
    return None


def refresh_rates(db: Session, force: bool = False) -> int:
    """Pull today's reference rates into the cache. Returns how many were stored."""
    if not force:
        newest = (
            db.query(models.ExchangeRate)
            .filter(models.ExchangeRate.group_id.is_(None))
            .order_by(models.ExchangeRate.as_of.desc())
            .first()
        )
        if newest and newest.as_of >= date.today():
            return 0

    fetched = _fetch()
    if not fetched:
        return 0
    rates, as_of = fetched

    existing = {
        r.quote: r
        for r in db.query(models.ExchangeRate).filter(
            models.ExchangeRate.group_id.is_(None), models.ExchangeRate.base == PIVOT
        )
    }
    stored = 0
    for code, value in rates.items():
        if code not in CURRENCIES:
            continue
        row = existing.get(code)
        if row is None:
            db.add(models.ExchangeRate(base=PIVOT, quote=code, rate=value,
                                       as_of=as_of, source="live"))
        else:
            row.rate, row.as_of, row.source = value, as_of, "live"
            row.updated_at = datetime.utcnow()
        stored += 1
    db.commit()
    return stored


# ---------------------------------------------------------------- lookup

def _live_pivot(db: Session, code: str) -> float | None:
    """1 EUR = ? <code>"""
    if code == PIVOT:
        return 1.0
    row = (
        db.query(models.ExchangeRate)
        .filter(models.ExchangeRate.group_id.is_(None),
                models.ExchangeRate.base == PIVOT,
                models.ExchangeRate.quote == code)
        .first()
    )
    return row.rate if row else None


def get_rate(db: Session, frm: str, to: str, group_id: int | None = None) -> float | None:
    """1 `frm` = ? `to`. None when it can't be determined."""
    frm, to = normalize(frm), normalize(to)
    if frm == to:
        return 1.0

    if group_id is not None:
        pinned = (
            db.query(models.ExchangeRate)
            .filter(models.ExchangeRate.group_id == group_id)
            .filter(((models.ExchangeRate.base == frm) & (models.ExchangeRate.quote == to)) |
                    ((models.ExchangeRate.base == to) & (models.ExchangeRate.quote == frm)))
            .first()
        )
        if pinned:
            return pinned.rate if pinned.base == frm else (1.0 / pinned.rate if pinned.rate else None)

    a, b = _live_pivot(db, frm), _live_pivot(db, to)
    if a and b:
        return b / a
    return None


def convert(db: Session, amount: float, frm: str, to: str,
            group_id: int | None = None) -> float | None:
    rate = get_rate(db, frm, to, group_id)
    return None if rate is None else quantize(amount * rate, to)


def rates_as_of(db: Session) -> date | None:
    row = (
        db.query(models.ExchangeRate)
        .filter(models.ExchangeRate.group_id.is_(None))
        .order_by(models.ExchangeRate.as_of.desc())
        .first()
    )
    return row.as_of if row else None
