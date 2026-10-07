FROM node:22-bookworm-slim

WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

COPY apps/api apps/api
COPY packages/shared packages/shared
COPY data data
RUN npm run build -w @relix/shared \
  && npm run build -w @relix/api \
  && chmod +x apps/api/docker-entrypoint.sh

ENV PORT=8787
EXPOSE 8787
CMD ["sh", "apps/api/docker-entrypoint.sh"]
