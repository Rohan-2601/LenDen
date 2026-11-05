import { Router } from "express";
import { pool, transaction } from "../db/pool.js";
import { today, addDays, day } from "../services/clock.js";
import { runEngine } from "../services/engine.js";
import { openCase, notify, resolveInvoice, event } from "../services/cases.js";
import { seed } from "../../scripts/seed.js";
import { offerConfig } from "../services/offers.js";
export const router = Router();
const route = (method, path, fn) =>
  router[method](path, (req, res, next) =>
    Promise.resolve(fn(req, res)).catch(next),
  );
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
const id = (value) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1)
    fail("A positive integer ID is required");
  return n;
};
route("get", "/clock", async (req, res) =>
  res.json({ today: await today(pool) }),
);
route("post", "/clock/advance", async (req, res) => {
  const days = Number(req.query.days);
  if (!Number.isSafeInteger(days) || days < 0 || days > 365)
    fail("days must be an integer from 0 to 365");
  res.json(
    await transaction(async (db) => {
      const date = addDays(await today(db), days);
      await db.query("UPDATE clock SET today=$1", [date]);
      await runEngine(db);
      return { today: date };
    }),
  );
});
route("post", "/seed/reset", async (req, res) => {
  await transaction(seed);
  res.json({ ok: true, today: await today(pool) });
});
route("get", "/customers", async (req, res) =>
  res.json(
    (
      await pool.query(
        "SELECT c.*, COALESCE(SUM(i.amount-i.paid_amount),0) AS balance FROM customers c LEFT JOIN invoices i ON i.customer_id=c.id GROUP BY c.id ORDER BY c.id",
      )
    ).rows,
  ),
);
route("get", "/customers/:id/messages", async (req, res) =>
  res.json(
    (
      await pool.query(
        "SELECT * FROM outbox WHERE customer_id=$1 ORDER BY id",
        [id(req.params.id)],
      )
    ).rows,
  ),
);
route("get", "/customers/:id/invoices", async (req, res) =>
  res.json(
    (
      await pool.query(
        "SELECT * FROM invoices WHERE customer_id=$1 ORDER BY due_date,id",
        [id(req.params.id)],
      )
    ).rows,
  ),
);
route("get", "/customers/:id/orders", async (req, res) =>
  res.json(
    (
      await pool.query(
        "SELECT * FROM orders WHERE customer_id=$1 ORDER BY id DESC",
        [id(req.params.id)],
      )
    ).rows,
  ),
);
route("get", "/customers/:id/offers", async (req, res) =>
  res.json(
    (
      await pool.query(
        "SELECT * FROM offers WHERE customer_id=$1 ORDER BY id DESC",
        [id(req.params.id)],
      )
    ).rows,
  ),
);
route("post", "/payments", async (req, res) =>
  res.json(
    await transaction(async (db) => {
      const invoiceId = id(req.body.invoice_id);
      const amount = Number(req.body.amount);
      if (
        !Number.isFinite(amount) ||
        amount <= 0 ||
        Math.abs(Math.round(amount * 100) - amount * 100) > 0.000001
      )
        fail("amount must be positive with at most two decimal places");
      const i = (
        await db.query("SELECT * FROM invoices WHERE id=$1 FOR UPDATE", [
          invoiceId,
        ])
      ).rows[0];
      if (!i) fail("Invoice not found", 404);
      const date = await today(db);
      const balance = Number(i.amount) - Number(i.paid_amount);
      if (amount > balance) fail("Payment exceeds remaining balance");
      let discount = 0;
      if (req.body.redeem_offer === true) {
        const o = (
          await db.query(
            "SELECT * FROM offers WHERE invoice_id=$1 AND kind='early_payment' AND NOT used AND expires_date >= $2",
            [i.id, date],
          )
        ).rows[0];
        if (!o) fail("No eligible early-payment offer");
        discount =
          Math.round(
            Number(i.amount) * offerConfig.early_payment.discountPercent,
          ) / 100;
        if (Math.abs(amount + discount - balance) > 0.001)
          fail("Discount requires full settlement of the remaining balance");
        await db.query("UPDATE offers SET used=true WHERE id=$1", [o.id]);
      }
      const paid = Number(i.paid_amount) + amount + discount;
      await db.query("UPDATE invoices SET paid_amount=$1 WHERE id=$2", [
        paid,
        i.id,
      ]);
      await db.query(
        "INSERT INTO payments(invoice_id,amount,payment_date,discount) VALUES($1,$2,$3,$4)",
        [i.id, amount, date, discount],
      );
      if (Math.abs(paid - Number(i.amount)) < 0.001)
        await resolveInvoice(db, i.id, date);
      return { ok: true, remaining: Number(i.amount) - paid, discount };
    }),
  ),
);
route("post", "/webhook/incoming", async (req, res) =>
  res.json(
    await transaction(async (db) => {
      const cid = id(req.body.customer_id);
      const text = String(req.body.text || "")
        .trim()
        .toUpperCase();
      if (!/^(PAID|DISPUTE|STOP|YES|PROMISE \d{4}-\d{2}-\d{2})$/.test(text))
        fail("Use PAID, PROMISE YYYY-MM-DD, DISPUTE, STOP or YES");
      const c = (await db.query("SELECT * FROM customers WHERE id=$1", [cid]))
        .rows[0];
      if (!c) fail("Customer not found", 404);
      const date = await today(db);
      let invoices = (
        await db.query(
          "SELECT * FROM invoices WHERE customer_id=$1 AND paid_amount<amount ORDER BY due_date,id",
          [cid],
        )
      ).rows;
      if (req.body.invoice_id) {
        const target = id(req.body.invoice_id);
        invoices = invoices.filter((i) => i.id === target);
        if (!invoices.length)
          fail("Unpaid invoice does not belong to this customer");
      }
      if (text.startsWith("PROMISE")) {
        const promised = text.slice(8);
        if (
          Number.isNaN(Date.parse(promised)) ||
          day(new Date(promised)) !== promised ||
          promised < date
        )
          fail("Promise date must be a real date on or after today");
        for (const i of invoices) {
          await db.query("UPDATE invoices SET promise_date=$1 WHERE id=$2", [
            promised,
            i.id,
          ]);
          await openCase(db, c, i.id, "promise", date, "waiting");
        }
      }
      if (text === "DISPUTE")
        for (const i of invoices) {
          await db.query("UPDATE invoices SET disputed=true WHERE id=$1", [
            i.id,
          ]);
          await openCase(db, c, i.id, "dispute", date);
        }
      if (text === "STOP") {
        await db.query("UPDATE customers SET stopped=true WHERE id=$1", [cid]);
        if (!c.stopped)
          await notify(
            db,
            cid,
            null,
            date,
            `${c.name} opted out. ${c.salesperson}: follow up personally.`,
          );
      }
      if (text === "PAID")
        await notify(
          db,
          cid,
          null,
          date,
          `${c.name} reports PAID. Verify the transfer and record a payment; balance is unchanged.`,
        );
      let draft = null;
      if (text === "YES") {
        if (c.stopped) fail("Customer has opted out");
        const r = (
          await db.query(
            "SELECT r.*,o.items FROM reorder_sends r JOIN orders o ON o.id=r.order_id WHERE o.customer_id=$1 AND NOT r.accepted ORDER BY r.sent_date DESC LIMIT 1",
            [cid],
          )
        ).rows[0];
        if (r) {
          draft = (
            await db.query(
              "INSERT INTO orders(customer_id,order_date,items,status) VALUES($1,$2,$3,'draft') RETURNING *",
              [cid, date, JSON.stringify(r.items)],
            )
          ).rows[0];
          await db.query(
            "UPDATE reorder_sends SET accepted=true WHERE order_id=$1",
            [r.order_id],
          );
          const cases = (
            await db.query(
              "UPDATE cases SET status='resolved' WHERE customer_id=$1 AND kind='reorder' AND status!='resolved' RETURNING id",
              [cid],
            )
          ).rows;
          for (const k of cases)
            await event(db, k.id, date, "Draft order created");
          const offer = (
            await db.query(
              "UPDATE offers SET used=true WHERE customer_id=$1 AND kind='win_back' AND NOT used AND expires_date >= $2 RETURNING id",
              [cid, date],
            )
          ).rows[0];
          await notify(
            db,
            cid,
            null,
            date,
            `Draft order ${draft.id} created${offer ? ` with ${offerConfig.win_back.coupon} coupon` : ""}`,
          );
        }
      }
      await db.query(
        "INSERT INTO outbox(customer_id,direction,body,kind,status,sent_date) VALUES($1,'incoming',$2,'reply','read',$3)",
        [cid, text, date],
      );
      return { ok: true, draft };
    }),
  ),
);
route("patch", "/messages/:id/status", async (req, res) => {
  if (!["delivered", "read"].includes(req.body.status))
    fail("status must be delivered or read");
  const r = await pool.query(
    "UPDATE outbox SET status=$1 WHERE id=$2 AND direction='outgoing' AND (status='sent' OR $1='read') RETURNING *",
    [req.body.status, id(req.params.id)],
  );
  if (!r.rowCount)
    fail("Outgoing message not found or status would move backwards", 404);
  res.json(r.rows[0]);
});
route("get", "/cases", async (req, res) =>
  res.json(
    (
      await pool.query(
        "SELECT c.*,u.name AS customer_name,COALESCE((SELECT json_agg(e ORDER BY e.id) FROM case_events e WHERE e.case_id=c.id),'[]') AS timeline FROM cases c JOIN customers u ON u.id=c.customer_id ORDER BY c.id DESC",
      )
    ).rows,
  ),
);
route("get", "/notifications", async (req, res) =>
  res.json(
    (await pool.query("SELECT * FROM notifications ORDER BY id DESC")).rows,
  ),
);
route("get", "/dashboard", async (req, res) =>
  res.json(
    (
      await pool.query(
        "SELECT COALESCE(SUM(amount-paid_amount),0) AS outstanding,COALESCE(SUM(amount-paid_amount) FILTER(WHERE due_date<(SELECT today FROM clock)),0) AS overdue,COUNT(*) FILTER(WHERE paid_amount<amount) AS unpaid FROM invoices",
      )
    ).rows[0],
  ),
);
