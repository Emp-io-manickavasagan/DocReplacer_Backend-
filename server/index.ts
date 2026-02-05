import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
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
    const isCloudPlatform =
      process.env.RENDER ||
      process.env.VERCEL ||
      process.env.NETLIFY ||
      process.env.RAILWAY_ENVIRONMENT ||
      process.env.FLY_APP_NAME ||
      process.env.HEROKU_APP_NAME;

    if (
      process.env.NODE_ENV === "production" &&
      process.env.DISABLE_CLUSTER !== "true" &&
      !isCloudPlatform
    ) {
      const shouldStartServer = setupCluster();
      if (!shouldStartServer) {
        return;
      }
      monitorWorkerMemory();
    } else if (process.env.NODE_ENV === "production") {
      monitorWorkerMemory();
    }

    const requiredEnvVars = [
      "SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "JWT_SECRET",
    ];

    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        process.exit(1);
      }
    }

    // FIXED BLOCK
    if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
      process.exit(1);
    }

    const app = express();
    const httpServer = createServer(app);

    // CORS configuration - Allow all origins for testing
    app.use(cors({
      origin: true, // Allow all origins
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Browser-ID', 'X-Requested-With'],
      optionsSuccessStatus: 200
    }));

    // Handle preflight requests explicitly
    app.options('*', cors());

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
      await connectDB();

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
        if (process.send) process.send("server-started");
      });
    } catch (error) {
      process.exit(1);
    }
  } catch (error) {
    process.exit(1);
  }
}

export function log(message: string) {
  // Silent logging - no console output
}

process.on("unhandledRejection", (reason) => {
  process.exit(1);
});

process.on("uncaughtException", (error) => {
  process.exit(1);
});

startServer().catch((err) => {
  process.exit(1);
});
