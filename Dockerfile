# Multi-stage build для Railway с SQLite
# FORCE REBUILD - v1.0.2 BUILD 20

# Stage 1: Build frontend
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend

# Копируем package.json
COPY frontend/package*.json ./

# Устанавливаем зависимости без кэша
RUN npm install --no-cache

# Копируем все исходники
COPY frontend/ ./

# Показываем содержимое для отладки
RUN ls -la src/

# Собираем с выводом логов
RUN npm run build 2>&1

# Показываем результат сборки
RUN ls -la dist/ && head -c 500 dist/assets/index-*.js

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

# Показываем что скопировали
RUN ls -la frontend/dist/

# Environment
ENV NODE_ENV=production
ENV PORT=3000

# Start
CMD ["node", "backend/server.js"]
