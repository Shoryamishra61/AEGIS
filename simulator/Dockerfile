FROM python:3.11-slim-bookworm
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
COPY simulator/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY simulator/ ./
# Default: run all scenarios. Override the command to run a single scenario.
CMD ["python", "-m", "scenarios", "all"]
