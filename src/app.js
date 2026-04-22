require("dotenv").config();
const express = require("express");
const logger = require("./utils/logger");
const routes = require("./routes/webhookRoutes");
const auth = require("./services/tripleseatAuthService");

const app = express();

// Request logging middleware
app.use((req, res, next) => {
  const startTime = Date.now();
  
  // Log request
  logger.info("[HTTP_REQUEST] Incoming request", {
    method: req.method,
    url: req.url,
    userAgent: req.get('User-Agent'),
    ip: req.ip,
    requestId: req.headers['x-request-id'] || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  });
  
  // Override res.end to log response
  const originalEnd = res.end;
  res.end = function(chunk, encoding) {
    const processingTime = Date.now() - startTime;
    
    logger.info("[HTTP_RESPONSE] Request completed", {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      processingTime,
      contentLength: res.get('Content-Length')
    });
    
    originalEnd.call(this, chunk, encoding);
  };
  
  next();
});

app.use(express.json({ limit: '10mb' })); // Add limit and logging for large payloads

// Health check endpoint
app.get("/health", async (req, res) => {
  try {
    const authStatus = auth.getAuthStatus();
    const healthStatus = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      environment: process.env.NODE_ENV || 'development',
      version: process.env.npm_package_version || '1.0.0',
      services: {
        tripleseat: {
          authenticated: authStatus.hasToken,
          tokenExpired: authStatus.isTokenExpired,
          tokenRequestCount: authStatus.tokenRequestCount,
          tokenExpiry: authStatus.tokenExpiry,
          timeUntilExpiry: Math.round(authStatus.timeUntilExpiry / 1000) // seconds
        },
        hubspot: {
          hasToken: !!process.env.HUBSPOT_TOKEN,
          tokenLength: process.env.HUBSPOT_TOKEN ? process.env.HUBSPOT_TOKEN.length : 0
        }
      }
    };
    
    // Determine overall health
    const isHealthy = healthStatus.services.tripleseat.authenticated && 
                     !healthStatus.services.tripleseat.tokenExpired &&
                     healthStatus.services.hubspot.hasToken;
    
    if (!isHealthy) {
      healthStatus.status = 'unhealthy';
      return res.status(503).json(healthStatus);
    }
    
    res.json(healthStatus);
  } catch (error) {
    logger.error("[HEALTH_CHECK_ERROR] Health check failed", {
      error: error.message,
      stack: error.stack
    });
    
    res.status(500).json({
      status: 'error',
      message: 'Health check failed',
      error: error.message
    });
  }
});

// Metrics endpoint
app.get("/metrics", (req, res) => {
  const authStatus = auth.getAuthStatus();
  const metrics = {
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    cpu: process.cpuUsage(),
    authentication: {
      tokenRequests: authStatus.tokenRequestCount,
      hasValidToken: authStatus.hasToken && !authStatus.isTokenExpired,
      tokenExpiresAt: authStatus.tokenExpiry
    }
  };
  
  res.json(metrics);
});

app.use("/webhook", routes);

app.get("/", (req, res) => {
  res.json({
    message: "Tripleseat Middleware Running",
    version: process.env.npm_package_version || '1.0.0',
    endpoints: {
      health: "/health",
      metrics: "/metrics",
      webhook: "/webhook"
    }
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  logger.error("[UNHANDLED_ERROR] Unhandled error in express", {
    error: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
    body: req.body
  });
  
  res.status(500).json({
    error: "Internal server error",
    message: process.env.NODE_ENV === 'development' ? error.message : "Something went wrong"
  });
});

// 404 handler
app.use((req, res) => {
  logger.warn("[NOT_FOUND] Route not found", {
    method: req.method,
    url: req.url,
    ip: req.ip
  });
  
  res.status(404).json({
    error: "Not found",
    message: `Route ${req.method} ${req.url} not found`
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  logger.info("[SERVER_START] Server started successfully", {
    port: PORT,
    environment: process.env.NODE_ENV || 'development',
    nodeVersion: process.version,
    platform: process.platform,
    pid: process.pid
  });
  
  console.log(`Tripleseat Middleware running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Metrics: http://localhost:${PORT}/metrics`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('[SERVER_SHUTDOWN] SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('[SERVER_SHUTDOWN] SIGINT received, shutting down gracefully');
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  logger.error('[UNCAUGHT_EXCEPTION] Uncaught exception', {
    error: error.message,
    stack: error.stack
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('[UNHANDLED_REJECTION] Unhandled promise rejection', {
    reason: reason.toString(),
    promise: promise.toString()
  });
  process.exit(1);
});