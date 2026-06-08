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
    windowMs: 60 * 1000,
    limit: 200,
    standardHeaders: true,
    keyGenerator: (c) => c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown",
    message: { error: "Too many requests" },
  }),
);

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

const requireAuth = async (c: any, next: any) => {
  if (isDemo) {
    c.set("user", { id: "demo", email: "demo@tagger.app", name: "Demo User" });
    c.set("session", { id: "demo-session" });
    return next();
  }
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  c.set("user", session.user);
  c.set("session", session.session);
  return next();
};

app.use("/api/files/*", async (c: any, next: any) => {
  if (c.req.path === "/api/files/root-status") return next()
  return requireAuth(c, next)
});
app.use("/api/metadata/*", requireAuth);
app.use("/api/search/*", requireAuth);
app.use("/api/users/*", async (c: any, next: any) => {
  if (c.req.path === "/api/users/global-settings") return next()
  return requireAuth(c, next)
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
