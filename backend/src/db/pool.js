import pg from "pg";
import dotenv from "dotenv";
// SQL DATE values are calendar dates, not local-time JavaScript timestamps.
pg.types.setTypeParser(1082, (value) => value);
dotenv.config({ path: new URL("../../../.env", import.meta.url) });
export const databaseUrl =
  process.env.NODE_ENV === "test"
    ? process.env.TEST_DATABASE_URL ||
      "postgres://retention:retention@localhost:5432/retention_test"
    : process.env.DATABASE_URL ||
      "postgres://retention:retention@localhost:5432/retention";
export const pool = new pg.Pool({ connectionString: databaseUrl });
export async function transaction(fn) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(816240)");
    const result = await fn(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
