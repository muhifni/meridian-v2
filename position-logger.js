/**
 * position-logger.js — Structured position event journal
 *
 * Logs every position lifecycle event (open, close, management cycle,
 * screening cycle) into SQLite for queryable historical analysis.
 *
 * Sync writes via better-sqlite3 with WAL mode — ~0.01ms per write,
 * crash-safe, no async overhead.
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { log } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "position-journal.db");

// ─── Schema ──────────────────────────────────────────────────────────

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          TEXT    NOT NULL,
    type        TEXT    NOT NULL,
    position_id TEXT,
    pool_address TEXT,
    pool_name   TEXT,
    data        TEXT    NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_events_ts       ON events(ts);
  CREATE INDEX IF NOT EXISTS idx_events_type     ON events(type);
  CREATE INDEX IF NOT EXISTS idx_events_position ON events(position_id);
  CREATE INDEX IF NOT EXISTS idx_events_pool     ON events(pool_address);
`;

// ─── Init DB ─────────────────────────────────────────────────────────

let db;

export function initLogger() {
  if (db) return db;

  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");    // balance: safe + fast
  db.exec(SCHEMA);

  log("position_logger", `SQLite journal ready @ ${DB_PATH} (WAL mode)`);
  return db;
}

// ─── Prepared statement ──────────────────────────────────────────────

const _insert = () => {
  if (!_stmt) _stmt = db.prepare(
    `INSERT INTO events (ts, type, position_id, pool_address, pool_name, data)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  return _stmt;
};
let _stmt;

// ─── Core writer ─────────────────────────────────────────────────────

function write(type, fields = {}) {
  if (!db) initLogger();
  const { positionId, poolAddress, poolName, ...rest } = fields;
  _insert().run(
    new Date().toISOString(),
    type,
    positionId || null,
    poolAddress || null,
    poolName || null,
    JSON.stringify(rest)
  );
}

// ─── Event-specific helpers ──────────────────────────────────────────

export function logPositionOpen(data) {
  write("position_open", data);
}

export function logPositionClose(data) {
  write("position_close", data);
}

export function logManagementCycle(data) {
  write("management_cycle", data);
}

export function logScreeningCycle(data) {
  write("screening_cycle", data);
}

export function logSignalRecalc(data) {
  write("signal_recalc", data);
}

export function logThresholdEvolve(data) {
  write("threshold_evolve", data);
}

// ─── Query helpers ───────────────────────────────────────────────────

export function query(sql, params = []) {
  if (!db) initLogger();
  return db.prepare(sql).all(params);
}

export function queryOne(sql, params = []) {
  if (!db) initLogger();
  return db.prepare(sql).get(params);
}

/** Convenience: get recent events of a type */
export function recentEvents(type, limit = 20) {
  return query(
    `SELECT ts, type, position_id, pool_name, data
     FROM events
     WHERE type = ?
     ORDER BY id DESC
     LIMIT ?`,
    [type, limit]
  );
}

/** Convenience: get all events for a specific position */
export function positionEvents(positionId) {
  return query(
    `SELECT ts, type, pool_name, data
     FROM events
     WHERE position_id = ?
     ORDER BY id ASC`,
    [positionId]
  );
}

/** Get journal stats */
export function journalStats() {
  const row = queryOne(`SELECT COUNT(*) as total, COUNT(DISTINCT position_id) as positions, MIN(ts) as oldest, MAX(ts) as newest FROM events`);
  const byType = query(`SELECT type, COUNT(*) as count FROM events GROUP BY type ORDER BY count DESC`);
  return { ...row, byType };
}

// ─── Cleanup ─────────────────────────────────────────────────────────

export function closeLogger() {
  if (db) {
    db.close();
    db = null;
    _stmt = null;
    log("position_logger", "SQLite journal closed");
  }
}
