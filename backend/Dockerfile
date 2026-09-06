ARG BUN_VERSION
FROM oven/bun:${BUN_VERSION}-slim AS base
WORKDIR /app

FROM base AS dependencies
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile --production

FROM base AS backend
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY auth ./auth
COPY backend ./backend
COPY sync ./sync
RUN mkdir /data && chown bun:bun /data
USER bun
ENV HOST=0.0.0.0 PORT=8787 CALENDAR_DATA_DIR=/data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun --no-env-file -e 'const u = new URL(process.env.CALENDAR_PUBLIC_BASE_URL); const p = u.pathname.replace(/\/$/, ""); const r = await fetch(`http://127.0.0.1:8787${p}/healthz`); process.exit(r.ok && await r.text() === "ok" ? 0 : 1)'
CMD ["bun", "--no-env-file", "backend/bun-server.js"]
