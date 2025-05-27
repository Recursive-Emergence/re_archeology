# Unified Dockerfile for RE-Archaeology MVP
# Supports both development and production modes
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install minimal system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY backend/ ./backend/
COPY frontend/ ./frontend/

# Create app user for production security
RUN useradd --create-home --shell /bin/bash app \
    && chown -R app:app /app

# Expose port (flexible for dev/prod)
EXPOSE 8080

# Health check for production
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD python -c "import os, requests; port=os.getenv('PORT', '8080'); requests.get(f'http://localhost:{port}/health')" || exit 1

# Switch to app user for production (can be overridden in docker-compose)
USER app

# Default production command (can be overridden in docker-compose for dev)
CMD sh -c "uvicorn backend.api.main:app --host 0.0.0.0 --port \${PORT:-8080}"
