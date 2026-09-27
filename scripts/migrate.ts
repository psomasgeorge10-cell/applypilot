/**
 * Applies src/server/schema.sql without touching any data.
 *
 * Use this against a real Postgres instance (`DATABASE_URL=... npm run db:migrate`);
 * the embedded PGlite database migrates itself on start-up.
 */

import { config as loadEnv } from "dotenv";
import { getDb, migrate } from "../src/server/db";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

async function main() {
  const db = await getDb();
  console.log(`Using the ${db.driver} driver.`);
  await migrate(db);
  console.log("Schema is up to date.");
  await db.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
