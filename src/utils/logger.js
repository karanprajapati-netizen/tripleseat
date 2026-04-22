const { createLogger, format, transports } = require("winston");
const path = require("path");

// Human-readable format for single log file
const humanReadableFormat = format.combine(
  format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  format.errors({ stack: true }),
  format.printf(({ timestamp, level, message, ...meta }) => {
    let log = `${timestamp} [${level.toUpperCase()}] ${message}`;
    
    // Add metadata in a readable format
    if (Object.keys(meta).length > 0) {
      log += "\n" + Object.entries(meta)
        .map(([key, value]) => {
          if (typeof value === 'object') {
            return `  ${key}: ${JSON.stringify(value, null, 2)}`;
          }
          return `  ${key}: ${value}`;
        })
        .join('\n');
    }
    
    return log;
  })
);

// Console format for development
const consoleFormat = format.combine(
  format.timestamp({ format: "HH:mm:ss" }),
  format.colorize(),
  format.printf(({ timestamp, level, message, ...meta }) => {
    let log = `${timestamp} [${level}] ${message}`;
    
    if (Object.keys(meta).length > 0) {
      const metaStr = Object.keys(meta).length > 0 ? 
        `\n${JSON.stringify(meta, null, 2)}` : "";
      log += metaStr;
    }
    
    return log;
  })
);

// Create the logger with single file output
const logger = createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: humanReadableFormat,
  transports: [
    // Single main log file
    new transports.File({
      filename: path.join(process.cwd(), "logs", "app.log"),
      maxsize: 10485760, // 10MB
      maxFiles: 5
    })
  ],
  
  // Handle exceptions and rejections
  exceptionHandlers: [
    new transports.File({
      filename: path.join(process.cwd(), "logs", "app.log")
    })
  ],
  
  rejectionHandlers: [
    new transports.File({
      filename: path.join(process.cwd(), "logs", "app.log")
    })
  ]
});

// Add console transport for development
if (process.env.NODE_ENV !== "production") {
  logger.add(new transports.Console({
    format: consoleFormat
  }));
}

// Simple helper methods
logger.webhook = (message, meta = {}) => {
  logger.info(`WEBHOOK: ${message}`, meta);
};

logger.hubspot = (message, meta = {}) => {
  logger.info(`HUBSPOT: ${message}`, meta);
};

logger.tripleseat = (message, meta = {}) => {
  logger.info(`TRIPLESEAT: ${message}`, meta);
};

logger.auth = (message, meta = {}) => {
  logger.info(`AUTH: ${message}`, meta);
};

logger.performance = (operation, duration, meta = {}) => {
  const status = duration > 5000 ? "SLOW" : "OK";
  logger.info(`PERFORMANCE: ${operation} - ${duration}ms [${status}]`, meta);
};

module.exports = logger;