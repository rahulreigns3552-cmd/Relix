FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

COPY apps/api apps/api
COPY apps/worker apps/worker
COPY packages/shared packages/shared
RUN npm run build -w @relix/shared && npm run build -w @relix/api

ENV WORKER_PORT=8790
EXPOSE 8790
CMD ["npm", "run", "start", "-w", "@relix/worker"]
