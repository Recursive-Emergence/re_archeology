# Optimized Dockerfile for RE-Archaeology Framework
# Multi-stage build for better performance and smaller image size
FROM python:3.11-slim as builder

# Set working directory
WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies (using minimal Cloud Run requirements)
COPY requirements.cloudrun.txt .
# Install pip dependencies with optimized caching and cleanup
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir --user -r requirements.cloudrun.txt && \
    # Clean up after pip to reduce image size
    find /root/.local -name "*.pyc" -delete && \
    find /root/.local -name "__pycache__" -delete && \
    rm -rf /root/.cache/pip

# Production stage
FROM python:3.11-slim as production

# Set working directory
WORKDIR /app

# Install minimal runtime dependencies
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Copy Python packages from builder stage
COPY --from=builder /root/.local /home/app/.local

# Make sure scripts in .local are usable
ENV PATH=/home/app/.local/bin:$PATH

# Copy application code with proper ownership
COPY --chown=1000:1000 backend/ ./backend/
COPY --chown=1000:1000 frontend/ ./frontend/
COPY --chown=1000:1000 kernel/ ./kernel/
COPY --chown=1000:1000 lidar_factory/ ./lidar_factory/
COPY --chown=1000:1000 profiles/ ./profiles/
COPY --chown=1000:1000 start_server.py ./start_server.py
# COPY --chown=1000:1000 .env.cloudrun ./.env
COPY --chown=1000:1000 .env.cloudrun ./.env
COPY --chown=1000:1000 sage-striker-294302-b89a8b7e205b.json ./sage-striker-294302-b89a8b7e205b.json
COPY --chown=1000:1000 lattice/ ./lattice/

# Create app user for security
RUN useradd --create-home --shell /bin/bash --uid 1000 app \
    && chown -R app:app /app \
    && chown -R app:app /home/app

# Set environment variables for production
ENV PYTHONPATH=/app \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Expose port
EXPOSE 8080

# Health check with proper timeout
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:${PORT:-8080}/health || exit 1

# Switch to app user
USER app

# Optimized startup command using our custom startup script
CMD ["python", "start_server.py"]
