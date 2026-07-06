/**
 * Prometheus Metrics Module
 *
 * Provides Prometheus-compatible metrics for Railway and external monitoring
 */

import { Request, Response, NextFunction } from 'express';
import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

/**
 * Prometheus Metrics Service
 */
class PrometheusMetricsService {
  private register: Registry;
  private httpRequestDuration: Histogram;
  private httpRequestTotal: Counter;
  private httpRequestErrors: Counter;
  private activeConnections: Gauge;
  private databaseQueryDuration: Histogram;
  private cacheHits: Counter;
  private cacheMisses: Counter;
  private externalApiCalls: Counter;
  private externalApiDuration: Histogram;

  constructor() {
    this.register = new Registry();

    // Collect default metrics (CPU, memory, etc.)
    collectDefaultMetrics({ register: this.register, prefix: 'flora_crm_' });

    // HTTP Request Duration
    this.httpRequestDuration = new Histogram({
      name: 'flora_crm_http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.1, 0.5, 1, 2, 5, 10],
      registers: [this.register],
    });

    // HTTP Request Total
    this.httpRequestTotal = new Counter({
      name: 'flora_crm_http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.register],
    });

    // HTTP Request Errors
    this.httpRequestErrors = new Counter({
      name: 'flora_crm_http_request_errors_total',
      help: 'Total number of HTTP request errors',
      labelNames: ['method', 'route', 'error_type'],
      registers: [this.register],
    });

    // Active Connections
    this.activeConnections = new Gauge({
      name: 'flora_crm_active_connections',
      help: 'Number of active connections',
      registers: [this.register],
    });

    // Database Query Duration
    this.databaseQueryDuration = new Histogram({
      name: 'flora_crm_database_query_duration_seconds',
      help: 'Duration of database queries in seconds',
      labelNames: ['operation', 'collection'],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2],
      registers: [this.register],
    });

    // Cache Hits
    this.cacheHits = new Counter({
      name: 'flora_crm_cache_hits_total',
      help: 'Total number of cache hits',
      labelNames: ['cache_name'],
      registers: [this.register],
    });

    // Cache Misses
    this.cacheMisses = new Counter({
      name: 'flora_crm_cache_misses_total',
      help: 'Total number of cache misses',
      labelNames: ['cache_name'],
      registers: [this.register],
    });

    // External API Calls
    this.externalApiCalls = new Counter({
      name: 'flora_crm_external_api_calls_total',
      help: 'Total number of external API calls',
      labelNames: ['provider', 'operation', 'status'],
      registers: [this.register],
    });

    // External API Duration
    this.externalApiDuration = new Histogram({
      name: 'flora_crm_external_api_duration_seconds',
      help: 'Duration of external API calls in seconds',
      labelNames: ['provider', 'operation'],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
      registers: [this.register],
    });
  }

  /**
   * Express middleware to track HTTP metrics
   */
  metricsMiddleware() {
    return (req: Request, res: Response, next: NextFunction): void => {
      const start = Date.now();

      // Increment active connections
      this.activeConnections.inc();

      // Track response
      res.on('finish', () => {
        const duration = (Date.now() - start) / 1000;
        const route = req.route?.path || req.path;
        const method = req.method;
        const statusCode = res.statusCode.toString();

        // Record duration
        this.httpRequestDuration
          .labels(method, route, statusCode)
          .observe(duration);

        // Record total requests
        this.httpRequestTotal.labels(method, route, statusCode).inc();

        // Record errors
        if (res.statusCode >= 400) {
          const errorType = res.statusCode >= 500 ? 'server_error' : 'client_error';
          this.httpRequestErrors.labels(method, route, errorType).inc();
        }

        // Decrement active connections
        this.activeConnections.dec();
      });

      next();
    };
  }

  /**
   * Track database query performance
   */
  trackDatabaseQuery(operation: string, collection: string, duration: number): void {
    this.databaseQueryDuration
      .labels(operation, collection)
      .observe(duration);
  }

  /**
   * Track cache hit
   */
  trackCacheHit(cacheName: string): void {
    this.cacheHits.labels(cacheName).inc();
  }

  /**
   * Track cache miss
   */
  trackCacheMiss(cacheName: string): void {
    this.cacheMisses.labels(cacheName).inc();
  }

  /**
   * Track external API call
   */
  trackExternalApiCall(
    provider: string,
    operation: string,
    duration: number,
    status: 'success' | 'error'
  ): void {
    this.externalApiCalls.labels(provider, operation, status).inc();
    this.externalApiDuration.labels(provider, operation).observe(duration);
  }

  /**
   * Get metrics in Prometheus format
   */
  async getMetrics(): Promise<string> {
    return this.register.metrics();
  }

  /**
   * Get metrics as JSON
   */
  async getMetricsJSON(): Promise<any> {
    const metrics = await this.register.getMetricsAsJSON();
    return metrics;
  }

  /**
   * Get registry
   */
  getRegistry(): Registry {
    return this.register;
  }
}

// Singleton instance
const metricsService = new PrometheusMetricsService();

/**
 * Express route handler for metrics endpoint
 * GET /metrics
 */
export const metricsHandler = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    res.set('Content-Type', metricsService.getRegistry().contentType);
    const metrics = await metricsService.getMetrics();
    res.end(metrics);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to generate metrics',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Express route handler for metrics in JSON format
 * GET /metrics/json
 */
export const metricsJsonHandler = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const metrics = await metricsService.getMetricsJSON();
    res.json(metrics);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to generate metrics',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

export { metricsService };
