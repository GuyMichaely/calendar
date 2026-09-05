FROM oven/bun:1-slim

WORKDIR /app

COPY package.json ./
RUN bun install --production

COPY auth ./auth
COPY backend ./backend
COPY sync ./sync

ENV HOST=0.0.0.0
ENV PORT=8080
ENV CALENDAR_DATA_DIR=/home/calendar-data

EXPOSE 8080

CMD ["bun", "backend/bun-server.js"]
