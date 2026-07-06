require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const mongoose = require('mongoose');
const winston = require('winston');
const axios = require('axios');

// Validate required environment variables
const validateEnvironment = () => {
  const required = ['JWT_SECRET', 'SESSION_SECRET'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0 && process.env.NODE_ENV === 'production') {
    console.error(`FATAL: Missing required environment variables: ${missing.join(', ')}`);
    console.error('Please set these variables before starting the service.');
    process.exit(1);
  } else if (missing.length > 0) {
    console.warn(`WARNING: Missing environment variables: ${missing.join(', ')}`);
    console.warn('Using development defaults - NOT SAFE FOR PRODUCTION');
  }
};

// Validate environment on startup
validateEnvironment();

// Logger setup
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

// Create Express app
const app = express();
const PORT = process.env.PORT || 3001;

// Configure CORS properly
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim())
  : process.env.NODE_ENV === 'production'
    ? false // Deny all in production if not configured
    : ['http://localhost:3000', 'http://localhost:5173']; // Development defaults

// Middleware
app.use(helmet());
app.use(cors({
  origin: corsOrigins,
  credentials: true,
  maxAge: 86400
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'dealbeam-crm',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'DealBeam CRM',
    version: '1.0.0',
    status: 'running',
    integrations: ['hubspot', 'pipedrive', 'affinity']
  });
});

// CRM API endpoints
app.get('/api/v1/deals', (req, res) => {
  res.json({
    deals: [],
    total: 0,
    page: 1,
    limit: 20
  });
});

app.get('/api/v1/contacts', (req, res) => {
  res.json({
    contacts: [],
    total: 0,
    page: 1,
    limit: 20
  });
});

app.get('/api/v1/companies', (req, res) => {
  res.json({
    companies: [],
    total: 0,
    page: 1,
    limit: 20
  });
});

// HubSpot integration
app.post('/api/v1/integrations/hubspot/connect', (req, res) => {
  const authUrl = `https://app.hubspot.com/oauth/authorize?client_id=${process.env.HUBSPOT_CLIENT_ID}&redirect_uri=${process.env.HUBSPOT_REDIRECT_URI}&scope=crm.objects.contacts.read%20crm.objects.companies.read`;
  res.json({
    status: 'success',
    authUrl
  });
});

app.post('/api/v1/integrations/hubspot/sync', async (req, res) => {
  try {
    logger.info('HubSpot sync requested');
    res.json({
      status: 'success',
      message: 'HubSpot sync initiated',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('HubSpot sync error:', error);
    res.status(500).json({ error: 'Sync failed' });
  }
});

// Database connection
const connectDatabase = async () => {
  if (process.env.MONGODB_URI) {
    try {
      await mongoose.connect(process.env.MONGODB_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true
      });
      logger.info('MongoDB connected successfully');
    } catch (error) {
      logger.warn('MongoDB connection failed:', error.message);
    }
  } else {
    logger.info('No MongoDB URI provided, running without database');
  }
};

// Start server
const startServer = async () => {
  await connectDatabase();

  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`DealBeam CRM service running on port ${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    if (process.env.HUBSPOT_CLIENT_ID) {
      logger.info('HubSpot integration configured');
    }
  });
};

// Error handling
process.on('unhandledRejection', (err) => {
  logger.error('Unhandled rejection:', err);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', err);
  process.exit(1);
});

// Start the service
startServer();
