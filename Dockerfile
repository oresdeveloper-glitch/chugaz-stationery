# ---- frontend build stage ----
FROM node:22-slim AS frontend-builder
WORKDIR /app
COPY frontend/package*.json ./
RUN npm install
COPY frontend ./
RUN npm run build

# ---- backend runtime stage ----
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production

COPY backend/package*.json ./backend/
RUN cd backend && npm install --omit=dev

COPY backend ./backend
COPY --from=frontend-builder /app/dist ./frontend/dist

WORKDIR /app/backend
ENV PORT=4000
ENV SERVE_FRONTEND=1
ENV JWT_SECRET=change-me-in-production
ENV DB_PATH=/data/stationery.db

VOLUME /data
EXPOSE 4000

CMD ["node", "server.js"]
