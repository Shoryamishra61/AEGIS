# AEGIS operator dashboard: build with pinned Node.
FROM node:20.16.0-bookworm AS build
WORKDIR /app
COPY dashboard/package.json dashboard/package-lock.json* ./
# Use npm install (lockfile may be absent on first build); pinned deps in package.json.
RUN npm install
COPY dashboard/ ./
# Dashboard talks to nginx-proxied /api at runtime.

ENV VITE_CONTROL_URL=/api
RUN npm run build

FROM nginx:1.27.0-bookworm
COPY dashboard/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
