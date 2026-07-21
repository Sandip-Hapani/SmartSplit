"""Email delivery for one-time codes.

Configured for any SMTP provider; Gmail needs an App Password (Google Account →
Security → 2-Step Verification → App passwords), not the normal account password.

If SMTP is not configured the app runs in "dev delivery" mode: codes are logged
to the container output and returned by the API so local testing works without
a mail account. Setting SMTP_HOST + SMTP_USER + SMTP_PASSWORD switches to real
sending and stops codes from being exposed.
"""

import logging
import os
import smtplib
import ssl
from email.message import EmailMessage

log = logging.getLogger("smartsplit.mail")

SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_FROM = os.environ.get("SMTP_FROM", "") or SMTP_USER
SMTP_FROM_NAME = os.environ.get("SMTP_FROM_NAME", "SmartSplit")
SMTP_SSL = os.environ.get("SMTP_SSL", "").lower() in ("1", "true", "yes")

OTP_TTL_MINUTES = int(os.environ.get("OTP_TTL_MINUTES", "10"))

# Returning the code in the API response is a local-development convenience and
# a complete authentication bypass on a public instance — anyone could request a
# code for any address and read it straight back. So it is opt-in, never a
# silent fallback when SMTP happens to be unset.
ALLOW_DEV_CODES = os.environ.get("SMARTSPLIT_ALLOW_DEV_CODES", "").lower() in ("1", "true", "yes")


def email_login_available() -> bool:
    """True when a code can actually reach the user — real mail, or dev codes
    deliberately switched on for local work."""
    return is_configured() or ALLOW_DEV_CODES


def is_configured() -> bool:
    return bool(SMTP_HOST and SMTP_USER and SMTP_PASSWORD)


def _send(to: str, subject: str, text: str, html: str) -> None:
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = f"{SMTP_FROM_NAME} <{SMTP_FROM}>"
    msg["To"] = to
    msg.set_content(text)
    msg.add_alternative(html, subtype="html")

    context = ssl.create_default_context()
    if SMTP_SSL:
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=context, timeout=20) as s:
            s.login(SMTP_USER, SMTP_PASSWORD)
            s.send_message(msg)
    else:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as s:
            s.starttls(context=context)
            s.login(SMTP_USER, SMTP_PASSWORD)
            s.send_message(msg)


def _template(code: str, purpose: str) -> tuple[str, str, str]:
    if purpose == "verify":
        subject = f"{code} is your SmartSplit verification code"
        lead = "Confirm your email address with this code:"
    else:
        subject = f"{code} is your SmartSplit sign-in code"
        lead = "Use this code to sign in to SmartSplit:"

    text = (
        f"{lead}\n\n    {code}\n\n"
        f"It expires in {OTP_TTL_MINUTES} minutes. "
        "If you didn't request this, you can ignore this email."
    )
    html = f"""\
<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
            max-width:420px;margin:0 auto;padding:24px;color:#111">
  <h2 style="margin:0 0 4px;font-size:20px">SmartSplit</h2>
  <p style="margin:0 0 20px;color:#555">{lead}</p>
  <div style="font-size:34px;font-weight:700;letter-spacing:10px;
              background:#f4f5f7;border-radius:10px;padding:16px;text-align:center">
    {code}
  </div>
  <p style="margin:20px 0 0;color:#555;font-size:14px">
    This code expires in {OTP_TTL_MINUTES} minutes.
  </p>
  <p style="margin:8px 0 0;color:#888;font-size:13px">
    If you didn't request this, you can safely ignore this email.
  </p>
</div>"""
    return subject, text, html


def send_otp(to: str, code: str, purpose: str = "login") -> bool:
    """Email a one-time code. Returns True if it actually went out over SMTP."""
    subject, text, html = _template(code, purpose)

    if not is_configured():
        log.warning("SMTP not configured - OTP for %s is %s (dev delivery)", to, code)
        return False

    try:
        _send(to, subject, text, html)
        log.info("Sent %s OTP to %s", purpose, to)
        return True
    except Exception as exc:
        # Surface the failure to the caller rather than silently swallowing it.
        log.error("Failed to send OTP to %s: %s", to, exc)
        raise
