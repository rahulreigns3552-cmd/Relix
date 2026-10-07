#!/bin/sh
set -e
cd /app/apps/api

# pg_isready can pass before another container can open a TCP connection.
# Retry migrate until Postgres accepts connections, then seed and serve.
i=0
until npx prisma migrate deploy; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    echo "postgres did not become reachable" >&2
    exit 1
  fi
  echo "waiting for postgres ($i)..."
  sleep 2
done

cd /app
node apps/api/dist/seed.js
exec node apps/api/dist/index.js
