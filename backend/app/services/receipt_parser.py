"""Receipt parsing: local-first (PDF text + regex), Groq API fallback.

Tuned to German supermarket receipts (EDEKA Kassenbon style) but written so
other formats degrade gracefully to the Groq fallback.
"""
from __future__ import annotations

import base64
import io
import json
import os
import re

from groq import APIStatusError, BadRequestError, Groq

from ..schemas import ParsedBill, ParsedItem

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_TEXT_MODEL = os.environ.get("GROQ_TEXT_MODEL", "llama-3.3-70b-versatile")
# Groq retires models periodically; override via env when this one is sunset.
# Current vision-capable model (check https://console.groq.com/docs/models).
GROQ_VISION_MODEL = os.environ.get("GROQ_VISION_MODEL", "qwen/qwen3.6-27b")

TOLERANCE = 0.01

# ---------------------------------------------------------------- regexes

def _num(s: str) -> float:
    """German decimal comma -> float."""
    return float(s.replace(".", "").replace(",", "."))


TAX = r"(?:\*?\s*(?:AW|A|B))?"
# "DELVE.PENNE RIGATE 1,89 € x 2 3,78 A"  /  "PFAND 0,25 € x 2 0,50*B"
RE_QTY_ITEM = re.compile(
    rf"^(?P<name>.+?)\s+(?P<unit>\d+,\d{{2}})\s*€\s*x\s*(?P<qty>\d+)\s+(?P<total>-?\d+,\d{{2}})\s*{TAX}$"
)
# text-flow order: "2 € x 0,85 B.REI.ALPENJODSALZ 1,70 A"
RE_QTY_ITEM_FLOW = re.compile(
    rf"^(?P<qty>\d+)\s*[€�]\s*x\s*(?P<unit>\d+,\d{{2}})\s+(?P<name>.+?)\s+(?P<total>-?\d+,\d{{2}})\s*{TAX}$"
)
# "G&G BROKKOLI 1,49 A"
RE_SIMPLE_ITEM = re.compile(rf"^(?P<name>.+?)\s+(?P<total>-?\d+,\d{{2}})\s*{TAX}$")
# "1,628 kg x 1,49" (€/kg may trail or sit on its own line)
RE_WEIGHT = re.compile(r"^(?P<kg>\d+,\d{1,3})\s*kg\s*x\s*(?P<unit>\d+,\d{2})(?:\s*[€�]/kg)?$")
# text-flow order: "kg x 1,628 1,49"
RE_WEIGHT_FLOW = re.compile(r"^kg\s*x\s*(?P<kg>\d+,\d{1,3})\s+(?P<unit>\d+,\d{2})$")
# item-level coupon: "Coupon Heisse Tasse -0,17"
RE_COUPON_ITEM = re.compile(r"^(?:Coupon|Rabatt)\s+(?P<name>.+?)\s+(?P<amount>-\d+,\d{2})$")
# bill-level coupon (after subtotal): "Coupon Papa Joe's € 0,40" / flow: "Coupon Papa Joe's 0,40 €"
RE_COUPON_BILL = re.compile(
    r"^(?:Coupon|Rabatt)\s+(?P<name>.+?)\s+(?:[€�]\s*(?P<amount>\d+,\d{2})|(?P<amount2>\d+,\d{2})\s*[€�])$"
)
RE_SUBTOTAL = re.compile(r"^Summe\s+(?P<total>\d+,\d{2})$")
RE_TOTAL = re.compile(r"^SUMME\s*€?\s*(?P<total>\d+,\d{2})$")
RE_DATE = re.compile(r"\b(\d{2})\.(\d{2})\.(\d{2,4})\b")

STOP_WORDS = (
    "-K-U-N-D-E-N-B-E-L-E-G-", "KUNDENBELEG", "Terminal-ID", "Kartenzahlung",
)
SKIP_PREFIXES = (
    "Posten:", "Nummer:", "€/kg", "EUR", "Tel.", "----------",
)
PAYMENT_WORDS = ("Mastercard", "VISA", "Visa", "girocard", "EC-Karte", "BAR", "Bargeld")


def parse_receipt_text(text: str) -> ParsedBill:
    """Rule-based parser for German receipt text."""
    bill = ParsedBill(source="local")
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]

    if lines:
        bill.store = lines[0][:80]
    m = RE_DATE.search(text)
    if m:
        d, mo, y = m.groups()
        y = ("20" + y) if len(y) == 2 else y
        bill.date = f"{y}-{mo}-{d}"

    pending_weight: tuple[float, float] | None = None  # (kg, €/kg)
    seen_total = False

    for raw in lines:
        line = raw

        if any(w in line for w in STOP_WORDS):
            break
        if any(line.startswith(p) for p in SKIP_PREFIXES):
            continue
        if any(line.startswith(p) for p in PAYMENT_WORDS):
            if seen_total:
                break
            continue

        m = RE_TOTAL.match(line)
        if m:
            bill.total = _num(m.group("total"))
            seen_total = True
            continue

        m = RE_SUBTOTAL.match(line)
        if m:
            continue  # informational; the final SUMME is authoritative

        m = RE_COUPON_BILL.match(line)
        if m:
            # bill-wide coupon -> negative line item everyone shares by default
            bill.items.append(ParsedItem(
                name=f"Coupon {m.group('name')}", quantity=1, unit="",
                total=-_num(m.group("amount") or m.group("amount2")),
            ))
            continue

        m = RE_COUPON_ITEM.match(line)
        if m and bill.items:
            # discount belongs to the item right above it
            bill.items[-1].total = round(bill.items[-1].total + _num(m.group("amount")), 2)
            continue

        m = RE_WEIGHT.match(line) or RE_WEIGHT_FLOW.match(line)
        if m:
            pending_weight = (_num(m.group("kg")), _num(m.group("unit")))
            continue

        m = RE_QTY_ITEM.match(line) or RE_QTY_ITEM_FLOW.match(line)
        if m:
            bill.items.append(ParsedItem(
                name=m.group("name").strip(), quantity=float(m.group("qty")),
                unit="x", total=_num(m.group("total")),
            ))
            continue

        m = RE_SIMPLE_ITEM.match(line)
        if m:
            name = m.group("name").strip()
            item = ParsedItem(name=name, total=_num(m.group("total")))
            if pending_weight:
                item.quantity, item.unit = pending_weight[0], "kg"
                pending_weight = None
            bill.items.append(item)
            continue

    bill.items_sum = round(sum(i.total for i in bill.items), 2)
    if bill.total is not None:
        bill.valid = abs(bill.items_sum - bill.total) <= TOLERANCE
        if not bill.valid:
            bill.warnings.append(
                f"Parsed items sum to {bill.items_sum:.2f} but receipt total is {bill.total:.2f}"
            )
    else:
        bill.warnings.append("No total found on receipt")
    return bill


# ---------------------------------------------------------------- pdf / image

def extract_pdf_text(data: bytes) -> str:
    import pdfplumber

    chunks = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for page in pdf.pages:
            # use_text_flow keeps overlapping runs (name vs. price) intact
            # instead of interleaving their characters by x-position
            chunks.append(page.extract_text(use_text_flow=True) or "")
    return "\n".join(chunks)


def ocr_image_text(data: bytes) -> str | None:
    """Local OCR if tesseract is installed; None otherwise."""
    try:
        import pytesseract
        from PIL import Image

        img = Image.open(io.BytesIO(data))
        return pytesseract.image_to_string(img, lang="deu+eng")
    except Exception:
        return None


# ---------------------------------------------------------------- groq fallback

_GROQ_SCHEMA_HINT = """Return ONLY a JSON object, no prose, shaped exactly like:
{"store": "...", "date": "YYYY-MM-DD or null", "total": 12.34,
 "items": [{"name": "...", "quantity": 1, "unit": "", "total": 1.99}]}
Rules: item-level discount/coupon lines must be merged into the item directly above
them (reduce that item's total). Bill-level coupons become their own item with a
negative total. Deposits (Pfand) are their own items. Use dot decimals."""


def groq_error_text(exc: Exception) -> str:
    """Turn an SDK exception into something a user can act on."""
    if isinstance(exc, APIStatusError):
        if exc.status_code in (413, 429):
            return ("Groq rate limit reached (the free tier allows a limited number of "
                    "tokens per minute). Wait a minute and try again.")
        if exc.status_code == 404:
            return (f"Groq model '{GROQ_VISION_MODEL}' is not available on this account — "
                    "it was probably retired. Set GROQ_VISION_MODEL to a current one "
                    "from https://console.groq.com/docs/models.")
        if exc.status_code == 401:
            return "Groq rejected the API key. Check GROQ_API_KEY."
    return f"{type(exc).__name__}: {exc}"


_client: Groq | None = None


def _groq() -> Groq:
    global _client
    if _client is None:
        _client = Groq(api_key=GROQ_API_KEY, timeout=90.0, max_retries=2)
    return _client


def _groq_chat(model: str, messages: list[dict]) -> str:
    kwargs = dict(
        model=model,
        messages=messages,
        temperature=0,
        response_format={"type": "json_object"},
    )
    try:
        # Thinking models otherwise spend the whole budget reasoning and return
        # an empty JSON shell. Non-reasoning models reject the parameter, hence
        # the retry below.
        completion = _groq().chat.completions.create(reasoning_effort="none", **kwargs)
    except BadRequestError as exc:
        if "reasoning_effort" not in str(exc):
            raise
        completion = _groq().chat.completions.create(**kwargs)
    return completion.choices[0].message.content or ""


def _bill_from_groq_json(payload: str) -> ParsedBill:
    data = json.loads(payload)
    items = [
        ParsedItem(
            name=str(it.get("name", "?"))[:120],
            quantity=float(it.get("quantity") or 1),
            unit=str(it.get("unit") or ""),
            total=float(it.get("total") or 0),
        )
        for it in data.get("items", [])
    ]
    bill = ParsedBill(
        store=str(data.get("store") or ""), date=data.get("date"),
        total=data.get("total"), items=items, source="groq",
    )
    bill.items_sum = round(sum(i.total for i in items), 2)
    if bill.total is not None:
        bill.valid = abs(bill.items_sum - float(bill.total)) <= TOLERANCE
    return bill


def groq_parse_text(text: str) -> ParsedBill:
    content = _groq_chat(GROQ_TEXT_MODEL, [
        {"role": "user",
         "content": f"Parse this receipt.\n{_GROQ_SCHEMA_HINT}\n\nRECEIPT TEXT:\n{text}"},
    ])
    return _bill_from_groq_json(content)


MAX_IMAGE_EDGE = 2400  # legible for small receipt print, small enough for one page
# Each image costs tokens, and a big request can exceed the account's per-minute
# token allowance. Retry progressively smaller before giving up.
IMAGE_EDGE_LADDER = (2400, 1500, 1000)
# Receipts are short; rendering every page of a long scan mostly burns tokens.
MAX_VISION_PAGES = int(os.environ.get("GROQ_MAX_VISION_PAGES", "2"))


def _normalize_image(data: bytes, max_edge: int = MAX_IMAGE_EDGE) -> bytes:
    """Re-encode to plain RGB JPEG.

    Vision models are unreliable on palette-mode PNGs — they either read nothing
    or hallucinate a different receipt entirely — and phone photos carry EXIF
    rotation that has to be baked in before the model sees them.
    """
    from PIL import Image, ImageOps

    im = Image.open(io.BytesIO(data))
    im = ImageOps.exif_transpose(im)
    im = im.convert("RGB")

    longest = max(im.size)
    if longest > max_edge:
        scale = max_edge / longest
        im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))),
                       Image.LANCZOS)

    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=92)
    return buf.getvalue()


def _pdf_page_pngs(data: bytes, max_pages: int = MAX_VISION_PAGES) -> list[bytes]:
    """Render PDF pages — vision models can't read a PDF directly."""
    import pdfplumber

    pages: list[bytes] = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for page in pdf.pages[:max_pages]:
            raw = io.BytesIO()
            page.to_image(resolution=150).save(raw, format="PNG")
            pages.append(raw.getvalue())
    return pages


def groq_parse_image(data: bytes, mime: str) -> ParsedBill:
    # A PDF has to become pixels first; everything else is already an image.
    sources = _pdf_page_pngs(data) if "pdf" in mime.lower() else [data]
    if not sources:
        raise ValueError("Nothing to send to the vision model.")

    last_error: Exception | None = None
    for max_edge in IMAGE_EDGE_LADDER:
        parts: list[dict] = [
            {"type": "text", "text": f"Parse this receipt image.\n{_GROQ_SCHEMA_HINT}"}
        ]
        for src in sources:
            b64 = base64.b64encode(_normalize_image(src, max_edge)).decode()
            parts.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
            })
        try:
            content = _groq_chat(GROQ_VISION_MODEL, [{"role": "user", "content": parts}])
            return _bill_from_groq_json(content)
        except APIStatusError as exc:
            if exc.status_code != 413:  # only payload-size failures are worth shrinking for
                raise
            last_error = exc

    raise last_error or RuntimeError("Vision request too large even at the smallest size.")


# ---------------------------------------------------------------- entry point

def parse_bill(data: bytes, filename: str, content_type: str = "") -> ParsedBill:
    """Local-first parse with Groq fallback. Never raises for parse issues —
    returns a ParsedBill with warnings instead."""
    name = filename.lower()
    is_pdf = name.endswith(".pdf") or content_type == "application/pdf"

    if is_pdf:
        text = extract_pdf_text(data)
        if text.strip():
            bill = parse_receipt_text(text)
            if bill.valid or not GROQ_API_KEY:
                if not bill.valid and not GROQ_API_KEY:
                    bill.warnings.append(
                        "Local parse did not validate and no GROQ_API_KEY is set — "
                        "review items manually."
                    )
                return bill
            # local parse failed validation -> let Groq try the same text
            try:
                groq_bill = groq_parse_text(text)
                return groq_bill if groq_bill.valid else _better_of(bill, groq_bill)
            except Exception as e:
                bill.warnings.append(f"Groq fallback failed — {groq_error_text(e)}")
                return bill
        # scanned PDF with no text layer -> treat as image via Groq
        if GROQ_API_KEY:
            try:
                return groq_parse_image(data, "application/pdf")
            except Exception as e:
                return ParsedBill(warnings=[f"Scanned PDF could not be read — {groq_error_text(e)}"])
        return ParsedBill(warnings=["Scanned PDF with no text layer; set GROQ_API_KEY to parse it."])

    # ---- image path ----
    text = ocr_image_text(data)
    if text and text.strip():
        bill = parse_receipt_text(text)
        bill.source = "local-ocr"
        if bill.valid:
            return bill
        if GROQ_API_KEY:
            try:
                groq_bill = groq_parse_image(data, content_type or "image/jpeg")
                return groq_bill if groq_bill.valid else _better_of(bill, groq_bill)
            except Exception as e:
                bill.warnings.append(f"Groq fallback failed — {groq_error_text(e)}")
        return bill
    if GROQ_API_KEY:
        try:
            return groq_parse_image(data, content_type or "image/jpeg")
        except Exception as e:
            return ParsedBill(warnings=[f"Image parse failed — {groq_error_text(e)}"])
    return ParsedBill(warnings=[
        "No local OCR available (install tesseract) and no GROQ_API_KEY set."
    ])


def _better_of(a: ParsedBill, b: ParsedBill) -> ParsedBill:
    """Neither validated — prefer the one closer to its own stated total."""
    def err(x: ParsedBill) -> float:
        if x.total is None:
            return float("inf")
        return abs(x.items_sum - x.total)
    best = a if err(a) <= err(b) else b
    best.warnings.append("Neither local nor Groq parse matched the receipt total exactly — please review.")
    return best
