import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { connectDB } from "./db";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import compression from "compression";
import { performanceMonitoring } from "./performance";
import { setupCluster, monitorWorkerMemory } from "./cluster";

// Extend Express Request interface
declare global {
  namespace Express {
    interface Request {
      rawBody?: Buffer;
    }
  }
}

// Main server initialization function
async function startServer() {
  try {
    console.log("🚀 Starting server initialization...");

    const isCloudPlatform =
      process.env.RENDER ||
      process.env.VERCEL ||
      process.env.NETLIFY ||
      process.env.RAILWAY_ENVIRONMENT ||
      process.env.FLY_APP_NAME ||
      process.env.HEROKU_APP_NAME;

    console.log(
      `📍 Environment: ${process.env.NODE_ENV}, Cloud Platform: ${
        isCloudPlatform ? "Yes" : "No"
      }`
    );

    if (
      process.env.NODE_ENV === "production" &&
      process.env.DISABLE_CLUSTER !== "true" &&
      !isCloudPlatform
    ) {
      const shouldStartServer = setupCluster();
      if (!shouldStartServer) {
        console.log("🔧 Master process started, workers will handle requests");
        return;
      }
      console.log("👷 Worker process starting...");
      monitorWorkerMemory();
    } else if (process.env.NODE_ENV === "production") {
      console.log("☁️ Cloud platform detected, starting single process");
      monitorWorkerMemory();
    }

    console.log("🔍 Validating environment variables...");
    const requiredEnvVars = [
      "SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "JWT_SECRET",
    ];

    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        console.error(`❌ Missing required environment variable: ${envVar}`);
        process.exit(1);
      }
    }
    console.log("✅ Environment variables validated");

    // FIXED BLOCK
    if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
      console.error("❌ JWT_SECRET must be at least 32 characters long");
      process.exit(1);
    }
    console.log("✅ JWT_SECRET validated");

    console.log("🏗️ Creating Express app...");
    const app = express();
    const httpServer = createServer(app);

    app.use(
      compression({
        level: 6,
        threshold: 1024,
        filter: (req, res) => {
          if (req.headers["x-no-compression"]) return false;
          return compression.filter(req, res);
        },
      })
    );

    app.use(performanceMonitoring);

    app.use(
      helmet({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: [
              "'self'",
              "https://api.docreplacer.online",
              "https://docreplacer-backend.onrender.com",
            ],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
          },
        },
        crossOriginEmbedderPolicy: false,
      })
    );

    app.set("trust proxy", 1);
    app.set("x-powered-by", false);
    app.set("etag", "strong");
    app.set("json spaces", 0);

    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: process.env.NODE_ENV === "production" ? 500 : 200,
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) =>
        req.path === "/health" || req.path.startsWith("/static/"),
    });

    const authLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: process.env.NODE_ENV === "production" ? 20 : 10,
      standardHeaders: true,
      legacyHeaders: false,
    });

    app.use("/api/auth", authLimiter);
    app.use("/api", limiter);

    app.use(express.json({ limit: "10mb" }));
    app.use(express.urlencoded({ extended: false, limit: "10mb" }));

    try {
      console.log("🔌 Connecting to database...");
      await connectDB();
      console.log("✅ Database connected");

      app.get("/health", (_req, res) => {
        res.json({
          status: "ok",
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
        });
      });

      await registerRoutes(httpServer, app);

      app.use(
        (err: any, _req: Request, res: Response, _next: NextFunction) => {
          res.status(err.status || 500).json({
            message: err.message || "Internal Server Error",
          });
        }
      );

      if (process.env.NODE_ENV === "production") {
        serveStatic(app);
      }

      const port = parseInt(process.env.PORT || "5000", 10);
      httpServer.listen(port, "0.0.0.0", () => {
        console.log(`🚀 Server running on port ${port}`);
        if (process.send) process.send("server-started");
      });
    } catch (error) {
      console.error("💥 Startup error:", error);
      process.exit(1);
    }
  } catch (error) {
    console.error("💥 Fatal error:", error);
    process.exit(1);
  }
}

export function log(message: string) {
  if (
    process.env.NODE_ENV !== "production" ||
    message.includes("serving on port")
  ) {
    console.log(message);
  }
}

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
  process.exit(1);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  process.exit(1);
});

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
