import { pool, transaction } from "../src/db/pool.js";
import { addDays } from "../src/services/clock.js";
import { pathToFileURL } from "node:url";
export async function seed(db) {
  await db.query(
    "TRUNCATE payments,reorder_sends,offers,notifications,case_events,cases,stage_sends,outbox,orders,invoices,customers,clock RESTART IDENTITY CASCADE",
  );
  const now = "2026-11-05";
  await db.query("INSERT INTO clock VALUES(1,$1)", [now]);
  const names = [
    "Mehta General Store",
    "Sharma Supermart",
    "Patel Provisions",
    "Gupta Traders",
    "Singh & Sons",
    "Khan Retail",
    "Joshi Mart",
    "Verma Stores",
    "Rao Essentials",
    "Das Wholesale",
  ];
  for (let i = 0; i < 10; i++) {
    const id = i + 1;
    await db.query(
      "INSERT INTO customers(name,phone,tier,salesperson,credit_terms) VALUES($1,$2,$3,$4,$5)",
      [
        names[i],
        `+9198000000${String(i).padStart(2, "0")}`,
        i % 3 === 0 ? "Gold" : "Silver",
        i % 2 ? "Priya Shah" : "Arjun Mehta",
        i % 2 ? 30 : 15,
      ],
    );
    for (let j = 0; j < 2; j++) {
      const offset = [-10, 0, 3, 7, 15, 3, 7, -2, 20, 1][i] + j;
      const due = addDays(now, -offset);
      const amount = 10000 + 1000 * i + 500 * j;
      await db.query(
        "INSERT INTO invoices(customer_id,invoice_no,amount,paid_amount,issued_date,due_date) VALUES($1,$2,$3,$4,$5,$6)",
        [
          id,
          `INV-${1001 + i * 2 + j}`,
          amount,
          i === 6 ? amount : i === 5 ? amount * 0.4 : 0,
          addDays(due, -(i % 2 ? 30 : 15)),
          due,
        ],
      );
    }
    for (let j = 0; j < 3; j++)
      await db.query(
        "INSERT INTO orders(customer_id,order_date,items) VALUES($1,$2,$3)",
        [
          id,
          addDays(now, -(i === 9 ? 50 : 8 + i * 2) - (2 - j) * 14),
          JSON.stringify([
            { name: "Basmati rice · 25 kg", quantity: 2 + j },
            { name: "Sunflower oil · 1 L", quantity: 12 },
          ]),
        ],
      );
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await transaction(seed);
  await pool.end();
  console.log("Seeded 10 customers, 20 invoices, 30 orders. Today: 2026-11-05");
}
