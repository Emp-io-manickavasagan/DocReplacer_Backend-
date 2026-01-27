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

// Main server initialization function
async function startServer() {
  try {
    console.log('🚀 Starting server initialization...');
    
    // Use clustering in production for better performance (but not on cloud platforms)
    const isCloudPlatform = process.env.RENDER || 
                           process.env.VERCEL || 
                           process.env.NETLIFY || 
                           process.env.RAILWAY_ENVIRONMENT ||
                           process.env.FLY_APP_NAME ||
                           process.env.HEROKU_APP_NAME;

    console.log(`📍 Environment: ${process.env.NODE_ENV}, Cloud Platform: ${isCloudPlatform ? 'Yes' : 'No'}`);

    if (process.env.NODE_ENV === 'production' && 
        process.env.DISABLE_CLUSTER !== 'true' && 
        !isCloudPlatform) {
      const shouldStartServer = setupCluster();
      if (!shouldStartServer) {
        // This is the master process, don't continue with server setup
        console.log('🔧 Master process started, workers will handle requests');
        return; // Exit the function, don't start server in master
      }
      // This is a worker process, continue with server setup
      console.log('👷 Worker process starting...');
      monitorWorkerMemory();
    } else if (process.env.NODE_ENV === 'production') {
      // On cloud platforms, just monitor memory without clustering
      console.log('☁️ Cloud platform detected, starting single process');
      monitorWorkerMemory();
    }

    // Validate required environment variables
    console.log('🔍 Validating environment variables...');
    const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'JWT_SECRET'];

    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        console.error(`❌ Missing required environment variable: ${envVar}`);
        process.exit(1);
      }
    }
    console.log('✅ Environment variables validated');

    // Validate JWT_SECRET strength
    if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
      console.error('❌ JWT_SECRET must be at least 32 characters long');
      process.exit(1);
    console.log('✅ JWT_SECRET validated');

    console.log('🏗️ Creating Express app...');
    const app = express();
    const httpServer = createServer(app);

    console.log('⚡ Setting up middleware...');
    // Performance optimizations
    app.use(compression({
      level: 6, // Good balance between compression and CPU usage
      threshold: 1024, // Only compress responses > 1KB
      filter: (req, res) => {
        // Don't compress if client doesn't support it
        if (req.headers['x-no-compression']) {
          return false;
        }
        // Use compression for all other responses
        return compression.filter(req, res);
      }
    }));

    // Performance monitoring
    app.use(performanceMonitoring);

    // Security middleware - must be first
    app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'", "https://api.docreplacer.online", "https://docreplacer-backend.onrender.com"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false, // Allow file downloads
    }));

  // Trust proxy for Render deployment
  app.set('trust proxy', 1);

  // Optimize Express settings for performance
  app.set('x-powered-by', false); // Remove X-Powered-By header
  app.set('etag', 'strong'); // Enable strong ETags for better caching
  app.set('json spaces', 0); // Minimize JSON output

  // Rate limiting - optimized for performance
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: process.env.NODE_ENV === 'production' ? 500 : 200, // Increased limits for better UX
    message: { error: 'Too many requests from this IP, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
      // Skip rate limiting for health checks and static assets
      return req.path === '/health' || req.path.startsWith('/static/');
    },
    // Use memory store for better performance (default)
    store: undefined
  });

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: process.env.NODE_ENV === 'production' ? 20 : 10, // Increased for better UX
    message: { error: 'Too many authentication attempts, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use('/api/auth', authLimiter);
  app.use('/api', limiter);

  app.use((req, res, next) => {
    const allowedOrigins = process.env.NODE_ENV === 'production'
      ? [
        'https://docreplacer.vercel.app',
        'https://docreplacer-frontend.onrender.com',
        'https://docreplacer.netlify.app',
        'https://www.docreplacer.online',
        'https://docreplacer.online'
      ]
      : [
        'https://www.docreplacer.online',
        'https://docreplacer.online'
      ];

    const origin = req.headers.origin;

    // Allow origins based on environment
    if (allowedOrigins.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
    } else {
      res.header('Access-Control-Allow-Origin', 'https://www.docreplacer.online');
    }

    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With, X-Browser-ID');
    res.header('Access-Control-Allow-Credentials', 'true');

    // Additional security headers
    res.header('X-Content-Type-Options', 'nosniff');
    res.header('X-Frame-Options', 'DENY');
    res.header('X-XSS-Protection', '1; mode=block');
    res.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    res.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    
    // Remove server information
    res.removeHeader('X-Powered-By');

    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
    } else {
      next();
    }
  });

  app.use(express.json({
    limit: '10mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }));

  app.use(express.urlencoded({ 
    extended: false, 
    limit: '10mb',
    parameterLimit: 1000 // Limit number of parameters for security and performance
  }));

  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    let capturedJsonResponse: Record<string, any> | undefined = undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };

    res.on("finish", () => {
      const duration = Date.now() - start;
      if (path.startsWith("/api")) {
        let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
        if (capturedJsonResponse) {
          logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
        }

        log(logLine);
      }
    });

    next();
  });

  try {
    console.log('🔌 Connecting to database...');
    // Connect to Supabase
    await connectDB();
    console.log('✅ Database connected successfully');

    console.log('🛣️ Registering routes...');
    // Add immediate health check before other routes
    app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development'
      });
    });
    
    // Register routes
    await registerRoutes(httpServer, app);
    console.log('✅ Routes registered successfully');

    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      
      console.error('❌ Express error handler:', { status, message: err.message });
      res.status(status).json({ message });
    });

    // Setup static file serving in production
    if (process.env.NODE_ENV === "production") {
      console.log('📁 Setting up static file serving...');
      serveStatic(app);
    }

    // ALWAYS serve the app on the port specified in the environment variable PORT
    // Other ports are firewalled. Default to 5000 if not specified.
    // this serves both the API and the client.
    // It is the only port that is not firewalled.
    const port = parseInt(process.env.PORT || "5000", 10);
    console.log(`🚀 Starting server on port ${port}...`);

    // Server optimization settings
    httpServer.keepAliveTimeout = 65000; // Slightly higher than load balancer timeout
    httpServer.headersTimeout = 66000; // Should be higher than keepAliveTimeout
    httpServer.maxHeadersCount = 1000; // Limit headers for security and performance
    httpServer.timeout = 30000; // 30 second timeout for requests

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('📴 Received SIGTERM, shutting down gracefully...');
      httpServer.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      console.log('📴 Received SIGINT, shutting down gracefully...');
      httpServer.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
      });
    });

    httpServer.listen(port, "0.0.0.0", () => {
      console.log(`🎉 Server successfully started on port ${port}`);
      console.log(`🌐 Server is ready to accept connections`);
      log(`serving on port ${port}`);
      
      // Signal successful startup
      if (process.send) {
        process.send('server-started');
      }
    });
  } catch (error) {
    console.error('💥 Fatal error during server startup:', error);
    console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace available');
    process.exit(1);
  }
  } catch (error) {
    console.error('💥 Fatal error in startServer function:', error);
    console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace available');
    process.exit(1);
  }
}

// Module declarations
declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// Utility functions
export function log(message: string, source = "express") {
  // Always log in development, silent in production unless it's a startup message
  if (process.env.NODE_ENV !== 'production' || message.includes('serving on port')) {
    console.log(`[${source}] ${message}`);
  }
}

// Start the server
startServer().catch((error) => {
  console.error('💥 Failed to start server:', error);
  console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace available');
  process.exit(1);
});

// Add startup timeout to prevent hanging
const startupTimeout = setTimeout(() => {
  console.error('💥 Server startup timeout (60s) - forcing exit');
  process.exit(1);
}, 60000); // 60 second timeout

// Clear timeout once server starts successfully
process.on('message', (msg) => {
  if (msg === 'server-started') {
    clearTimeout(startupTimeout);
  }
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Promise Rejection:', reason);
  console.error('Promise:', promise);
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  console.error('Stack trace:', error.stack);
  process.exit(1);
});

// Handle warnings
process.on('warning', (warning) => {
  console.warn('⚠️ Warning:', warning.message);
  if (warning.stack) {
    console.warn('Stack trace:', warning.stack);
  }
});
