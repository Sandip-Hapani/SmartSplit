from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import get_current_user, require_membership
from ..database import get_db
from ..services.receipt_parser import parse_bill

router = APIRouter(prefix="/api/groups/{group_id}/bills", tags=["bills"])

MAX_SIZE = 15 * 1024 * 1024  # 15 MB


@router.post("/parse", response_model=schemas.ParsedBill)
async def parse_uploaded_bill(group_id: int, file: UploadFile = File(...),
                              user: models.User = Depends(get_current_user),
                              db: Session = Depends(get_db)):
    """Parse an uploaded bill (PDF or image) into line items. Returns a draft —
    nothing is saved until the user confirms the itemized expense."""
    require_membership(db, group_id, user)
    data = await file.read()
    if len(data) > MAX_SIZE:
        return schemas.ParsedBill(warnings=["File too large (max 15 MB)"])
    return parse_bill(data, file.filename or "upload", file.content_type or "")
