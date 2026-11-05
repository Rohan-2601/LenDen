"use client";
import { useEffect, useState, useRef } from "react";
const base = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const money = (n) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(n || 0));
const date = (s) =>
  s
    ? new Date(s).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      })
    : "—";
async function api(path, body, method = "POST") {
  const r = await fetch(
    base + path,
    body === undefined
      ? { cache: "no-store" }
      : {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Request failed");
  return data;
}
export default function Workspace({ staff = false }) {
  const [customers, setCustomers] = useState([]),
    [selected, setSelected] = useState(1),
    [messages, setMessages] = useState([]),
    [invoices, setInvoices] = useState([]),
    [orders, setOrders] = useState([]),
    [cases, setCases] = useState([]),
    [notifications, setNotifications] = useState([]),
    [clock, setClock] = useState(null),
    [stats, setStats] = useState({}),
    [reply, setReply] = useState(""),
    [search, setSearch] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [pay, setPay] = useState(false),
    [invoice, setInvoice] = useState(""),
    [amount, setAmount] = useState(""),
    [discount, setDiscount] = useState(false),
    [days, setDays] = useState("3");
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  async function refresh() {
    const [cs, cl, st, ca, no] = await Promise.all(
      ["/customers", "/clock", "/dashboard", "/cases", "/notifications"].map(
        (p) => api(p),
      ),
    );
    setCustomers(cs);
    setClock(cl.today);
    setStats(st);
    setCases(ca);
    setNotifications(no);
  }
  async function chat() {
    const cid = selected;
    const [ms, ins, os] = await Promise.all(
      [
        `/customers/${cid}/messages`,
        `/customers/${cid}/invoices`,
        `/customers/${cid}/orders`,
      ].map((p) => api(p)),
    );
    if (selectedRef.current !== cid) return;
    setMessages(ms);
    setInvoices(ins);
    setOrders(os);
  }
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    setMessages([]);
    setInvoices([]);
    setOrders([]);
    let active = true;
    Promise.all(
      [
        `/customers/${selected}/messages`,
        `/customers/${selected}/invoices`,
        `/customers/${selected}/orders`,
      ].map((p) => api(p)),
    )
      .then(([m, i, o]) => {
        if (active) {
          setMessages(m);
          setInvoices(i);
          setOrders(o);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [selected]);
  async function act(fn, message) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await Promise.all([refresh(), chat()]);
      setNotice(message);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const customer = customers.find((c) => c.id === selected);
  const unpaid = invoices.filter(
    (i) => Number(i.amount) > Number(i.paid_amount),
  );
  function openPayment() {
    setInvoice(String(unpaid[0]?.id || ""));
    setAmount(
      unpaid[0]
        ? String(Number(unpaid[0].amount) - Number(unpaid[0].paid_amount))
        : "",
    );
    setDiscount(false);
    setPay(true);
  }
  return (
    <div className="shell">
      <aside className="rail">
        <a href="/" className="brand">
          <span className="logo">
            l<span>↗</span>
          </span>
          LenDen<span className="brand-dot">.</span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <a className={!staff ? "nav active" : "nav"} href="/">
          <span>◫</span> Customer inbox <b>10</b>
        </a>
        <a className={staff ? "nav active" : "nav"} href="/staff">
          <span>▦</span> Staff & cases{" "}
          {cases.filter((c) => c.status !== "resolved").length > 0 && (
            <b>{cases.filter((c) => c.status !== "resolved").length}</b>
          )}
        </a>
        <div className="rail-bottom">
          <div className="sandbox">
            <span className="green-dot" /> LOCAL SANDBOX
            <p>Mock messages. Real workflows.</p>
          </div>
          <div className="profile">
            <span className="avatar small">AM</span>
            <div>
              Arjun Mehta<small>Wholesale operations</small>
            </div>
          </div>
        </div>
      </aside>
      <main>
        <header>
          <div className="breadcrumb">
            Workspace <span>/</span>{" "}
            {staff ? "Staff & cases" : "Customer inbox"}
          </div>
          <div className="clock">
            <span>◷ Simulated today</span>
            <strong>{date(clock)}</strong>
          </div>
        </header>
        <section className="content">
          <div className="heading">
            <div>
              <div className="eyebrow">CUSTOMER RELATIONSHIPS, ON TRACK</div>
              <h1>
                {staff
                  ? "A clear view of every follow-up."
                  : "Good business starts with a conversation."}
              </h1>
              <p>
                {staff
                  ? "Keep ownership clear and move stuck accounts forward."
                  : "Follow up on payments, keep customers close, and make the next order happen."}
              </p>
            </div>
            <button
              className="subtle"
              disabled={busy}
              onClick={() =>
                act(
                  () => api("/seed/reset", {}),
                  "Demo data reset to 5 November 2026.",
                )
              }
            >
              ↻ Reset demo
            </button>
          </div>
          <div className="metrics">
            <Metric
              label="TOTAL OUTSTANDING"
              value={money(stats.outstanding)}
              sub="Across all customer accounts"
            />
            <Metric
              label="OVERDUE BALANCE"
              value={money(stats.overdue)}
              sub="Ready for a timely follow-up"
              accent
            />
            <Metric
              label="ACTIVE CASES"
              value={cases.filter((c) => c.status !== "resolved").length}
              sub={`${cases.filter((c) => c.status === "escalated").length} escalated to manager`}
            />
            <Metric
              label="CUSTOMER ACCOUNTS"
              value={customers.length}
              sub={`${customers.filter((c) => c.stopped).length} opted out of messages`}
            />
          </div>
          <div className="simulation">
            <div>
              <span className="sim-icon">◷</span>
              <div>
                <strong>Your business, on fast-forward</strong>
                <p>
                  Advance the clock to run payment stages, offers, and reorder
                  checks.
                </p>
              </div>
            </div>
            <div className="clock-actions">
              <select
                aria-label="Days to advance"
                value={days}
                onChange={(e) => setDays(e.target.value)}
              >
                <option value="0">Run today</option>
                <option value="1">+1 day</option>
                <option value="3">+3 days</option>
                <option value="7">+7 days</option>
                <option value="15">+15 days</option>
              </select>
              <button
                disabled={busy}
                onClick={() =>
                  act(
                    () => api(`/clock/advance?days=${days}`, {}),
                    "Clock updated. All customer workflows checked.",
                  )
                }
              >
                {busy ? "Working…" : "Run simulation"} <span>→</span>
              </button>
            </div>
          </div>
          {error && (
            <div className="alert error" role="alert">
              {error}. Check that the API and database are running.
            </div>
          )}
          {notice && (
            <div className="alert" role="status">
              {notice}
            </div>
          )}
          {staff ? (
            <div className="staff-grid">
              <section className="panel">
                <div className="panel-title">
                  <h2>Cases & ownership</h2>
                  <span className="badge">{cases.length} cases</span>
                </div>
                {!cases.length && (
                  <Empty
                    title="A clean slate"
                    text="Run the simulation to open collection cases and escalations."
                  />
                )}
                {cases.map((c) => (
                  <article className="case" key={c.id}>
                    <div className="case-top">
                      <div>
                        <small>
                          CASE #{c.id} · {c.kind.toUpperCase()}
                        </small>
                        <h3>{c.customer_name}</h3>
                      </div>
                      <span className={"badge " + c.status}>{c.status}</span>
                    </div>
                    <p>
                      Owner: <strong>{c.owner}</strong> · Opened{" "}
                      {date(c.created_date)}
                    </p>
                    <ol className="timeline">
                      {c.timeline.map((e) => (
                        <li key={e.id}>
                          <small>{date(e.event_date)}</small>
                          {e.detail}
                        </li>
                      ))}
                    </ol>
                  </article>
                ))}
              </section>
              <section className="panel">
                <div className="panel-title">
                  <h2>Team notifications</h2>
                  <span className="badge">{notifications.length}</span>
                </div>
                {!notifications.length && (
                  <Empty
                    title="All quiet for now"
                    text="New assignments, customer replies, and escalations appear here."
                  />
                )}
                {notifications.map((n) => (
                  <div className="notification" key={n.id}>
                    <span className="notification-dot" />
                    <div>
                      <p>{n.body}</p>
                      <small>{date(n.created_date)}</small>
                    </div>
                  </div>
                ))}
              </section>
            </div>
          ) : (
            <div className="inbox">
              <section className="customer-list">
                <div className="list-heading">
                  <h2>
                    Messages <span>{customers.length}</span>
                  </h2>
                  <p>Your customer conversations</p>
                  <input
                    aria-label="Search customers"
                    placeholder="⌕  Search customers…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <div className="customers">
                  {customers
                    .filter((c) =>
                      c.name.toLowerCase().includes(search.toLowerCase()),
                    )
                    .map((c, i) => (
                      <button
                        key={c.id}
                        className={
                          "customer " + (selected === c.id ? "selected" : "")
                        }
                        onClick={() => {
                          setSelected(c.id);
                          setNotice("");
                        }}
                      >
                        <span className={"avatar color-" + (i % 4)}>
                          {c.name
                            .split(" ")
                            .slice(0, 2)
                            .map((w) => w[0])
                            .join("")}
                        </span>
                        <span className="customer-copy">
                          <strong>{c.name}</strong>
                          <small>
                            {c.stopped
                              ? "Messages paused · opted out"
                              : c.salesperson}
                          </small>
                        </span>
                        <span className="customer-balance">
                          {money(c.balance)}
                          <small>{c.tier}</small>
                        </span>
                      </button>
                    ))}
                </div>
              </section>
              <section className="conversation">
                <div className="chat-heading">
                  <span className="avatar">
                    {customer?.name
                      .split(" ")
                      .slice(0, 2)
                      .map((w) => w[0])
                      .join("")}
                  </span>
                  <div>
                    <h2>{customer?.name || "Loading customer…"}</h2>
                    <p>
                      {customer?.phone} <span>·</span> {customer?.credit_terms}
                      -day credit
                    </p>
                  </div>
                  <button
                    className="mobile-payment"
                    disabled={!unpaid.length || busy}
                    onClick={openPayment}
                  >
                    + Payment
                  </button>
                  <span className="mock-label">
                    <span className="green-dot" /> Mock WhatsApp
                  </span>
                </div>
                <div className="chat-body">
                  <div className="chat-note">
                    ⌑ Messages stay in this local sandbox. No phone or API key
                    needed.
                  </div>
                  {!messages.length ? (
                    <Empty
                      title="The conversation starts here"
                      text="Run today’s simulation to send eligible reminders, or reply as this customer below."
                    />
                  ) : (
                    messages.map((m) => (
                      <div
                        key={m.id}
                        className={
                          "message " +
                          (m.direction === "incoming" ? "incoming" : "outgoing")
                        }
                      >
                        <small className="message-kind">
                          {m.direction === "incoming"
                            ? "CUSTOMER"
                            : m.kind.toUpperCase()}
                        </small>
                        <p>{m.body}</p>
                        <div className="message-meta">
                          {date(m.sent_date)}{" "}
                          {m.direction === "outgoing" && (
                            <button
                              title="Click to simulate next delivery status"
                              disabled={m.status === "read" || busy}
                              onClick={() =>
                                act(
                                  () =>
                                    api(
                                      `/messages/${m.id}/status`,
                                      {
                                        status:
                                          m.status === "sent"
                                            ? "delivered"
                                            : "read",
                                      },
                                      "PATCH",
                                    ),
                                  "Delivery status updated.",
                                )
                              }
                            >
                              {m.status === "read"
                                ? "✓✓ Read"
                                : m.status === "delivered"
                                  ? "✓✓ Delivered"
                                  : "✓ Sent"}
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <form
                  className="composer"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!reply.trim()) return;
                    act(async () => {
                      await api("/webhook/incoming", {
                        customer_id: selected,
                        text: reply,
                      });
                      setReply("");
                    }, "Customer reply processed.");
                  }}
                >
                  <label htmlFor="reply">REPLY AS CUSTOMER</label>
                  <div className="quick-replies">
                    {["PAID", "DISPUTE", "STOP", "YES"].map((r) => (
                      <button key={r} type="button" onClick={() => setReply(r)}>
                        {r}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        setReply(
                          "PROMISE " +
                            new Date(new Date(clock).getTime() + 3 * 86400000)
                              .toISOString()
                              .slice(0, 10),
                        )
                      }
                    >
                      PROMISE +3 days
                    </button>
                  </div>
                  <div className="reply-input">
                    <input
                      id="reply"
                      placeholder="Type PAID, PROMISE YYYY-MM-DD, DISPUTE, STOP or YES…"
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                    />
                    <button disabled={busy || !reply.trim()} type="submit">
                      Send ↗
                    </button>
                  </div>
                </form>
              </section>
              <aside className="account">
                <div className="panel-title">
                  <h2>Account details</h2>
                </div>
                <div className="balance-card">
                  <small>OUTSTANDING BALANCE</small>
                  <strong>{money(customer?.balance)}</strong>
                  <span>{unpaid.length} unpaid invoices</span>
                  <button
                    disabled={!unpaid.length || busy}
                    onClick={openPayment}
                  >
                    + Record payment
                  </button>
                </div>
                <div className="account-section">
                  <h3>
                    Invoices <span>{invoices.length}</span>
                  </h3>
                  {invoices.map((i) => (
                    <div className="invoice" key={i.id}>
                      <div>
                        <strong>{i.invoice_no}</strong>
                        <b>{money(Number(i.amount) - Number(i.paid_amount))}</b>
                      </div>
                      <p>Due {date(i.due_date)}</p>
                      <span
                        className={
                          "badge " +
                          (Number(i.amount) === Number(i.paid_amount)
                            ? "resolved"
                            : i.disputed
                              ? "escalated"
                              : i.promise_date
                                ? "waiting"
                                : new Date(i.due_date) < new Date(clock)
                                  ? "overdue"
                                  : "")
                        }
                      >
                        {Number(i.amount) === Number(i.paid_amount)
                          ? "Paid"
                          : i.disputed
                            ? "Disputed"
                            : i.promise_date
                              ? "Promise · " + date(i.promise_date)
                              : new Date(i.due_date) < new Date(clock)
                                ? "Overdue"
                                : "Upcoming"}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="account-section">
                  <h3>Recent orders</h3>
                  {orders.slice(0, 3).map((o) => (
                    <div className="order" key={o.id}>
                      <strong>
                        Order #{o.id}
                        <span className="badge">{o.status}</span>
                      </strong>
                      <small>{date(o.order_date)}</small>
                      {o.items.map((item, index) => (
                        <p key={index}>
                          {item.quantity} × {item.name}
                        </p>
                      ))}
                    </div>
                  ))}
                </div>
                <div className="account-tip">
                  A little context goes a long way.
                  <p>
                    Payments automatically close related cases. Promises pause
                    reminders until the agreed date.
                  </p>
                </div>
              </aside>
            </div>
          )}
          <footer>
            LenDen <span>·</span> Built for the business behind every
            relationship.
            <span className="footer-right">LOCAL TEST ENVIRONMENT</span>
          </footer>
        </section>
      </main>
      {pay && (
        <div className="modal-backdrop">
          <form
            className="modal"
            onSubmit={(e) => {
              e.preventDefault();
              act(async () => {
                await api("/payments", {
                  invoice_id: Number(invoice),
                  amount: Number(amount),
                  redeem_offer: discount,
                });
                setPay(false);
              }, "Payment recorded. Balance and related cases updated.");
            }}
          >
            <div className="panel-title">
              <h2>Record a payment</h2>
              <button
                type="button"
                className="subtle"
                onClick={() => setPay(false)}
              >
                ✕
              </button>
            </div>
            <p>{customer?.name}</p>
            <label>
              Invoice
              <select
                required
                value={invoice}
                onChange={(e) => {
                  setInvoice(e.target.value);
                  const i = unpaid.find((i) => i.id === Number(e.target.value));
                  setAmount(String(Number(i.amount) - Number(i.paid_amount)));
                  setDiscount(false);
                }}
              >
                {unpaid.map((i) => (
                  <option value={i.id} key={i.id}>
                    {i.invoice_no} ·{" "}
                    {money(Number(i.amount) - Number(i.paid_amount))}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Amount received (INR)
              <input
                required
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={discount}
                onChange={(e) => setDiscount(e.target.checked)}
              />{" "}
              Redeem eligible 2% early-payment offer
            </label>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button disabled={busy} type="submit">
              {busy ? "Saving…" : "Save payment"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
function Metric({ label, value, sub, accent }) {
  return (
    <div className="metric">
      <small>
        {label}
        <span>↗</span>
      </small>
      <strong className={accent ? "accent" : ""}>{value}</strong>
      <p>{sub}</p>
    </div>
  );
}
function Empty({ title, text }) {
  return (
    <div className="empty">
      <div>◌</div>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
