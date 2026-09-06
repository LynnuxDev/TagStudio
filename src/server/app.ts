import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { rateLimiter } from "hono-rate-limiter";
import { auth } from "./auth";
import files from "./routes/files";
import fileInfoExtra from "./routes/fileInfoExtra";
import metadata from "./routes/metadata";
import search from "./routes/search";
import users from "./routes/users";
import db from "./db";

const isDemo = process.env.NODE_ENV === "demo";
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const isDev = process.env.NODE_ENV !== "production" && !isDemo;

function getGlobalSetting(key: string): string | undefined {
  try {
    const row = db.prepare("SELECT value FROM global_settings WHERE key = ?").get(key) as { value: string } | undefined
    return row?.value
  } catch {
    return undefined
  }
}

function isGuestReadEnabled(): boolean {
  return getGlobalSetting("guest_readonly") === "true"
}

/** GET paths an unauthenticated guest may use when guest read-only is on.
 *  Everything else (all mutations, text content, archive listings,
 *  file-info-extras, settings) stays admin-only. */
const GUEST_GET_ALLOW = new Set([
  "/api/files",
  "/api/files/info",
  "/api/files/thumbnail",
  "/api/files/raw",
  "/api/metadata",
  "/api/search",
  "/api/search/tags",
])

const app = new Hono<{
  Variables: {
    user: { id: string; email: string; name?: string } | null;
    session: { id: string } | null;
  };
}>();

app.onError((err, c) => {
  console.error(`[${c.req.method} ${c.req.path}]`, err);

  if (err instanceof HTTPException) {
    return err.getResponse();
  }

  return c.json(
    { error: "Internal server error" },
    500,
  );
});

app.use("*", async (c, next) => {
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("X-XSS-Protection", "0");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  await next();
});

app.get("/api/health", (c) => c.json({ status: "ok" }));

app.get("/api/auth/setup-status", (c) => {
  if (isDemo) {
    return c.json({ needsSetup: false, demo: true });
  }
  const row = db.prepare("SELECT COUNT(*) as count FROM user").get() as { count: number } | undefined;
  return c.json({ needsSetup: !row || row.count === 0 });
});

app.use(
  "/api/*",
  rateLimiter({
    windowMs: 15 * 1000,
    limit: 2000,
    standardHeaders: true,
    keyGenerator: (c) => c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown",
    message: { error: "Too many requests" },
  }),
);

app.use(
  "/api/*",
  cors({
    origin: isDev
      ? ["http://localhost:5173", "http://localhost:3000"]
      : [process.env.ORIGIN || BASE_URL],
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

const requireAuthOrGuest = async (c: any, next: any) => {
  if (isDemo) {
    c.set("user", { id: "demo", email: "demo@tagger.app", name: "Demo User" });
    c.set("session", { id: "demo-session" });
    return next();
  }
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (session) {
    c.set("user", session.user);
    c.set("session", session.session);
    return next();
  }
  // Unauthenticated: allowlisted GETs only, when the admin enabled guest mode.
  if (c.req.method === "GET" && isGuestReadEnabled() && GUEST_GET_ALLOW.has(c.req.path)) {
    c.set("user", null);
    c.set("session", null);
    return next();
  }
  return c.json({ error: "Unauthorized" }, 401);
};

app.use("/api/files/*", async (c: any, next: any) => {
  if (c.req.path === "/api/files/root-status") return next()
  return requireAuthOrGuest(c, next)
});
app.use("/api/metadata/*", requireAuthOrGuest);
app.use("/api/search/*", requireAuthOrGuest);
app.use("/api/users/*", async (c: any, next: any) => {
  if (c.req.path === "/api/users/global-settings" && c.req.method === "GET") return next()
  return requireAuthOrGuest(c, next)
});

app.route("/api/files", files);
app.route("/api/files", fileInfoExtra);
app.route("/api/metadata", metadata);
app.route("/api/search", search);
app.route("/api/users", users);

app.use("/*", serveStatic({ root: "./dist/client", index: "index.html" }));

app.notFound((c) => {
  if (c.req.path.startsWith("/api")) {
    return c.json({ error: "Not found" }, 404);
  }
  return c.html(
    '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>TagStudio</title></head><body><div id="root"></div><script type="module" src="/src/client/main.tsx"></script></body></html>',
    404,
  );
});

export default app;
