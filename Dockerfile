# Single-image build for hosting: the API serves the built UI too, so a free
# tier only has to run one service and there is no CORS or proxy to configure.
#
#   docker build -t smartsplit .
#   docker run -p 8000:8000 -e DATABASE_URL=... -e SMARTSPLIT_SECRET=... smartsplit
#
# docker-compose.yml is still the two-service setup used for local development.

# ---- stage 1: build the React app ----
FROM node:22-alpine AS web

WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/index.html frontend/vite.config.js frontend/eslint.config.js ./
COPY frontend/src ./src
COPY frontend/public ./public
# `npm run build` lints first, so a stale identifier fails the image build
# rather than reaching a user's browser.
RUN npm run build

# ---- stage 2: the API, which also serves those files ----
FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 SMARTSPLIT_ENV=production

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
COPY --from=web /web/dist ./static

EXPOSE 8000
# Hosts inject $PORT; default to 8000 when run directly.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
