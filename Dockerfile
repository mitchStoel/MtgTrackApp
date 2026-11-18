# ==========================================
# Stage 1: Builder (Installeert dependencies)
# ==========================================
FROM python:3.12-slim AS builder

WORKDIR /build

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# ==========================================
# Stage 2: Production Runtime (Non-root)
# ==========================================
FROM python:3.12-slim AS runtime

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    DB_PATH="/app/data/mtg_tracker.db"

# Installeer curl voor de Docker healthcheck
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

# Maak een non-root gebruiker en groep aan
RUN groupadd -r appgroup && useradd -r -g appgroup -d /app -s /sbin/nologin appuser

# Kopieer de gecompileerde virtual environment uit de builder stage
COPY --from=builder /opt/venv /opt/venv

# Kopieer applicatiecode en maak de data-directory aan voor persistent storage
COPY app.py .
COPY templates/ ./templates/
RUN mkdir -p /app/data && chown -R appuser:appgroup /app

# Schakel over naar non-root gebruiker
USER appuser

EXPOSE 5000

# Start met Gunicorn (1 worker + 4 threads om SQLite write-locks te voorkomen)
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "1", "--threads", "4", "--timeout", "60", "app:app"]