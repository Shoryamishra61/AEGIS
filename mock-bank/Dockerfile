FROM python:3.11-slim-bookworm
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
COPY mock-bank/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY mock-bank/app.py ./
EXPOSE 9090
# curl for container healthchecks
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "9090"]
