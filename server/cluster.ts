import cluster from 'cluster';
import os from 'os';

// Cluster configuration for production performance
export function setupCluster() {
  const numCPUs = os.cpus().length;
  const maxWorkers = Math.min(numCPUs, 4); // Limit to 4 workers max for memory efficiency

  if (cluster.isPrimary) {
    console.log(`Master ${process.pid} is running`);
    console.log(`Starting ${maxWorkers} workers...`);

    // Fork workers
    for (let i = 0; i < maxWorkers; i++) {
      cluster.fork();
    }

    // Handle worker exit
    cluster.on('exit', (worker, code, signal) => {
      console.log(`Worker ${worker.process.pid} died with code ${code} and signal ${signal}`);
      console.log('Starting a new worker...');
      cluster.fork();
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('Master received SIGTERM, shutting down gracefully...');
      
      for (const id in cluster.workers) {
        const worker = cluster.workers[id];
        if (worker) {
          worker.kill('SIGTERM');
        }
      }
      
      setTimeout(() => {
        console.log('Force shutdown');
        process.exit(0);
      }, 10000);
    });

    return false; // Don't start the server in master process
  } else {
    console.log(`Worker ${process.pid} started`);
    return true; // Start the server in worker process
  }
}

// Memory monitoring for workers
export function monitorWorkerMemory() {
  setInterval(() => {
    const memUsage = process.memoryUsage();
    const memUsageMB = {
      rss: Math.round(memUsage.rss / 1024 / 1024),
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
      external: Math.round(memUsage.external / 1024 / 1024)
    };

    // Log memory usage if it's high
    if (memUsageMB.heapUsed > 200) { // 200MB threshold
      console.warn(`Worker ${process.pid} high memory usage:`, memUsageMB);
    }

    // Force restart if memory usage is too high
    if (memUsageMB.heapUsed > 500) { // 500MB threshold
      console.error(`Worker ${process.pid} memory limit exceeded, restarting...`);
      process.exit(1);
    }
  }, 30000); // Check every 30 seconds
}