FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml README.md uv.lock ./
COPY teor ./teor
COPY config ./config
COPY docs/dataset-card.md ./docs/dataset-card.md
COPY site/public/review-local.html ./site/public/review-local.html
RUN pip install --no-cache-dir uv && uv sync --frozen --no-dev
RUN useradd --create-home --uid 10001 teor
USER teor
EXPOSE 8000
ENTRYPOINT ["/app/.venv/bin/teor", "serve", "/snapshot", "--host", "0.0.0.0"]
