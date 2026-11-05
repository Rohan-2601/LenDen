import { MessageProvider } from "./messageProvider.js";
export class MockProvider extends MessageProvider {
  async send(db, customerId, body, kind, date) {
    return (
      await db.query(
        "INSERT INTO outbox(customer_id,body,kind,sent_date) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING *",
        [customerId, body, kind, date],
      )
    ).rows[0];
  }
}
