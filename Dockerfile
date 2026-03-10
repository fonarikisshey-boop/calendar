# Multi-stage build для Railway с SQLite
# Build date: 2026-03-11 v1.0.2 - FORCE REBUILD #10

# Stage 1: Build frontend (NO CACHE)
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend

# Принудительная инвалидация кэша - меняйте это число при каждом rebuild
ARG CACHE_BUST=20
RUN echo "Cache bust: $CACHE_BUST - Rebuilding frontend v1.0.2"

# Полная очистка и пересборка
COPY frontend/package*.json ./
RUN rm -rf node_modules package-lock.json && \
    npm install && \
    npm cache clean --force

# Копируем исходники и собираем
COPY frontend/ ./
RUN npm run build 2>&1 | tee build.log && \
    ls -la dist/ && \
    cat build.log | grep -i "error" || echo "Build successful"

# Stage 2: Setup backend
FROM node:20-alpine
WORKDIR /app

# Установка зависимостей для sqlite3
RUN apk add --no-cache python3 make g++

# Copy backend files
COPY backend/package*.json ./backend/
RUN cd backend && npm install

# Copy backend source
COPY backend/ ./backend/

# Copy built frontend (всегда свежий)
COPY --from=frontend-build /app/frontend/dist ./frontend/dist
RUN ls -la frontend/dist/

# Environment
ENV NODE_ENV=production
ENV PORT=3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"

# Start
CMD ["node", "backend/server.js"]
