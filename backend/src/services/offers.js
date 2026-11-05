import { readFileSync } from "node:fs";
import { addDays, gap } from "./clock.js";
export const offerConfig = JSON.parse(
  readFileSync(new URL("../../config/offers.json", import.meta.url)),
);
const config = offerConfig;
export async function offerCandidate(db, c, invoices, orders, date) {
  if (
    invoices.some(
      (i) =>
        Number(i.amount) > Number(i.paid_amount) && gap(date, i.due_date) >= 15,
    )
  )
    return null;
  const existing = (
    await db.query("SELECT kind FROM offers WHERE customer_id=$1", [c.id])
  ).rows.map((r) => r.kind);
  const invoice = invoices.find(
    (i) =>
      gap(date, i.issued_date) === 0 &&
      Number(i.paid_amount) < Number(i.amount),
  );
  if (invoice && !existing.includes("early_payment"))
    return {
      kind: "early_payment",
      invoice: invoice.id,
      expires: addDays(date, config.early_payment.validDays),
      body: `Hi ${c.name}, pay ${invoice.invoice_no} within ${config.early_payment.validDays} days for a ${config.early_payment.discountPercent}% early-payment discount.`,
    };
  if (
    orders.length &&
    gap(date, orders.at(-1).order_date) >= config.win_back.inactiveDays &&
    !existing.includes("win_back")
  )
    return {
      kind: "win_back",
      expires: addDays(date, config.win_back.validDays),
      body: `Hi ${c.name}, we miss you! Use coupon ${config.win_back.coupon} on your next order. Valid until ${addDays(date, config.win_back.validDays)}.`,
    };
  return null;
}
export async function saveOffer(db, c, o) {
  await db.query(
    "INSERT INTO offers(customer_id,invoice_id,kind,expires_date) VALUES($1,$2,$3,$4)",
    [c.id, o.invoice || null, o.kind, o.expires],
  );
}
