from datetime import date as Date, datetime as DateTime
from typing import Optional

from pydantic import BaseModel, EmailStr, Field


# ---------- auth ----------

class UserCreate(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=6)


class UserOut(BaseModel):
    id: int
    email: str
    name: str
    username: Optional[str] = None
    email_verified: bool = False
    avatar_url: Optional[str] = None
    theme: str = "system"

    model_config = {"from_attributes": True}


USERNAME_RE = r"^[a-z0-9_.]{3,30}$"


class ProfileUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    username: Optional[str] = Field(default=None, pattern=USERNAME_RE)
    theme: Optional[str] = Field(default=None, pattern=r"^(system|light|dark)$")


class UsernameCheck(BaseModel):
    available: bool
    reason: str = ""


class EmailChangeRequest(BaseModel):
    new_email: EmailStr


class EmailChangeConfirm(BaseModel):
    new_email: EmailStr
    code: str = Field(min_length=4, max_length=10)


class AuthConfig(BaseModel):
    """What sign-in methods this deployment has switched on."""
    google_client_id: Optional[str] = None
    google_enabled: bool = False
    email_otp_enabled: bool = True
    email_delivery: str = "smtp"  # smtp | dev (codes returned in the response)


class GoogleLogin(BaseModel):
    credential: str  # ID token from Google Identity Services


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class OTPRequest(BaseModel):
    email: EmailStr


class OTPRequestOut(BaseModel):
    sent: bool                      # True once the mail actually left over SMTP
    is_new_user: bool               # frontend asks for a name when True
    expires_in_minutes: int
    dev_code: Optional[str] = None  # only when SMTP is unconfigured (local dev)
    message: str = ""


class OTPVerify(BaseModel):
    email: EmailStr
    code: str = Field(min_length=4, max_length=10)
    name: Optional[str] = Field(default=None, max_length=80)  # required for new accounts


class VerifyEmailConfirm(BaseModel):
    code: str = Field(min_length=4, max_length=10)


class SimpleMessage(BaseModel):
    ok: bool = True
    message: str = ""


# ---------- groups ----------

class GroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class GroupOut(BaseModel):
    id: int
    name: str
    created_by: Optional[int]
    simplify_debts: bool = True
    members: list[UserOut] = []


class GroupUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    simplify_debts: Optional[bool] = None


class AddMember(BaseModel):
    email: Optional[EmailStr] = None
    username: Optional[str] = None
    user_id: Optional[int] = None


# ---------------------------------------------------------------- whiteboard

class NoteCreate(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


class NoteOut(BaseModel):
    id: int
    body: str
    user_id: int
    author_name: str
    created_at: DateTime
    updated_at: Optional[DateTime] = None


# ---------------------------------------------------------------- friends

class FriendOut(BaseModel):
    user: UserOut
    friendship_id: int
    since: Optional[DateTime] = None
    unread: int = 0


class FriendRequestOut(BaseModel):
    friendship_id: int
    user: UserOut          # the other party
    direction: str         # incoming | outgoing
    created_at: DateTime


class FriendInvite(BaseModel):
    username: Optional[str] = None
    email: Optional[EmailStr] = None
    code: Optional[str] = None  # payload from a scanned QR code


class MessageCreate(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


class MessageOut(BaseModel):
    id: int
    sender_id: int
    recipient_id: int
    body: str
    created_at: DateTime
    mine: bool = False


# ---------- expenses ----------

class SplitIn(BaseModel):
    user_id: int
    value: float  # meaning depends on split_type: exact=amount, percent=%, shares=weight


class ItemIn(BaseModel):
    name: str
    quantity: float = 1
    unit: str = ""
    total: float
    participant_ids: list[int]


class ExpenseCreate(BaseModel):
    description: str
    amount: float = Field(gt=0)
    currency: str = "EUR"
    date: Optional[Date] = None
    paid_by: int
    split_type: str = "equal"  # equal|exact|percent|shares|itemized
    notes: str = ""
    participant_ids: list[int] = []  # for equal
    splits: list[SplitIn] = []       # for exact/percent/shares
    items: list[ItemIn] = []         # for itemized


class SplitOut(BaseModel):
    user_id: int
    user_name: str
    amount: float


class ItemParticipantOut(BaseModel):
    user_id: int
    user_name: str


class ItemOut(BaseModel):
    id: int
    name: str
    quantity: float
    unit: str
    total: float
    participants: list[ItemParticipantOut]


class ExpenseOut(BaseModel):
    id: int
    group_id: int
    description: str
    amount: float
    currency: str
    date: Date
    paid_by: int
    payer_name: str
    split_type: str
    notes: str
    splits: list[SplitOut]
    items: list[ItemOut]
    created_at: DateTime


# ---------- settlements / balances ----------

class SettlementCreate(BaseModel):
    from_user: int
    to_user: int
    amount: float = Field(gt=0)
    date: Optional[Date] = None


class SettlementOut(BaseModel):
    id: int
    from_user: int
    from_name: str
    to_user: int
    to_name: str
    amount: float
    date: Date


class BalanceOut(BaseModel):
    user_id: int
    user_name: str
    balance: float  # positive = is owed money, negative = owes


class TransferOut(BaseModel):
    from_user: int
    from_name: str
    to_user: int
    to_name: str
    amount: float


# ---------- activity ----------

class ActivityOut(BaseModel):
    id: int
    type: str
    description: str
    user_name: Optional[str]
    created_at: DateTime
    can_undo: bool = False
    undone: bool = False
    undo_of_id: Optional[int] = None
    group_id: Optional[int] = None
    group_name: Optional[str] = None


# ---------- recurring ----------

class RecurringCreate(BaseModel):
    description: str
    amount: float = Field(gt=0)
    paid_by: int
    frequency: str = "monthly"  # weekly|monthly
    next_date: Date


class RecurringOut(BaseModel):
    id: int
    description: str
    amount: float
    paid_by: int
    payer_name: str
    frequency: str
    next_date: Date
    active: bool


# ---------- bill parsing ----------

class ParsedItem(BaseModel):
    name: str
    quantity: float = 1
    unit: str = ""
    total: float


class ParsedBill(BaseModel):
    store: str = ""
    date: Optional[str] = None
    total: Optional[float] = None
    items: list[ParsedItem] = []
    items_sum: float = 0
    valid: bool = False  # items_sum matches total within tolerance
    source: str = "local"  # local | groq
    warnings: list[str] = []
