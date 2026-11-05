import express from "express";
import cors from "cors";
import { pathToFileURL } from "node:url";
import { router } from "./routes/index.js";
export const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:3000" }));
app.use(express.json({ limit: "32kb" }));
app.get("/health", (req, res) => res.json({ ok: true }));
app.use(router);
app.use((req, res) => res.status(404).json({ error: "Not found" }));
app.use((err, req, res, next) => {
  if (!err.status) console.error(err);
  res
    .status(err.status || 500)
    .json({ error: err.status ? err.message : "Internal server error" });
});
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  app.listen(process.env.PORT || 4000, () =>
    console.log("LenDen API http://localhost:" + (process.env.PORT || 4000)),
  );
