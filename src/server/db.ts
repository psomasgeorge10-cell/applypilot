/**
 * Database access layer.
 *
 * The application speaks plain PostgreSQL. Which *engine* serves that SQL is
 * decided by a single environment variable:
 *
 *   DATABASE_URL set    -> node-postgres against a real server
 *                          (Supabase, Neon, RDS, docker-compose, ...)
 *   DATABASE_URL unset  -> PGlite, which is PostgreSQL itself compiled to
 *                          WebAssembly and persisted to ./.pglite
 *
 * Both paths run the same schema and the same queries, so a reviewer can clone
 * the repository and be looking at a working dashboard without installing a
 * database, while production points at managed Postgres by setting one variable.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

export interface Database {
  /** Runs a single parameterised statement. Always use $1, $2, ... placeholders. */
  query<T>(text: string, params?: readonly unknown[]): Promise<QueryResult<T>>;
  /** Runs a script that may contain several statements. Not parameterised. */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
  readonly driver: "postgres" | "pglite";
}

const PGLITE_DATA_DIR = process.env.PGLITE_DATA_DIR ?? ".pglite";
const SCHEMA_PATH = path.join(process.cwd(), "src", "server", "schema.sql");

function connectionString(): string | undefined {
  const url = process.env.DATABASE_URL?.trim();
  return url ? url : undefined;
}

async function createPostgres(url: string): Promise<Database> {
  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString: url,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    // Managed providers (Supabase, Neon, Heroku) terminate TLS with a
    // certificate chain Node does not ship, so verification is relaxed when
    // the caller explicitly asks for SSL.
    ssl: /sslmode=require|sslmode=prefer/.test(url)
      ? { rejectUnauthorized: false }
      : undefined,
  });

  return {
    driver: "postgres",
    async query<T>(text: string, params: readonly unknown[] = []) {
      const result = await pool.query(text, params as unknown[]);
      return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
    },
    async exec(sql: string) {
      await pool.query(sql);
    },
    async close() {
      await pool.end();
    },
  };
}

async function createPglite(): Promise<Database> {
  const { PGlite } = await import("@electric-sql/pglite");
  const pglite = await PGlite.create({ dataDir: PGLITE_DATA_DIR });

  return {
    driver: "pglite",
    async query<T>(text: string, params: readonly unknown[] = []) {
      const result = await pglite.query<T>(text, params as unknown[]);
      return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
    },
    async exec(sql: string) {
      await pglite.exec(sql);
    },
    async close() {
      await pglite.close();
    },
  };
}

/** Applies schema.sql. Every statement in it is idempotent, so this is safe to repeat. */
export async function migrate(db: Database): Promise<void> {
  await db.exec(await readFile(SCHEMA_PATH, "utf8"));
}

async function connect(): Promise<Database> {
  const url = connectionString();
  const db = url ? await createPostgres(url) : await createPglite();

  // The embedded database is created empty on first run, so bring it up to date
  // automatically. Against a real server, migrations stay an explicit, auditable
  // step (`npm run db:migrate`) unless opted into.
  if (db.driver === "pglite" || process.env.DATABASE_AUTO_MIGRATE === "true") {
    await migrate(db);
  }

  return db;
}

// Next.js re-evaluates modules on every hot reload in development; caching the
// connection on globalThis keeps a single pool (and a single PGlite instance,
// which holds an exclusive lock on its data directory) alive across reloads.
const globalForDb = globalThis as typeof globalThis & {
  __dashboardDb?: Promise<Database>;
};

export function getDb(): Promise<Database> {
  globalForDb.__dashboardDb ??= connect().catch((error) => {
    // Do not cache a failed connection: let the next request try again.
    globalForDb.__dashboardDb = undefined;
    throw error;
  });
  return globalForDb.__dashboardDb;
}
