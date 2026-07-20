# SmartSplit

Splitwise-style expense sharing webapp with one extra trick: **upload a bill
(PDF or photo) and it parses every line item**, then shows a matrix where you
tick/untick which person shares which product. Each item's cost is split only
among the people ticked for it.

## Features

- Multi-user accounts, JWT sessions, with **Log in / Sign up** tabs offering
  three ways in — pick any, they all land on the same account:
  - **Google**: one button; first use creates the account, later use logs in
  - **Email code**: enter your address, get a 6-digit code, no password to remember
  - **Email + password**: classic signup (name, email, password) and login
  - **Email verification**: receiving the code proves ownership, so OTP accounts
    are verified on first login; password accounts get a banner to verify on demand
Four sections once you're signed in: **Groups**, **Friends**, **Activity**, **Account**.

### Groups
- Every group you belong to, with members, balances, and settle-up
- **Simplify debts is per-group and optional.** On, balances net down to the
  fewest payments across everyone. Off, each debt stays with the person who
  actually paid — more transfers, but every one traces to a real expense
- **Whiteboard**: shared notes for the group (packing lists, house rules, the
  WiFi password). Anyone can post; only the author can edit or delete their own
- **Activity with undo**, append-only like git. Undoing a deleted expense
  restores it and records *that* as a new entry — the original stays in the log
  marked "undone", so history is never rewritten. Works for added, edited, and
  deleted expenses, settlements, and added members
- Expenses with split types: equal, exact amounts, percentages, shares, and **itemized**

### Friends
- Friend requests by username, email, or by scanning their QR code
- Accept, decline, cancel, and unfriend
- **Text-only direct messages** between friends, with unread counts

### Activity
- One feed of everything happening across all your groups, with the same undo

### Account
- Display name and a **unique username**, checked for availability as you type
- **Appearance**: system, light, or dark theme, saved to your account
- **Your friend code** as a QR image others can scan to add you
- Change your email — a code goes to the *new* address to prove you own it
- Bill upload → line-item parsing → per-product person assignment
  - Local-first parsing: PDF text extraction (pdfplumber) + rules tuned for
    German receipts (EDEKA Kassenbon: weight items, `€ x N` quantity items,
    item-level coupons merged into their item, bill-level coupons, Pfand)
  - Parsed items are validated against the receipt total (✓ shown in UI)
  - Optional Groq fallback (official `groq` SDK) for photos/scans or receipts
    the rules can't handle: set `GROQ_API_KEY` in the backend environment.
    Uploaded images are normalized to RGB JPEG first — vision models misread
    palette PNGs — and PDFs without a text layer are rendered to images.
    Groq retires models periodically; if you see a 404, set `GROQ_VISION_MODEL`
    to a current image-capable model from https://console.groq.com/docs/models
  - Optional local OCR for images: install tesseract + `pip install pytesseract pillow`
- Running balances per group, settle-up recording
- Debt simplification (min cash flow: "Ben → Anna €9.31")
- Activity feed
- Recurring expenses (weekly/monthly, split equally, materialized automatically)

## Run it with Docker (recommended for deployment)

Everything — Postgres database, FastAPI backend, nginx-served frontend — runs
as containers:

```
cp .env.example .env      # set real secrets before deploying anywhere public
docker compose up -d --build
```

Open http://localhost:8080 (change with `SMARTSPLIT_PORT` in `.env`).
API docs: http://localhost:8080/api/docs (Swagger) and `/api/redoc`.

- Data persists in the `pgdata` Docker volume across restarts
- The backend container is not exposed to the host; nginx proxies `/api/*` to it
- `docker compose down` stops everything (`-v` also wipes the database)
- Update after code changes: `docker compose up -d --build`

## Turning on "Sign in with Google"

The button only appears once you've registered the app with Google — this takes
about two minutes and needs no client secret, since the browser flow uses the
client ID only.

1. Open https://console.cloud.google.com/apis/credentials (create a project if
   you don't have one)
2. **OAuth consent screen** → External → fill in app name + your email → Save.
   While it's in "Testing", add the Google accounts you want to sign in with
   under **Test users**; publish it when you want anyone to be able to log in.
3. **Credentials → Create credentials → OAuth client ID → Web application**
4. Under **Authorised JavaScript origins** add every URL the app is served
   from — the origin must match exactly, including port:
   - `http://localhost:8080` for local Docker
   - `https://yourdomain.com` for production
   (leave **Authorised redirect URIs** empty — this flow doesn't use them)
5. Copy the client ID into `.env`:

```
GOOGLE_CLIENT_ID=123456789012-abcdefghijklmnop.apps.googleusercontent.com
```

6. `docker compose up -d backend` — the button appears on the login page

The client ID is served to the frontend at runtime from `/api/auth/config`, so
changing it never requires rebuilding the frontend image. Leave it empty and the
Google button is simply hidden; email codes keep working.

**How accounts link:** the backend verifies the ID token's signature against
Google's public keys and checks it was issued for your client ID. If the Google
address matches an existing SmartSplit account, Google is linked to it (the old
password still works); otherwise a new account is created. Google accounts with
an unverified email are refused, so nobody can claim someone else's address.

If the button appears but sign-in fails, the browser console usually says
`The given origin is not allowed for the given client ID` — that means step 4's
origin doesn't match the URL in the address bar.

## Sending the login codes by email (Gmail)

Without SMTP configured the app still works: codes are printed to the backend
logs and shown in the UI, which is fine for local development. To actually
email them:

1. Turn on 2-Step Verification on the Google account
2. Create an App Password at https://myaccount.google.com/apppasswords
3. Put the 16 characters in `.env` as `SMTP_PASSWORD` (never the real password):

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASSWORD=abcd efgh ijkl mnop
SMTP_FROM=you@gmail.com
```

4. `docker compose up -d backend`

Any SMTP provider works the same way (Sendgrid, Mailgun, Fastmail…); set
`SMTP_SSL=1` if the provider wants implicit TLS on port 465. Once SMTP is
configured the API stops returning codes in its responses.

Codes are 6 digits, valid for `OTP_TTL_MINUTES` (default 10), single-use,
stored only as bcrypt hashes, limited to 5 wrong attempts, and rate-limited to
one send per 45 seconds per address.

## Run it locally without Docker (development)

Backend (Python 3.12+):

```
cd backend
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python -m uvicorn app.main:app --port 8000
```

Frontend (Node 18+):

```
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The Vite dev server proxies `/api` to the backend.

Without `DATABASE_URL` set, the backend falls back to a local SQLite file —
no database server needed for development.

Environment variables (backend, all optional):

- `DATABASE_URL` — SQLAlchemy URL; the compose file points it at the Postgres container
- `SMARTSPLIT_SECRET` — JWT signing secret (set a long random one in production)
- `GROQ_API_KEY` — enables the Groq fallback parser
- `GROQ_TEXT_MODEL` / `GROQ_VISION_MODEL` — override default models

## Test the parser

```
cd backend
.venv\Scripts\python test_parser.py
```

Runs the local parser against every PDF in `Example-Bills/` and verifies the
parsed items sum to the printed receipt total.

## How itemized splitting works

1. Upload a bill on a group page → backend returns store, date, total and line
   items (nothing saved yet).
2. The assignment matrix shows one row per product, one checkbox column per
   member — everyone included by default.
3. Untick a person on a row to exclude them from that product; row totals and
   per-person totals update live. Rows are editable (name/price), removable,
   and you can add rows manually.
4. Saving creates an itemized expense; each item is split among its ticked
   people with cent-accurate rounding, and the per-person sums become the
   expense splits that drive group balances.
