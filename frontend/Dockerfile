# stage 1: build the React app
FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY index.html vite.config.js eslint.config.js ./
COPY src ./src
COPY public ./public
# `npm run build` lints first — a stale identifier compiles fine but crashes
# at click time, so the image should refuse to build rather than ship it.
RUN npm run build

# stage 2: serve with nginx, proxying /api to the backend container
FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
