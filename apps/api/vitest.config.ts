import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    hookTimeout: 120000,
    testTimeout: 30000,
    env: {
      JWT_SECRET: 'test-secret-value',
      RELIX_WORKER_API_KEY: 'test-worker-key',
      ADMIN_EMAIL: 'admin@relix.app',
      ADMIN_PASSWORD: 'change-me-please',
      WEB_ORIGIN: 'http://localhost:5173',
      SEED_ON_START: 'false',
      DATABASE_URL: process.env.TEST_DATABASE_URL || 'postgresql://relix:relix@127.0.0.1:5432/relix_test',
    },
  },
});
