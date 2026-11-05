export const day = (value) =>
  typeof value === "string"
    ? value.slice(0, 10)
    : value.toISOString().slice(0, 10);
export const addDays = (date, n) =>
  new Date(new Date(day(date) + "T00:00:00Z").getTime() + n * 86400000)
    .toISOString()
    .slice(0, 10);
export const gap = (a, b) =>
  Math.round((new Date(day(a)) - new Date(day(b))) / 86400000);
export async function today(db) {
  return day(
    (await db.query("SELECT today FROM clock WHERE id=1")).rows[0].today,
  );
}
