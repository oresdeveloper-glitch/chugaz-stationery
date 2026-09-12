# Hugging Face Space - CHUGAZ STATIONERY
# Uses Docker to run both frontend (Vite) and backend (Express) with SQLite

FROM node:20-alpine

# Install system dependencies
RUN apk add --no-cache sqlite sqlite-dev python3 make g++

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/
COPY api/package*.json ./api/

# Install all dependencies
RUN npm install --legacy-peer-deps
RUN cd backend && npm install --legacy-peer-deps
RUN cd frontend && npm install --legacy-peer-deps
RUN cd api && npm install --legacy-peer-deps

# Copy source code
COPY . .

# Build frontend
RUN cd frontend && npm run build

# Create data directory for SQLite (persisted on HF Spaces /data)
RUN mkdir -p /data/backend

# Environment variables (set in HF Space settings)
ENV NODE_ENV=production
ENV PORT=7860
ENV VERCEL=1
ENV DB_PATH=/data/backend/stationery.db

# Expose port
EXPOSE 7860

# Start script
CMD ["node", "backend/server.js"]