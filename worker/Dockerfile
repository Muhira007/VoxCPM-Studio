FROM python:3.12.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    WORKER_MODE=simulation \
    WORKER_DATA_DIR=/workspace/worker \
    WORKER_MODEL_DIR=/workspace/models \
    WORKER_CACHE_DIR=/workspace/cache \
    WORKER_REFERENCES_DIR=/workspace/references \
    WORKER_OUTPUTS_DIR=/workspace/outputs

WORKDIR /app
RUN groupadd --gid 10001 worker && useradd --uid 10001 --gid worker --create-home worker
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --requirement requirements.txt
COPY app ./app
COPY start.py ./start.py
RUN mkdir -p /workspace/worker /workspace/models /workspace/cache /workspace/references /workspace/outputs \
    && chown -R worker:worker /app /workspace

USER worker
EXPOSE 8001
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8001/health', timeout=2).read()"]
CMD ["python", "start.py"]
