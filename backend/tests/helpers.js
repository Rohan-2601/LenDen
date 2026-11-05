import pg from "pg";
import request from "supertest";
import { pool, databaseUrl, transaction } from "../src/db/pool.js";
import { migrate } from "../scripts/migrate.js";
import { seed } from "../scripts/seed.js";
import { app } from "../src/server.js";
export { pool, transaction };
export const api = request(app);
export async function setup() {
  const url = new URL(databaseUrl);
  const name = url.pathname.slice(1);
  if (
    !/^[a-zA-Z0-9_]+_test$/.test(name) ||
    databaseUrl === process.env.DATABASE_URL
  )
    throw new Error("Tests require a distinct database ending in _test");
  url.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: url.href });
  await admin.connect();
  try {
    if (
      !(await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [name]))
        .rowCount
    )
      await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  await migrate();
}
export async function fixture(overdue = 0, count = 1) {
  await transaction(seed);
  await pool.query(
    "TRUNCATE payments,reorder_sends,offers,notifications,case_events,cases,stage_sends,outbox,orders,invoices RESTART IDENTITY CASCADE",
  );
  for (let i = 0; i < count; i++)
    await pool.query(
      "INSERT INTO invoices(customer_id,invoice_no,amount,issued_date,due_date) VALUES(1,$1,10000,DATE '2026-11-05'-$2::int-15,DATE '2026-11-05'-$2::int)",
      [`TEST-${i + 1}`, overdue],
    );
}
export const advance = (days) =>
  api.post("/clock/advance?days=" + days).send({});
export const reply = (text) =>
  api.post("/webhook/incoming").send({ customer_id: 1, text });
export const payment = (amount) =>
  api.post("/payments").send({ invoice_id: 1, amount });
export const rows = async (sql, ...args) => (await pool.query(sql, args)).rows;
export const paymentMessages = () =>
  rows("SELECT * FROM outbox WHERE customer_id=1 AND kind='payment'");
