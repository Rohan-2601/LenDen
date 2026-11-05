import { readFileSync } from "node:fs";
import { today, gap, day } from "./clock.js";
import { MockProvider } from "../providers/mockProvider.js";
import { openCase, escalate, escalateAged } from "./cases.js";
import { offerCandidate, saveOffer } from "./offers.js";
import { reorderCandidate } from "./reorder.js";
export const stages = JSON.parse(
  readFileSync(new URL("../../config/stages.json", import.meta.url)),
).stages.sort((a, b) => a.dayOffset - b.dayOffset);
export async function runEngine(db, provider = new MockProvider()) {
  const date = await today(db);
  await escalateAged(db, date);
  const customers = (await db.query("SELECT * FROM customers ORDER BY id"))
    .rows;
  for (const c of customers) {
    if (c.stopped) continue;
    const invoices = (
      await db.query(
        "SELECT * FROM invoices WHERE customer_id=$1 ORDER BY due_date,id",
        [c.id],
      )
    ).rows;
    const orders = (
      await db.query(
        "SELECT * FROM orders WHERE customer_id=$1 AND status='completed' ORDER BY order_date,id",
        [c.id],
      )
    ).rows;
    const unpaid = invoices.filter(
      (i) => Number(i.amount) > Number(i.paid_amount),
    );
    const pending = [];
    for (const i of unpaid) {
      if (i.disputed || (i.promise_date && date < day(i.promise_date)))
        continue;
      let index = stages.findLastIndex(
        (s) => gap(date, i.due_date) >= s.dayOffset,
      );
      if (i.promise_date && date >= day(i.promise_date)) {
        const previous = (
          await db.query("SELECT stage FROM stage_sends WHERE invoice_id=$1", [
            i.id,
          ])
        ).rows;
        const last = Math.max(
          -1,
          ...previous.map((r) => stages.findIndex((s) => s.name === r.stage)),
        );
        index = Math.min(stages.length - 1, Math.max(index, 3, last + 1));
      }
      if (index < 0) continue;
      const s = stages[index];
      if (
        (
          await db.query(
            "SELECT 1 FROM stage_sends WHERE invoice_id=$1 AND stage=$2",
            [i.id, s.name],
          )
        ).rowCount
      )
        continue;
      pending.push({ i, s, index });
    }
    // Payment always takes priority; suppressed offers and reorder reminders are not consumed.
    if (pending.length) {
      const body = pending
        .map(({ i, s }) =>
          s.template.replace(
            /\{(\w+)\}/g,
            (_, key) =>
              ({
                name: c.name,
                invoice_no: i.invoice_no,
                balance: (Number(i.amount) - Number(i.paid_amount)).toFixed(2),
                due_date: day(i.due_date),
              })[key],
          ),
        )
        .join("\n");
      const sent = await provider.send(db, c.id, body, "payment", date);
      if (sent)
        for (const { i, index } of pending) {
          if (i.promise_date)
            await db.query(
              "UPDATE invoices SET promise_date=NULL WHERE id=$1",
              [i.id],
            );
          for (const stage of stages.slice(0, index + 1))
            await db.query(
              "INSERT INTO stage_sends VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
              [i.id, stage.name, date],
            );
          if (index >= 3) {
            const row = await openCase(db, c, i.id, "collection", date);
            if (i.promise_date && row.status === "waiting") {
              await db.query(
                "UPDATE cases SET status='open',status_since=$2 WHERE id=$1",
                [row.id, date],
              );
              row.status = "open";
            }
            if (index === 4)
              await escalate(
                db,
                row,
                date,
                "Final notice: 15 or more days overdue",
              );
          }
        }
      continue;
    }
    // Offers enforce their own eligibility; overdue accounts cannot receive reorders.
    const offer = await offerCandidate(db, c, invoices, orders, date);
    if (offer) {
      if (await provider.send(db, c.id, offer.body, "offer", date))
        await saveOffer(db, c, offer);
      continue;
    }
    if (unpaid.some((i) => gap(date, i.due_date) > 0)) continue;
    const reorder = await reorderCandidate(db, c, orders, date);
    if (
      reorder &&
      (await provider.send(db, c.id, reorder.body, "reorder", date))
    )
      await db.query(
        "INSERT INTO reorder_sends(order_id,sent_date) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [reorder.order, date],
      );
  }
  return date;
}
