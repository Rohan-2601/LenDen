import { gap } from "./clock.js";
import { openCase } from "./cases.js";
export async function reorderCandidate(db, c, orders, date) {
  if (orders.length < 2) return null;
  const last = orders.at(-1);
  const avg = gap(last.order_date, orders[0].order_date) / (orders.length - 1);
  if (gap(date, last.order_date) < Math.max(1, avg * 0.9)) return null;
  const sent = (
    await db.query("SELECT * FROM reorder_sends WHERE order_id=$1", [last.id])
  ).rows[0];
  if (sent) {
    if (!sent.accepted && gap(date, sent.sent_date) >= 2)
      await openCase(db, c, null, "reorder", date);
    return null;
  }
  return {
    order: last.id,
    body: `Hi ${c.name}, time to restock? Your last order: ${last.items.map((i) => `${i.quantity} × ${i.name}`).join(", ")}. Reply YES to create a draft order.`,
  };
}
