FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    BOOKS_DIR=/app/data/books \
    ANNOTATIONS_DIR=/app/data/annotations

WORKDIR /app

# Runtime libs commonly needed by lxml/bs4 parsing stack.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libxml2 \
    libxslt1.1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN pip install --upgrade pip && pip install -r /app/requirements.txt

COPY backend /app/backend

# Keep runtime data outside the image layer.
RUN mkdir -p /app/data/books /app/data/annotations
VOLUME ["/app/data"]

# Run as an unprivileged user.
RUN useradd -m -u 10001 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
