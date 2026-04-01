FROM python:3.12-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY telegram_bot/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy bot code
COPY telegram_bot/ .

# Environment variables (set in Railway)
ENV BOT_TOKEN=${BOT_TOKEN}
ENV WEBAPP_URL=${WEBAPP_URL}

# Run bot
CMD ["python3", "bot.py"]
