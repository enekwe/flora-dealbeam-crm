/**
 * Health Check Module
 *
 * Provides comprehensive health check endpoints for Railway and Kubernetes
 * monitoring systems.
 */

import { Request, Response } from 'express';
import mongoose from 'mongoose';
import Redis from 'ioredis';
import { Kafka } from 'kafkajs';

interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  environment: string;
  checks: {
    [key: string]: {
      status: 'pass' | 'fail' | 'warn';
      message?: string;
      responseTime?: number;
      details?: any;
    };
  };
}

interface DependencyHealth {
  mongodb: boolean;
  redis: boolean;
  kafka: boolean;
}

/**
 * Health Check Service
 */
class HealthCheckService {
  private startTime: number;
  private redis?: Redis;
  private kafka?: Kafka;

  constructor() {
    this.startTime = Date.now();
  }

  /**
   * Initialize health check dependencies
   */
  initialize(redis?: Redis, kafka?: Kafka): void {
    this.redis = redis;
    this.kafka = kafka;
  }

  /**
   * Get system uptime in seconds
   */
  private getUptime(): number {
    return Math.floor((Date.now() - this.startTime) / 1000);
  }

  /**
   * Check MongoDB connection health
   */
  private async checkMongoDB(): Promise<{
    status: 'pass' | 'fail';
    message?: string;
    responseTime: number;
    details?: any;
  }> {
    const start = Date.now();

    try {
      const state = mongoose.connection.readyState;
      const responseTime = Date.now() - start;

      const stateMap: { [key: number]: string } = {
        0: 'disconnected',
        1: 'connected',
        2: 'connecting',
        3: 'disconnecting',
      };

      if (state === 1) {
        // Perform a simple ping operation
        await mongoose.connection.db.admin().ping();

        return {
          status: 'pass',
          responseTime: Date.now() - start,
          details: {
            state: stateMap[state],
            host: mongoose.connection.host,
            database: mongoose.connection.name,
          },
        };
      } else {
        return {
          status: 'fail',
          message: `MongoDB is ${stateMap[state]}`,
          responseTime,
          details: {
            state: stateMap[state],
          },
        };
      }
    } catch (error) {
      return {
        status: 'fail',
        message: error instanceof Error ? error.message : 'Unknown error',
        responseTime: Date.now() - start,
      };
    }
  }

  /**
   * Check Redis connection health
   */
  private async checkRedis(): Promise<{
    status: 'pass' | 'fail';
    message?: string;
    responseTime: number;
    details?: any;
  }> {
    if (!this.redis) {
      return {
        status: 'fail',
        message: 'Redis client not initialized',
        responseTime: 0,
      };
    }

    const start = Date.now();

    try {
      const pong = await this.redis.ping();
      const info = await this.redis.info('server');
      const redisVersion = info.match(/redis_version:([^\r\n]+)/)?.[1];

      return {
        status: pong === 'PONG' ? 'pass' : 'fail',
        responseTime: Date.now() - start,
        details: {
          response: pong,
          version: redisVersion,
          status: this.redis.status,
        },
      };
    } catch (error) {
      return {
        status: 'fail',
        message: error instanceof Error ? error.message : 'Unknown error',
        responseTime: Date.now() - start,
      };
    }
  }

  /**
   * Check Kafka connection health
   */
  private async checkKafka(): Promise<{
    status: 'pass' | 'fail' | 'warn';
    message?: string;
    responseTime: number;
    details?: any;
  }> {
    if (!this.kafka) {
      return {
        status: 'warn',
        message: 'Kafka client not initialized',
        responseTime: 0,
      };
    }

    const start = Date.now();

    try {
      const admin = this.kafka.admin();
      await admin.connect();
      const cluster = await admin.describeCluster();
      await admin.disconnect();

      return {
        status: 'pass',
        responseTime: Date.now() - start,
        details: {
          brokers: cluster.brokers.length,
          controllerId: cluster.controller,
        },
      };
    } catch (error) {
      return {
        status: 'fail',
        message: error instanceof Error ? error.message : 'Unknown error',
        responseTime: Date.now() - start,
      };
    }
  }

  /**
   * Perform all health checks
   */
  async performHealthChecks(): Promise<HealthCheckResult> {
    const checks: HealthCheckResult['checks'] = {};

    // Check MongoDB
    checks.mongodb = await this.checkMongoDB();

    // Check Redis
    checks.redis = await this.checkRedis();

    // Check Kafka
    checks.kafka = await this.checkKafka();

    // Check memory usage
    const memoryUsage = process.memoryUsage();
    const totalMemory = memoryUsage.heapTotal;
    const usedMemory = memoryUsage.heapUsed;
    const memoryUsagePercent = (usedMemory / totalMemory) * 100;

    checks.memory = {
      status: memoryUsagePercent < 90 ? 'pass' : 'warn',
      responseTime: 0,
      details: {
        heapUsed: `${Math.round(usedMemory / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(totalMemory / 1024 / 1024)}MB`,
        usage: `${memoryUsagePercent.toFixed(2)}%`,
      },
    };

    // Determine overall status
    const hasFailure = Object.values(checks).some(
      (check) => check.status === 'fail'
    );
    const hasWarning = Object.values(checks).some(
      (check) => check.status === 'warn'
    );

    let status: 'healthy' | 'degraded' | 'unhealthy';
    if (hasFailure) {
      status = 'unhealthy';
    } else if (hasWarning) {
      status = 'degraded';
    } else {
      status = 'healthy';
    }

    return {
      status,
      timestamp: new Date().toISOString(),
      uptime: this.getUptime(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      checks,
    };
  }

  /**
   * Basic liveness probe - just checks if service is running
   */
  async livenessProbe(): Promise<{ status: 'ok'; timestamp: string }> {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Readiness probe - checks if service is ready to accept traffic
   */
  async readinessProbe(): Promise<{
    status: 'ready' | 'not_ready';
    timestamp: string;
    dependencies: DependencyHealth;
  }> {
    const dependencies: DependencyHealth = {
      mongodb: mongoose.connection.readyState === 1,
      redis: this.redis?.status === 'ready',
      kafka: true, // Kafka is optional for readiness
    };

    const isReady = dependencies.mongodb && dependencies.redis;

    return {
      status: isReady ? 'ready' : 'not_ready',
      timestamp: new Date().toISOString(),
      dependencies,
    };
  }

  /**
   * Startup probe - checks if service has finished initializing
   */
  async startupProbe(): Promise<{
    status: 'started' | 'starting';
    timestamp: string;
    uptime: number;
  }> {
    const uptime = this.getUptime();
    const isStarted = uptime > 10 && mongoose.connection.readyState === 1;

    return {
      status: isStarted ? 'started' : 'starting',
      timestamp: new Date().toISOString(),
      uptime,
    };
  }
}

// Singleton instance
const healthCheckService = new HealthCheckService();

/**
 * Express route handlers
 */

/**
 * Main health check endpoint
 * GET /health
 */
export const healthCheck = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const result = await healthCheckService.performHealthChecks();

    const statusCode = result.status === 'healthy' ? 200 :
                       result.status === 'degraded' ? 200 : 503;

    res.status(statusCode).json(result);
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Liveness probe endpoint - for Railway and Kubernetes
 * GET /health/live
 */
export const livenessProbe = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const result = await healthCheckService.livenessProbe();
    res.status(200).json(result);
  } catch (error) {
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Readiness probe endpoint - for Railway and Kubernetes
 * GET /health/ready
 */
export const readinessProbe = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const result = await healthCheckService.readinessProbe();
    const statusCode = result.status === 'ready' ? 200 : 503;
    res.status(statusCode).json(result);
  } catch (error) {
    res.status(503).json({
      status: 'not_ready',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Startup probe endpoint - for Railway and Kubernetes
 * GET /health/startup
 */
export const startupProbe = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const result = await healthCheckService.startupProbe();
    const statusCode = result.status === 'started' ? 200 : 503;
    res.status(statusCode).json(result);
  } catch (error) {
    res.status(503).json({
      status: 'starting',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

export { healthCheckService };
