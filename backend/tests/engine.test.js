import { beforeAll, afterAll, beforeEach, test, expect } from "vitest";
import {
  setup,
  pool,
  fixture,
  advance,
  reply,
  payment,
  rows,
  paymentMessages,
  api,
} from "./helpers.js";
beforeAll(setup);
afterAll(() => pool.end());
beforeEach(() => fixture());
test("Repeated and concurrent engine runs are idempotent", async () => {
  const r = await Promise.all([advance(0), advance(0), advance(0)]);
  expect(r.map((x) => x.status)).toEqual([200, 200, 200]);
  expect(await paymentMessages()).toHaveLength(1);
});
test("Large jump uses only latest stage and does not backfill old reminders", async () => {
  await advance(15);
  await advance(0);
  expect(await paymentMessages()).toHaveLength(1);
  expect(await rows("SELECT * FROM stage_sends")).toHaveLength(5);
  expect((await rows("SELECT * FROM cases"))[0].owner).toBe("Manager");
});
test("One message per day even if a promise makes another stage eligible", async () => {
  await advance(0);
  await reply("PROMISE 2026-11-05");
  await advance(0);
  expect(await paymentMessages()).toHaveLength(1);
  await advance(1);
  expect(await paymentMessages()).toHaveLength(2);
});
test("Firm case escalates after two open days; payment resolves it", async () => {
  await advance(7);
  expect((await rows("SELECT * FROM cases"))[0].status).toBe("open");
  await advance(2);
  expect((await rows("SELECT * FROM cases"))[0].status).toBe("escalated");
  await payment(10000);
  expect((await rows("SELECT * FROM cases"))[0].status).toBe("resolved");
  await advance(10);
  expect(await rows("SELECT * FROM cases")).toHaveLength(1);
});
test("PAID is a claim, never an unverified ledger payment", async () => {
  await reply("PAID");
  expect((await rows("SELECT paid_amount FROM invoices"))[0].paid_amount).toBe(
    "0.00",
  );
  expect(await rows("SELECT * FROM notifications")).toHaveLength(1);
});
test("Invalid payments, overpayments and invalid dates are rejected atomically", async () => {
  for (const n of [-1, 0, 10001, 0.001])
    expect((await payment(n)).status).toBe(400);
  expect((await reply("PROMISE 2026-02-30")).status).toBe(400);
  expect((await reply("PROMISE 2026-01-01")).status).toBe(400);
  expect(await rows("SELECT * FROM payments")).toHaveLength(0);
});
test("Waiting promise is not escalated prematurely", async () => {
  await reply("PROMISE 2026-11-20");
  await advance(3);
  expect((await rows("SELECT * FROM cases"))[0].status).toBe("waiting");
  expect(await paymentMessages()).toHaveLength(0);
});
test("Seed has exactly 10 customers, 20 invoices and 30 orders", async () => {
  await api.post("/seed/reset").send({});
  for (const [table, n] of [
    ["customers", 10],
    ["invoices", 20],
    ["orders", 30],
  ])
    expect(Number((await rows(`SELECT COUNT(*) FROM ${table}`))[0].count)).toBe(
      n,
    );
});
test("Early offer is issued once and can settle with a 2% discount", async () => {
  await pool.query(
    "UPDATE invoices SET issued_date='2026-11-05',due_date='2026-11-20'",
  );
  await advance(0);
  expect((await rows("SELECT * FROM offers"))[0].kind).toBe("early_payment");
  const r = await api
    .post("/payments")
    .send({ invoice_id: 1, amount: 9800, redeem_offer: true });
  expect(r.status).toBe(200);
  expect(r.body.remaining).toBe(0);
  expect((await rows("SELECT * FROM offers"))[0].used).toBe(true);
  await advance(1);
  expect(await rows("SELECT * FROM offers")).toHaveLength(1);
});
test("Expired early offer cannot be redeemed", async () => {
  await pool.query(
    "UPDATE invoices SET issued_date='2026-11-05',due_date='2026-11-20'",
  );
  await advance(0);
  await advance(4);
  expect(
    (
      await api
        .post("/payments")
        .send({ invoice_id: 1, amount: 9800, redeem_offer: true })
    ).status,
  ).toBe(400);
});
async function orders(ages) {
  for (const age of ages)
    await pool.query(
      "INSERT INTO orders(customer_id,order_date,items) VALUES(1,DATE '2026-11-05'-$1::int,$2)",
      [age, JSON.stringify([{ name: "Rice", quantity: 2 }])],
    );
}
test("Reorder at 90% gap lists last order; YES creates exactly one draft", async () => {
  await payment(10000);
  await orders([29, 19, 9]);
  await advance(0);
  expect(
    (await rows("SELECT * FROM outbox WHERE kind='reorder'"))[0].body,
  ).toContain("2 × Rice");
  await reply("YES");
  await reply("YES");
  expect(await rows("SELECT * FROM orders WHERE status='draft'")).toHaveLength(
    1,
  );
});
test("Unanswered reorder creates a case after two days", async () => {
  await payment(10000);
  await orders([29, 19, 9]);
  await advance(0);
  await advance(2);
  expect((await rows("SELECT * FROM cases"))[0].kind).toBe("reorder");
});
test("Overdue payment takes precedence over reorder", async () => {
  await fixture(3);
  await orders([29, 19, 9]);
  await advance(0);
  expect(await rows("SELECT * FROM outbox WHERE kind='reorder'")).toHaveLength(
    0,
  );
  expect(await paymentMessages()).toHaveLength(1);
});
test("Win-back offer expires in 7 days and is unique per customer", async () => {
  await payment(10000);
  await orders([70, 60, 50]);
  await advance(0);
  let o = await rows("SELECT * FROM offers");
  expect(o).toHaveLength(1);
  expect(o[0].kind).toBe("win_back");
  expect(o[0].expires_date).toBe("2026-11-12");
  await advance(1);
  expect(await rows("SELECT * FROM offers WHERE kind='win_back'")).toHaveLength(
    1,
  );
});
test("No offer to a customer with a 15-day overdue invoice", async () => {
  await fixture(15);
  await orders([70, 60, 50]);
  await advance(0);
  expect(await rows("SELECT * FROM offers")).toHaveLength(0);
});
test("Delivery status changes from sent to delivered to read", async () => {
  await advance(0);
  const m = (await paymentMessages())[0];
  expect(
    (await api.patch(`/messages/${m.id}/status`).send({ status: "delivered" }))
      .body.status,
  ).toBe("delivered");
  expect(
    (await api.patch(`/messages/${m.id}/status`).send({ status: "read" })).body
      .status,
  ).toBe("read");
  expect(
    (await api.patch(`/messages/${m.id}/status`).send({ status: "delivered" }))
      .status,
  ).toBe(404);
});
test("Clock rejects backwards, fractional and unbounded advances", async () => {
  for (const n of [-1, 1.5, 366, "oops"])
    expect((await advance(n)).status).toBe(400);
});

test("Reopened promise case ages from reopening, not the original case date", async () => {
  await reply("PROMISE 2026-11-10");
  await advance(5);
  expect((await rows("SELECT * FROM cases"))[0].status).toBe("open");
  await advance(1);
  expect((await rows("SELECT * FROM cases"))[0].status).toBe("open");
  await advance(1);
  expect((await rows("SELECT * FROM cases"))[0].status).toBe("escalated");
});
