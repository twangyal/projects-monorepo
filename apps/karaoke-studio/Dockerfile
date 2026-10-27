# Karaoke Studio in a Linux container, so it also runs on macOS and Windows (through Docker Desktop), where the
# studio's procfs and POSIX process controls are not available natively.
#   docker build -t karaoke-studio .
#   docker run --rm -v karaoke-models:/models karaoke-studio setup-models      # once: about 1 GB of models
#   docker run --rm -p 127.0.0.1:8765:8765 -v karaoke-data:/data -v karaoke-models:/models karaoke-studio
# Models live in their own volume and are installed only by setup-models; the service never downloads them.

FROM node:22-bookworm-slim AS ui
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
COPY assets ./assets
RUN npm run build

FROM python:3.11-slim-bookworm
# Noto fonts and fontconfig let exported videos draw lyrics in scripts the bundled font lacks (CJK, Tibetan,
# Devanagari and more).
RUN apt-get update \
 && apt-get install --no-install-recommends -y ffmpeg fontconfig fonts-noto-core fonts-noto-cjk \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements-core.txt requirements-ml.lock.txt ./
RUN pip install --no-cache-dir -r requirements-core.txt -r requirements-ml.lock.txt
COPY karaoke ./karaoke
COPY scripts ./scripts
COPY assets ./assets
COPY --from=ui /app/dist ./dist
COPY docker-entrypoint.sh /usr/local/bin/karaoke-studio
RUN chmod 0755 /usr/local/bin/karaoke-studio \
 && useradd --create-home --uid 10001 karaoke \
 && mkdir -p /data /models && chown karaoke:karaoke /data /models
USER karaoke
VOLUME ["/data", "/models"]
EXPOSE 8765
ENTRYPOINT ["karaoke-studio"]
CMD ["serve"]
