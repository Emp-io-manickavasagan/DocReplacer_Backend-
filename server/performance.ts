import NodeCache from 'node-cache';
import { Request, Response, NextFunction } from 'express';

// Cache configuration
const cache = new NodeCache({
  stdTTL: 300, // 5 minutes default TTL
  checkperiod: 60, // Check for expired keys every 60 seconds
  useClones: false, // Better performance, but be careful with object mutations
  maxKeys: 1000 // Limit cache size
});

// Different cache TTLs for different types of data
const CACHE_DURATIONS = {
  USER_DATA: 300, // 5 minutes
  ADMIN_DATA: 180, // 3 minutes
  HEALTH_CHECK: 60, // 1 minute
  STATIC_DATA: 3600, // 1 hour
  DOCUMENTS: 600, // 10 minutes
  PAYMENTS: 300, // 5 minutes
};

// Cache middleware factory
export function cacheMiddleware(duration: number = 300, keyGenerator?: (req: Request) => string) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Skip caching for non-GET requests
    if (req.method !== 'GET') {
      return next();
    }

    // Generate cache key
    const cacheKey = keyGenerator ? keyGenerator(req) : `${req.method}:${req.originalUrl}`;
    
    // Try to get from cache
    const cachedResponse = cache.get(cacheKey);
    if (cachedResponse) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(cachedResponse);
    }

    // Store original json method
    const originalJson = res.json;
    
    // Override json method to cache the response
    res.json = function(body: any) {
      // Cache successful responses only
      if (res.statusCode >= 200 && res.statusCode < 300) {
        cache.set(cacheKey, body, duration);
      }
      res.setHeader('X-Cache', 'MISS');
      return originalJson.call(this, body);
    };

    next();
  };
}

// Specific cache middleware for different endpoints
export const cacheStrategies = {
  // Cache user data for 5 minutes
  userData: cacheMiddleware(CACHE_DURATIONS.USER_DATA, (req) => `user:${(req as any).user?.id}`),
  
  // Cache admin data for 3 minutes
  adminData: cacheMiddleware(CACHE_DURATIONS.ADMIN_DATA, (req) => `admin:${req.originalUrl}`),
  
  // Cache health checks for 1 minute
  healthCheck: cacheMiddleware(CACHE_DURATIONS.HEALTH_CHECK, () => 'health'),
  
  // Cache document lists for 10 minutes
  documents: cacheMiddleware(CACHE_DURATIONS.DOCUMENTS, (req) => `docs:${(req as any).user?.id}`),
  
  // Cache payment data for 5 minutes
  payments: cacheMiddleware(CACHE_DURATIONS.PAYMENTS, (req) => `payments:${(req as any).user?.id}`),
};

// Cache invalidation helpers
export const cacheInvalidation = {
  // Invalidate user-specific cache
  invalidateUser: (userId: string) => {
    const keys = cache.keys();
    keys.forEach(key => {
      if (key.includes(`user:${userId}`) || key.includes(`docs:${userId}`) || key.includes(`payments:${userId}`)) {
        cache.del(key);
      }
    });
  },

  // Invalidate admin cache
  invalidateAdmin: () => {
    const keys = cache.keys();
    keys.forEach(key => {
      if (key.includes('admin:')) {
        cache.del(key);
      }
    });
  },

  // Invalidate all cache
  invalidateAll: () => {
    cache.flushAll();
  },

  // Invalidate specific pattern
  invalidatePattern: (pattern: string) => {
    const keys = cache.keys();
    keys.forEach(key => {
      if (key.includes(pattern)) {
        cache.del(key);
      }
    });
  }
};

// Memory usage monitoring
export function getCacheStats() {
  return {
    keys: cache.keys().length,
    hits: cache.getStats().hits,
    misses: cache.getStats().misses,
    ksize: cache.getStats().ksize,
    vsize: cache.getStats().vsize
  };
}

// Performance monitoring middleware
export function performanceMonitoring(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime.bigint();
  
  res.on('finish', () => {
    const end = process.hrtime.bigint();
    const duration = Number(end - start) / 1000000; // Convert to milliseconds
    
    // Add performance header
    res.setHeader('X-Response-Time', `${duration.toFixed(2)}ms`);
  });
  
  next();
}

// Database connection pooling optimization
export const dbOptimization = {
  // Batch database operations
  batchOperations: async <T>(operations: Promise<T>[]): Promise<T[]> => {
    return Promise.all(operations);
  },

  // Debounce frequent operations
  debounce: <T extends (...args: any[]) => any>(func: T, wait: number): T => {
    let timeout: NodeJS.Timeout;
    return ((...args: any[]) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(null, args), wait);
    }) as T;
  },

  // Throttle operations
  throttle: <T extends (...args: any[]) => any>(func: T, limit: number): T => {
    let inThrottle: boolean;
    return ((...args: any[]) => {
      if (!inThrottle) {
        func.apply(null, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    }) as T;
  }
};

// Memory cleanup
export function memoryCleanup() {
  // Force garbage collection if available
  if (global.gc) {
    global.gc();
  }
  
  // Clean expired cache entries
  cache.flushStats();
}

// Periodic cleanup (run every 10 minutes)
setInterval(memoryCleanup, 10 * 60 * 1000);

// Export cache instance for direct access if needed
export { cache };