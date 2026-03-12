# Multi-stage build для Railway с SQLite
# CACHE BUST: 2026-03-11-11-00-002

# Stage 1: Build frontend
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend

# !!! CACHE BUSTING !!! Меняйте значение при каждом rebuild
ARG CACHE_BUST=1002
ARG BUILD_TIMESTAMP=2026-03-11-11-00-002
RUN echo "CACHE BUST: $CACHE_BUST, TIMESTAMP: $BUILD_TIMESTAMP"

# Копируем package.json первым слоем
COPY frontend/package*.json ./

# Устанавливаем зависимости С ОЧИСТКОЙ КЭША
RUN npm install && npm cache clean --force

# Копируем все файлы frontend
COPY frontend/ ./

# Собираем с выводом информации
RUN echo "=== Building frontend ===" && \
    npm run build && \
    echo "=== Build complete ===" && \
    ls -la dist/ && \
    head -c 1000 dist/assets/index-*.js | grep -o "CACHE_BUST\|BUILD_TIMESTAMP\|browser_mode" || echo "No markers found"

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

# Copy built frontend
COPY --from=frontend-build /app/frontend/dist ./frontend/dist
RUN ls -la frontend/dist/

# Environment
ENV NODE_ENV=production
ENV PORT=3000

# Start
CMD ["node", "backend/server.js"]
