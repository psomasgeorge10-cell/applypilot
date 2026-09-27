/**
 * Test environment.
 *
 * Imported for its side effects before anything that touches the database, so
 * that src/server/db.ts - which reads its configuration once at module load -
 * sees an in-memory PostgreSQL instance rather than the developer's ./.pglite
 * directory or a real server.
 */

process.env.PGLITE_DATA_DIR = "memory://";
delete process.env.DATABASE_URL;
