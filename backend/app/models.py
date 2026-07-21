from datetime import datetime, date

from sqlalchemy import (
    Column, Integer, String, Float, Boolean, Date, DateTime, ForeignKey, Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from .database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    email = Column(String, unique=True, index=True, nullable=False)
    username = Column(String, unique=True, index=True)  # handle others use to add you
    name = Column(String, nullable=False)
    hashed_password = Column(String)  # null for accounts that only ever use email OTP / Google
    email_verified = Column(Boolean, default=False, nullable=False)
    google_sub = Column(String, unique=True, index=True)  # stable Google account id
    avatar_url = Column(String)
    theme = Column(String, default="system", nullable=False)  # system|light|dark
    created_at = Column(DateTime, default=datetime.utcnow)

    memberships = relationship("GroupMember", back_populates="user")


class EmailOTP(Base):
    """One-time code emailed to a user for passwordless login or email verification."""

    __tablename__ = "email_otps"

    id = Column(Integer, primary_key=True)
    email = Column(String, index=True, nullable=False)
    code_hash = Column(String, nullable=False)
    purpose = Column(String, default="login", nullable=False)  # login|verify
    expires_at = Column(DateTime, nullable=False)
    attempts = Column(Integer, default=0, nullable=False)
    consumed_at = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)


class Group(Base):
    __tablename__ = "groups"

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    simplify_debts = Column(Boolean, default=True, nullable=False)
    default_currency = Column(String(3), default="EUR", nullable=False)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)

    members = relationship("GroupMember", back_populates="group", cascade="all, delete-orphan")
    expenses = relationship("Expense", back_populates="group", cascade="all, delete-orphan")
    notes = relationship("GroupNote", back_populates="group", cascade="all, delete-orphan")


class GroupNote(Base):
    """A line on the group's shared whiteboard."""

    __tablename__ = "group_notes"

    id = Column(Integer, primary_key=True)
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    body = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime)  # stays null until the note is actually edited

    group = relationship("Group", back_populates="notes")
    author = relationship("User")


class Friendship(Base):
    """Requested by `requester_id`, confirmed by `addressee_id`."""

    __tablename__ = "friendships"
    __table_args__ = (UniqueConstraint("requester_id", "addressee_id"),)

    id = Column(Integer, primary_key=True)
    requester_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    addressee_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    status = Column(String, default="pending", nullable=False)  # pending|accepted
    created_at = Column(DateTime, default=datetime.utcnow)
    responded_at = Column(DateTime)

    requester = relationship("User", foreign_keys=[requester_id])
    addressee = relationship("User", foreign_keys=[addressee_id])


class Message(Base):
    """Direct message between two friends. Text only — no attachments."""

    __tablename__ = "messages"

    id = Column(Integer, primary_key=True)
    sender_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    recipient_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    body = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    read_at = Column(DateTime)

    sender = relationship("User", foreign_keys=[sender_id])
    recipient = relationship("User", foreign_keys=[recipient_id])


class GroupMember(Base):
    __tablename__ = "group_members"
    __table_args__ = (UniqueConstraint("group_id", "user_id"),)

    id = Column(Integer, primary_key=True)
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    joined_at = Column(DateTime, default=datetime.utcnow)

    group = relationship("Group", back_populates="members")
    user = relationship("User", back_populates="memberships")


class Expense(Base):
    __tablename__ = "expenses"

    id = Column(Integer, primary_key=True)
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=False)
    description = Column(String, nullable=False)
    amount = Column(Float, nullable=False)
    currency = Column(String, default="EUR")
    date = Column(Date, default=date.today)
    paid_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    split_type = Column(String, default="equal")  # equal|exact|percent|shares|itemized
    notes = Column(Text, default="")
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)

    group = relationship("Group", back_populates="expenses")
    payer = relationship("User", foreign_keys=[paid_by])
    splits = relationship("ExpenseSplit", back_populates="expense", cascade="all, delete-orphan")
    items = relationship("ExpenseItem", back_populates="expense", cascade="all, delete-orphan")


class ExpenseSplit(Base):
    __tablename__ = "expense_splits"
    __table_args__ = (UniqueConstraint("expense_id", "user_id"),)

    id = Column(Integer, primary_key=True)
    expense_id = Column(Integer, ForeignKey("expenses.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    amount = Column(Float, nullable=False)  # share of the expense this user owes

    expense = relationship("Expense", back_populates="splits")
    user = relationship("User")


class ExpenseItem(Base):
    __tablename__ = "expense_items"

    id = Column(Integer, primary_key=True)
    expense_id = Column(Integer, ForeignKey("expenses.id"), nullable=False)
    name = Column(String, nullable=False)
    quantity = Column(Float, default=1)
    unit = Column(String, default="")  # "", "kg", "x"
    total = Column(Float, nullable=False)  # line total after item-level coupons

    expense = relationship("Expense", back_populates="items")
    participants = relationship(
        "ExpenseItemParticipant", back_populates="item", cascade="all, delete-orphan"
    )


class ExpenseItemParticipant(Base):
    __tablename__ = "expense_item_participants"
    __table_args__ = (UniqueConstraint("item_id", "user_id"),)

    id = Column(Integer, primary_key=True)
    item_id = Column(Integer, ForeignKey("expense_items.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    item = relationship("ExpenseItem", back_populates="participants")
    user = relationship("User")


class Settlement(Base):
    __tablename__ = "settlements"

    id = Column(Integer, primary_key=True)
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=False)
    from_user = Column(Integer, ForeignKey("users.id"), nullable=False)
    to_user = Column(Integer, ForeignKey("users.id"), nullable=False)
    amount = Column(Float, nullable=False)
    currency = Column(String(3), default="EUR", nullable=False)
    date = Column(Date, default=date.today)
    created_at = Column(DateTime, default=datetime.utcnow)

    payer = relationship("User", foreign_keys=[from_user])
    payee = relationship("User", foreign_keys=[to_user])


class Activity(Base):
    """Append-only log. Undoing never rewrites history — it appends a new entry
    that reverses the effect, the way a revert commit does."""

    __tablename__ = "activities"

    id = Column(Integer, primary_key=True)
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"))
    type = Column(String, nullable=False)  # expense_added|expense_edited|expense_deleted|settlement|member_added|group_created|recurring_added|undo
    description = Column(String, nullable=False)
    payload = Column(Text)          # JSON snapshot needed to reverse this entry
    undone = Column(Boolean, default=False, nullable=False)
    undo_of_id = Column(Integer, ForeignKey("activities.id"))  # set on the reversing entry
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User")


class RecurringExpense(Base):
    __tablename__ = "recurring_expenses"

    id = Column(Integer, primary_key=True)
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=False)
    description = Column(String, nullable=False)
    amount = Column(Float, nullable=False)
    currency = Column(String(3), default="EUR", nullable=False)
    paid_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    frequency = Column(String, default="monthly")  # weekly|monthly
    next_date = Column(Date, nullable=False)
    active = Column(Boolean, default=True)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)

    payer = relationship("User", foreign_keys=[paid_by])


class ExchangeRate(Base):
    """Cached FX rates.

    `group_id` is null for rates fetched from the reference feed, and set when a
    group pins its own rate — the pinned one always wins for that group.
    """

    __tablename__ = "exchange_rates"
    __table_args__ = (UniqueConstraint("group_id", "base", "quote"),)

    id = Column(Integer, primary_key=True)
    group_id = Column(Integer, ForeignKey("groups.id"))
    base = Column(String(3), nullable=False, index=True)
    quote = Column(String(3), nullable=False, index=True)
    rate = Column(Float, nullable=False)          # 1 base = <rate> quote
    as_of = Column(Date, default=date.today)
    source = Column(String, default="live")       # live | manual
    updated_at = Column(DateTime, default=datetime.utcnow)
