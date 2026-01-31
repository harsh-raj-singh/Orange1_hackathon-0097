import { Hono } from "hono";
import { cors } from "hono/cors";

// Import routes
import chatRouter from "./routes/chat";
import graphRouter from "./routes/graph";
import knowledgeRouter from "./routes/knowledge";
import gmailRouter from "./routes/gmail";

// Types for Cloudflare bindings
interface Env {
  DB: D1Database;
  GROQ_API_KEY: string;
  UPSTASH_VECTOR_REST_URL: string;
  UPSTASH_VECTOR_REST_TOKEN: string;
}

const app = new Hono<{ Bindings: Env }>().basePath("/api");

// CORS middleware
app.use(
  cors({
    origin: "*", // In production, specify your domain
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  })
);

// Health check
app.get("/ping", (c) => c.json({ message: `Pong! ${Date.now()}` }));

// Health check with service status
app.get("/health", async (c) => {
  const services = {
    api: "ok",
    database: "unknown",
    llm: c.env.GROQ_API_KEY ? "configured" : "missing",
    vector: c.env.UPSTASH_VECTOR_REST_URL ? "configured" : "missing",
  };

  // Test database connection
  try {
    await c.env.DB.prepare("SELECT 1").first();
    services.database = "ok";
  } catch {
    services.database = "error";
  }

  return c.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    services,
  });
});

// Mount routers
app.route("/chat", chatRouter);
app.route("/graph", graphRouter);
app.route("/knowledge", knowledgeRouter);
app.route("/gmail", gmailRouter);

// 404 handler
app.notFound((c) => {
  return c.json({ error: "Not Found", path: c.req.path }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error("API Error:", err);
  return c.json({ error: "Internal Server Error", message: err.message }, 500);
});

export default app;
