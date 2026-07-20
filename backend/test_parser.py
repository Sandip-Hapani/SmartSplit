"""Run the local parser against every example bill and report validation."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from app.services.receipt_parser import extract_pdf_text, parse_receipt_text  # noqa: E402

BILLS = Path(__file__).resolve().parent.parent / "Example-Bills"

ok = True
for pdf in sorted(BILLS.glob("*.pdf")):
    text = extract_pdf_text(pdf.read_bytes())
    bill = parse_receipt_text(text)
    status = "OK " if bill.valid else "FAIL"
    if not bill.valid:
        ok = False
    print(f"[{status}] {pdf.name}")
    print(f"       store={bill.store!r} date={bill.date} total={bill.total} items_sum={bill.items_sum} n_items={len(bill.items)}")
    for w in bill.warnings:
        print(f"       warn: {w}")
    if not bill.valid:
        for it in bill.items:
            print(f"         {it.quantity:g}{it.unit or ''}  {it.name}  {it.total:.2f}")

sys.exit(0 if ok else 1)
