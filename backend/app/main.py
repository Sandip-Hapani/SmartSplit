import time

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.exc import OperationalError

from . import migrate
from .database import Base, engine
from .routers import (
    account_router, activity_router, auth_router, bills_router, expenses_router,
    friends_router, groups_router, recurring_router,
)

# The database container may still be starting when the API boots.
for attempt in range(30):
    try:
        Base.metadata.create_all(bind=engine)
        break
    except OperationalError:
        if attempt == 29:
            raise
        time.sleep(1)

migrate.run(engine)

tags_metadata = [
    {"name": "auth", "description": "Register, log in, and inspect the current user. "
     "Two ways in: email + password, or passwordless — `POST /api/auth/otp/request` "
     "emails a 6-digit code, `POST /api/auth/otp/verify` exchanges it for a token and "
     "creates the account if the email is new. Both return a JWT bearer token — click "
     "**Authorize** and use email as username."},
    {"name": "groups", "description": "Groups, members, balances, debt simplification, "
     "settlements, and the activity feed."},
    {"name": "expenses", "description": "Expense CRUD. Split types: `equal`, `exact`, "
     "`percent`, `shares`, `itemized` (per-product participant lists)."},
    {"name": "bills", "description": "Upload a bill (PDF or photo) and get parsed line "
     "items back as a draft — nothing is saved until the itemized expense is created."},
    {"name": "recurring", "description": "Weekly/monthly recurring expenses, split "
     "equally among all members and materialized automatically when due."},
    {"name": "friends", "description": "Friend requests (by username, email, or scanned "
     "invite code), unfriending, and text-only direct messages between friends."},
    {"name": "activity", "description": "The signed-in user's feed across every group "
     "they belong to."},
    {"name": "account", "description": "Profile settings: display name, unique username, "
     "theme, and changing the email address with a code sent to the new address."},
]

app = FastAPI(
    title="SmartSplit API",
    version="0.1.0",
    description=(
        "Splitwise-style expense sharing with bill parsing.\n\n"
        "**Auth:** all endpoints except `/api/auth/*` require a Bearer token. "
        "Use the **Authorize** button (username = email) or POST `/api/auth/login`.\n\n"
        "**Bill flow:** `POST /api/groups/{id}/bills/parse` → review/adjust items → "
        "`POST /api/groups/{id}/expenses` with `split_type: \"itemized\"`."
    ),
    openapi_tags=tags_metadata,
    # under /api so the nginx container proxies them alongside the API
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    contact={"name": "SmartSplit"},
    license_info={"name": "MIT"},
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router)
app.include_router(account_router.router)
app.include_router(groups_router.router)
app.include_router(expenses_router.router)
app.include_router(bills_router.router)
app.include_router(recurring_router.router)
app.include_router(friends_router.router)
app.include_router(activity_router.router)


@app.get("/api/health", tags=["health"])
def health():
    return {"ok": True}
