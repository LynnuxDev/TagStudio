import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { auth } from "./auth";
import files from "./routes/files";
import fileInfoExtra from "./routes/fileInfoExtra";
import metadata from "./routes/metadata";
import search from "./routes/search";
import users from "./routes/users";
import db from "./db";

const app = new Hono<{
  Variables: {
    user: { id: string; email: string; name?: string } | null;
    session: { id: string } | null;
  };
}>();

app.use(
  "/api/*",
  cors({
    origin: ["http://localhost:5173", "http://localhost:3000"],
    credentials: true,
  }),
);

app.all("/api/auth/*", async (c) => {
  if (c.req.method === "POST" && c.req.path === "/api/auth/sign-up/email") {
    const row = db.prepare("SELECT value FROM global_settings WHERE key = ?").get("disable_signup") as { value: string } | undefined
    if (row?.value === "true") {
      return c.json({ error: "Sign-up is disabled" }, 403)
    }
  }
  return auth.handler(c.req.raw);
});

app.use("/api/files/*", async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  c.set("user", session.user);
  c.set("session", session.session);
  return next();
});

app.use("/api/metadata/*", async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  c.set("user", session.user);
  c.set("session", session.session);
  return next();
});

app.use("/api/search/*", async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  c.set("user", session.user);
  c.set("session", session.session);
  return next();
});

app.use("/api/users/*", async (c, next) => {
  if (c.req.path === "/api/users/global-settings") return next()
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  c.set("user", session.user);
  c.set("session", session.session);
  return next();
});

app.route("/api/files", files);
app.route("/api/files", fileInfoExtra);
app.route("/api/metadata", metadata);
app.route("/api/search", search);
app.route("/api/users", users);

app.use("/*", serveStatic({ root: "./dist/client", index: "index.html" }));

app.get("*", serveStatic({ path: "./dist/client/index.html" }));

export default app;
