/** DDL for the Relix MySQL store. Imported by the worker and the one-time loader. */
export const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS app_owner (
    email VARCHAR(255) NOT NULL PRIMARY KEY,
    created_at DATETIME(3) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS users (
    email VARCHAR(255) NOT NULL PRIMARY KEY,
    password_hash TEXT NOT NULL,
    created_at VARCHAR(40) NULL,
    sort_order INT NOT NULL DEFAULT 0,
    body JSON NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS projects (
    id VARCHAR(128) NOT NULL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT NULL,
    website VARCHAR(512) NULL,
    industry VARCHAR(255) NULL,
    owner_email VARCHAR(255) NULL,
    created_at VARCHAR(40) NULL,
    sort_order INT NOT NULL DEFAULT 0,
    body JSON NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS project_docs (
    project_id VARCHAR(128) NOT NULL,
    doc_key VARCHAR(64) NOT NULL,
    body JSON NOT NULL,
    PRIMARY KEY (project_id, doc_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS provision_queue (
    id VARCHAR(160) NOT NULL PRIMARY KEY,
    status VARCHAR(64) NULL,
    project_id VARCHAR(128) NULL,
    email VARCHAR(255) NULL,
    sort_order INT NOT NULL DEFAULT 0,
    body JSON NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS bridge_settings (
    id TINYINT NOT NULL PRIMARY KEY,
    body JSON NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS channel_jobs (
    id VARCHAR(160) NOT NULL PRIMARY KEY,
    project_id VARCHAR(128) NULL,
    platform VARCHAR(64) NULL,
    status VARCHAR(32) NULL,
    sort_order INT NOT NULL DEFAULT 0,
    body JSON NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS channel_sync_state (
    id TINYINT NOT NULL PRIMARY KEY,
    body JSON NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS notifications_global (
    id TINYINT NOT NULL PRIMARY KEY,
    body JSON NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS app_documents (
    doc_key VARCHAR(128) NOT NULL PRIMARY KEY,
    body JSON NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS chat_leads (
    id VARCHAR(80) NOT NULL PRIMARY KEY,
    project_id VARCHAR(128) NOT NULL,
    exchange_key CHAR(64) NOT NULL,
    created_at VARCHAR(40) NOT NULL,
    to_email VARCHAR(255) NOT NULL,
    emailed_at VARCHAR(40) NULL,
    transcript JSON NOT NULL,
    UNIQUE KEY uq_chat_leads_exchange (exchange_key),
    KEY idx_chat_leads_pending (emailed_at, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];
