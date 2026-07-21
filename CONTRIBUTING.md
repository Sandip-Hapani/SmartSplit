# Contributing to SmartSplit

Thanks for trying it out. Bug reports from real use are the most useful thing
right now.

## Reporting a bug

Open an issue at
<https://github.com/Sandip-Hapani/SmartSplit/issues> and include:

- **What you did** — the steps, in order
- **What you expected** vs **what happened**
- **Where** — the hosted demo or your own instance
- A screenshot if it's a layout or visual problem
- Anything red in the browser console (F12 → Console)

If it involves money being wrong, the exact amounts and who was in the split
help enormously — balances are the part most worth getting right.

## Running it locally

You need Docker.

```bash
git clone https://github.com/Sandip-Hapani/SmartSplit.git
cd SmartSplit
cp .env.example .env          # set SMARTSPLIT_SECRET at minimum
docker compose up -d --build
```

Open <http://localhost:8080>. API docs are at `/api/docs`.

To sign in without setting up email, put `SMARTSPLIT_ALLOW_DEV_CODES=1` in your
`.env`. That makes the app hand you the login code in the API response instead
of emailing it. **Only ever do this locally** — on a public instance it would
let anyone sign in as anyone.

## Making a change

- Branch off `simplifyUI` (the active branch)
- `cd frontend && npm run build` runs ESLint first; keep it clean
- Keep the existing style: small focused components, comments that explain
  *why* rather than restating the code
- Balances, splits and currency conversion have exact expected values — if you
  touch those, say in the PR what you checked them against

## Layout

```
backend/app/
  routers/     HTTP endpoints, one file per area
  services/    the logic worth testing — splits, balances, currency, parsing
  models.py    SQLAlchemy tables
frontend/src/
  pages/       one per route
  components/  shared UI
```

## Things to know before changing money code

- **Balances are per currency and never netted across currencies.** Converting
  would freeze a rate into a debt; conversion exists only for display.
- **Splits are stored as amounts**, so editing a percentage expense works
  backwards from money to percentages.
- **Activity is append-only.** Undo appends a reversing entry rather than
  deleting, the way a revert commit does.
