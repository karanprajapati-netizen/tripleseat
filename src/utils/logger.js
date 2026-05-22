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

const isProduction = process.env.NODE_ENV === "production";

// Always log to stdout so Cloud Run / any hosted platform captures output.
// In production use the human-readable format (no color codes for log aggregators).
// In development use the colorized console format.
const logger = createLogger({
  level: process.env.LOG_LEVEL || "info",
  transports: [
    new transports.Console({
      format: isProduction ? humanReadableFormat : consoleFormat
    })
  ],

  exceptionHandlers: [
    new transports.Console({
      format: isProduction ? humanReadableFormat : consoleFormat
    })
  ],

  rejectionHandlers: [
    new transports.Console({
      format: isProduction ? humanReadableFormat : consoleFormat
    })
  ]
});

// Also write to file when running locally (not in production)
if (!isProduction) {
  logger.add(new transports.File({
    filename: path.join(process.cwd(), "logs", "app.log"),
    format: humanReadableFormat,
    maxsize: 10485760, // 10MB
    maxFiles: 5
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