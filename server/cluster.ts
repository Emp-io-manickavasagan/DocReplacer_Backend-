import cluster from 'cluster';
import os from 'os';

// Cluster configuration for production performance
export function setupCluster() {
  const numCPUs = os.cpus().length;
  const maxWorkers = Math.min(numCPUs, 4); // Limit to 4 workers max for memory efficiency

  if (cluster.isPrimary) {
    // Fork workers
    for (let i = 0; i < maxWorkers; i++) {
      cluster.fork();
    }

    // Handle worker exit
    cluster.on('exit', (worker, code, signal) => {
      cluster.fork();
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      for (const id in cluster.workers) {
        const worker = cluster.workers[id];
        if (worker) {
          worker.kill('SIGTERM');
        }
      }
      
      setTimeout(() => {
        process.exit(0);
      }, 10000);
    });

    process.on('SIGINT', () => {
      for (const id in cluster.workers) {
        const worker = cluster.workers[id];
        if (worker) {
          worker.kill('SIGINT');
        }
      }
      
      setTimeout(() => {
        process.exit(0);
      }, 10000);
    });

    return false; // Don't start the server in master process
  } else {
    return true; // Start the server in worker process
  }
}

// Memory monitoring for workers
export function monitorWorkerMemory() {
  const checkInterval = 30000; // Check every 30 seconds
  const warningThreshold = 200; // 200MB warning
  const criticalThreshold = 500; // 500MB critical
  
  setInterval(() => {
    const memUsage = process.memoryUsage();
    const memUsageMB = {
      rss: Math.round(memUsage.rss / 1024 / 1024),
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
      external: Math.round(memUsage.external / 1024 / 1024)
    };

    // Force restart if memory usage is too high
    if (memUsageMB.heapUsed > criticalThreshold) {
      process.exit(1);
    }
  }, checkInterval);
}