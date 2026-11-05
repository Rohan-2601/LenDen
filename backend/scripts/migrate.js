import { pool } from "../src/db/pool.js";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
export async function migrate(db = pool) {
  await db.query(
    await readFile(
      new URL("../src/db/migrations/001_init.sql", import.meta.url),
      "utf8",
    ),
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await migrate();
  await pool.end();
  console.log("Migration complete");
}
