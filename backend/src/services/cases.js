export async function event(db, id, date, detail) {
  await db.query(
    "INSERT INTO case_events(case_id,event_date,detail) VALUES($1,$2,$3)",
    [id, date, detail],
  );
}
export async function notify(db, cid, id, date, body) {
  await db.query(
    "INSERT INTO notifications(customer_id,case_id,created_date,body) VALUES($1,$2,$3,$4)",
    [cid, id, date, body],
  );
}
export async function openCase(db, c, invoice, kind, date, status = "open") {
  let row = (
    await db.query(
      invoice
        ? "SELECT * FROM cases WHERE invoice_id=$1"
        : "SELECT * FROM cases WHERE customer_id=$1 AND kind='reorder' AND status!='resolved'",
      [invoice || c.id],
    )
  ).rows[0];
  if (row) {
    if (kind === "dispute" || kind === "promise") {
      await db.query(
        "UPDATE cases SET kind=$1,status=$2,status_since=$4 WHERE id=$3",
        [kind, status, row.id, date],
      );
      await event(db, row.id, date, `${kind} received`);
    }
    return row;
  }
  row = (
    await db.query(
      "INSERT INTO cases(customer_id,invoice_id,kind,owner,status,created_date,status_since) VALUES($1,$2,$3,$4,$5,$6,$6) RETURNING *",
      [c.id, invoice, kind, c.salesperson, status, date],
    )
  ).rows[0];
  await event(
    db,
    row.id,
    date,
    `${kind} case opened; assigned to ${c.salesperson}`,
  );
  await notify(
    db,
    c.id,
    row.id,
    date,
    `${kind} case assigned to ${c.salesperson}`,
  );
  return row;
}
export async function escalate(db, row, date, reason) {
  if (row.status === "escalated" || row.status === "resolved") return;
  await db.query(
    "UPDATE cases SET status='escalated',owner='Manager',status_since=$2 WHERE id=$1",
    [row.id, date],
  );
  await event(db, row.id, date, reason);
  await notify(
    db,
    row.customer_id,
    row.id,
    date,
    `Manager escalation: ${reason}`,
  );
}
export async function escalateAged(db, date) {
  const rows = (
    await db.query(
      "SELECT * FROM cases WHERE status='open' AND status_since <= $1::date-2",
      [date],
    )
  ).rows;
  for (const row of rows)
    await escalate(db, row, date, "Case open for two simulated days");
}
export async function resolveInvoice(db, id, date) {
  const r = await db.query(
    "UPDATE cases SET status='resolved',status_since=$2 WHERE invoice_id=$1 AND status!='resolved' RETURNING id",
    [id, date],
  );
  for (const c of r.rows)
    await event(db, c.id, date, "Invoice fully paid; case resolved");
}
