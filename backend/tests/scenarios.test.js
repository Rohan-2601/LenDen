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
} from "./helpers.js";
beforeAll(setup);
afterAll(() => pool.end());
beforeEach(() => fixture());
test("1. Payment before due date prevents all collection reminders", async () => {
  await fixture(-2);
  expect((await payment(10000)).status).toBe(200);
  await advance(30);
  expect(await paymentMessages()).toHaveLength(0);
});
test("2. 40% payment on day +3 reduces the next reminder", async () => {
  await advance(3);
  await payment(4000);
  await advance(4);
  const m = await paymentMessages();
  expect(m).toHaveLength(2);
  expect(m[1].body).toContain("6000.00");
  expect(m[1].body).not.toContain("10000.00");
});
test("3. Promise pauses reminders until its date then resumes firmly", async () => {
  await advance(3);
  expect((await reply("PROMISE 2026-11-10")).status).toBe(200);
  await advance(1);
  expect(await paymentMessages()).toHaveLength(1);
  await advance(1);
  const m = await paymentMessages();
  expect(m).toHaveLength(2);
  expect(m[1].body).toContain("salesperson");
});
test("4. Dispute pauses collections and opens a salesperson case", async () => {
  await reply("DISPUTE");
  await advance(15);
  expect(await paymentMessages()).toHaveLength(0);
  const c = await rows("SELECT * FROM cases WHERE invoice_id=1");
  expect(c).toHaveLength(1);
  expect(c[0].kind).toBe("dispute");
  expect(
    (
      await rows(
        "SELECT detail FROM case_events WHERE case_id=$1 ORDER BY id",
        c[0].id,
      )
    )[0].detail,
  ).toContain("Arjun Mehta");
});
test("5. STOP suppresses every future message and notifies salesperson", async () => {
  await reply("STOP");
  await advance(30);
  expect(
    await rows(
      "SELECT * FROM outbox WHERE customer_id=1 AND direction='outgoing'",
    ),
  ).toHaveLength(0);
  expect((await rows("SELECT body FROM notifications"))[0].body).toContain(
    "Arjun Mehta",
  );
});
test("6. Three overdue invoices produce one combined message", async () => {
  await fixture(3, 3);
  await advance(0);
  const m = await paymentMessages();
  expect(m).toHaveLength(1);
  for (let i = 1; i <= 3; i++) expect(m[0].body).toContain("TEST-" + i);
  expect(
    await rows("SELECT * FROM stage_sends WHERE stage=$1", "soft_followup"),
  ).toHaveLength(3);
});
