from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import get_current_user
from ..database import get_db
from ..services.history import UNDOABLE

router = APIRouter(prefix="/api/activity", tags=["activity"])


@router.get("", response_model=list[schemas.ActivityOut],
            summary="Everything that happened in this user's groups")
def my_activity(limit: int = Query(default=100, le=300),
                user: models.User = Depends(get_current_user),
                db: Session = Depends(get_db)):
    group_ids = [m.group_id for m in db.query(models.GroupMember).filter_by(user_id=user.id)]
    if not group_ids:
        return []

    rows = (
        db.query(models.Activity)
        .filter(models.Activity.group_id.in_(group_ids))
        .order_by(models.Activity.created_at.desc())
        .limit(limit)
        .all()
    )
    names = {
        g.id: g.name
        for g in db.query(models.Group).filter(models.Group.id.in_(group_ids)).all()
    }
    return [
        schemas.ActivityOut(
            id=a.id, type=a.type, description=a.description,
            user_name=a.user.name if a.user else None, created_at=a.created_at,
            can_undo=(a.type in UNDOABLE and not a.undone and bool(a.payload)),
            undone=a.undone, undo_of_id=a.undo_of_id,
            group_id=a.group_id, group_name=names.get(a.group_id),
        )
        for a in rows
    ]
