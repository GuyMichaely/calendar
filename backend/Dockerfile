FROM oven/bun:1-slim

WORKDIR /app

COPY package.json ./
RUN bun install --production

COPY auth ./auth
COPY backend ./backend
COPY sync ./sync

ENV HOST=0.0.0.0
ENV PORT=8787
ENV CALENDAR_DATA_DIR=/data

EXPOSE 8787

LABEL org.opencontainers.image.source="https://github.com/GuyMichaely/calendar"

CMD ["bun", "backend/bun-server.js"]
