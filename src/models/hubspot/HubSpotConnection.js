/**
 * HubSpot Connection Model
 * Stores OAuth tokens and connection configuration for each user/organization
 * Following Flora multi-tenant integration architecture
 */

const mongoose = require('mongoose');

const hubspotConnectionSchema = new mongoose.Schema({
  // Multi-tenant fields (REQUIRED)
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true
  },

  // HubSpot Account Info
  portalId: {
    type: String,
    required: true,
    index: true
  },
  hubId: String,
  hubDomain: String,
  accountName: String,

  // OAuth Tokens (encrypted with AES-256-GCM)
  accessToken: {
    type: String,
    required: true,
    select: false // Don't include in queries by default
  },
  refreshToken: {
    type: String,
    required: true,
    select: false
  },
  tokenType: {
    type: String,
    default: 'Bearer'
  },
  expiresAt: {
    type: Date,
    required: true
  },
  scopes: [{
    type: String
  }],

  // Connection Status
  status: {
    type: String,
    enum: ['pending', 'active', 'expired', 'disconnected', 'error'],
    default: 'pending',
    index: true
  },

  // Sync Configuration
  syncSettings: {
    autoSync: {
      type: Boolean,
      default: true
    },
    syncFrequency: {
      type: String,
      enum: ['realtime', 'hourly', 'daily', 'manual'],
      default: 'hourly'
    },
    syncEntities: {
      contacts: { type: Boolean, default: true },
      deals: { type: Boolean, default: true },
      companies: { type: Boolean, default: true },
      activities: { type: Boolean, default: true },
      emails: { type: Boolean, default: false }
    },
    conflictResolution: {
      type: String,
      enum: ['manual', 'hubspot_wins', 'flora_wins', 'newest_wins'],
      default: 'manual'
    }
  },

  // Field Mapping Configuration
  fieldMappings: [{
    hubspotField: String,
    floraField: String,
    entityType: String,
    transformationType: String
  }],

  // Webhook Configuration
  webhookSettings: {
    enabled: { type: Boolean, default: false },
    webhookId: String,
    subscribedEvents: [String]
  },

  // Sync Status
  lastSyncAt: Date,
  lastSyncStatus: {
    type: String,
    enum: ['success', 'partial', 'failed']
  },
  lastSyncError: String,

  // Sync Statistics
  syncStatistics: {
    totalSyncs: { type: Number, default: 0 },
    successfulSyncs: { type: Number, default: 0 },
    failedSyncs: { type: Number, default: 0 },
    lastSuccessAt: Date,
    lastFailureAt: Date,
    entitiesSynced: {
      contacts: { type: Number, default: 0 },
      deals: { type: Number, default: 0 },
      companies: { type: Number, default: 0 },
      activities: { type: Number, default: 0 }
    }
  },

  // Metadata
  isActive: {
    type: Boolean,
    default: true
  },
  lastConnectedAt: {
    type: Date,
    default: Date.now
  },
  disconnectedAt: Date,
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  notes: String
}, {
  timestamps: true
});

// Indexes for performance
hubspotConnectionSchema.index({ userId: 1, organizationId: 1 });
hubspotConnectionSchema.index({ portalId: 1 });
hubspotConnectionSchema.index({ status: 1, isActive: 1 });
hubspotConnectionSchema.index({ 'syncSettings.syncFrequency': 1, status: 1 });
hubspotConnectionSchema.index({ lastSyncAt: -1 });

// Unique constraint: one HubSpot portal per organization
hubspotConnectionSchema.index(
  { organizationId: 1, portalId: 1 },
  { unique: true, name: 'org_portal_unique' }
);

// Instance Methods

/**
 * Check if token is expired
 */
hubspotConnectionSchema.methods.isTokenExpired = function() {
  if (!this.expiresAt) return true;
  return new Date() > this.expiresAt;
};

/**
 * Check if connection needs token refresh
 */
hubspotConnectionSchema.methods.needsRefresh = function() {
  if (!this.expiresAt) return true;

  // Refresh if less than 5 minutes remaining
  const fiveMinutes = 5 * 60 * 1000;
  return (this.expiresAt - new Date()) < fiveMinutes;
};

/**
 * Update sync statistics
 */
hubspotConnectionSchema.methods.updateSyncStats = function(success, entitiesUpdated) {
  this.syncStatistics.totalSyncs++;

  if (success) {
    this.syncStatistics.successfulSyncs++;
    this.syncStatistics.lastSuccessAt = new Date();
    this.lastSyncStatus = 'success';

    if (entitiesUpdated) {
      Object.keys(entitiesUpdated).forEach(key => {
        if (this.syncStatistics.entitiesSynced[key] !== undefined) {
          this.syncStatistics.entitiesSynced[key] += entitiesUpdated[key];
        }
      });
    }
  } else {
    this.syncStatistics.failedSyncs++;
    this.syncStatistics.lastFailureAt = new Date();
    this.lastSyncStatus = 'failed';
  }

  this.lastSyncAt = new Date();
};

/**
 * Check if sync is due based on frequency
 */
hubspotConnectionSchema.methods.isSyncDue = function() {
  if (!this.syncSettings.autoSync) return false;
  if (!this.lastSyncAt) return true;

  const now = new Date();
  const lastSync = this.lastSyncAt;
  const diffMinutes = (now - lastSync) / 60000;

  switch(this.syncSettings.syncFrequency) {
    case 'realtime':
      return true;
    case 'hourly':
      return diffMinutes >= 60;
    case 'daily':
      return diffMinutes >= 1440;
    case 'manual':
      return false;
    default:
      return false;
  }
};

/**
 * Get decrypted tokens
 */
hubspotConnectionSchema.methods.getDecryptedTokens = async function() {
  const hubspotAuthService = require('../../services/hubspot/hubspotAuthService');

  return {
    accessToken: this.accessToken ? hubspotAuthService.decrypt(this.accessToken) : null,
    refreshToken: this.refreshToken ? hubspotAuthService.decrypt(this.refreshToken) : null
  };
};

/**
 * Set encrypted tokens
 */
hubspotConnectionSchema.methods.setEncryptedTokens = function(accessToken, refreshToken, expiresAt) {
  const hubspotAuthService = require('../../services/hubspot/hubspotAuthService');

  if (accessToken) {
    this.accessToken = hubspotAuthService.encrypt(accessToken);
  }
  if (refreshToken) {
    this.refreshToken = hubspotAuthService.encrypt(refreshToken);
  }
  if (expiresAt) {
    this.expiresAt = expiresAt;
  }

  this.status = 'active';
  this.lastConnectedAt = new Date();
};

/**
 * Disconnect and deactivate
 */
hubspotConnectionSchema.methods.disconnect = function(userId) {
  this.isActive = false;
  this.status = 'disconnected';
  this.disconnectedAt = new Date();
  this.updatedBy = userId;
  return this.save();
};

// Static Methods

/**
 * Find connections due for sync
 */
hubspotConnectionSchema.statics.findDueForSync = function() {
  return this.find({
    status: 'active',
    isActive: true,
    'syncSettings.autoSync': true
  }).then(connections => {
    return connections.filter(conn => conn.isSyncDue());
  });
};

/**
 * Get connection with tokens for user/organization
 */
hubspotConnectionSchema.statics.getWithTokens = function(userId, organizationId) {
  return this.findOne({
    userId,
    organizationId,
    status: 'active',
    isActive: true
  }).select('+accessToken +refreshToken');
};

/**
 * Find active connection for organization
 */
hubspotConnectionSchema.statics.findActiveForOrganization = function(organizationId) {
  return this.findOne({
    organizationId,
    status: 'active',
    isActive: true
  });
};

const HubSpotConnection = mongoose.model('HubSpotConnection', hubspotConnectionSchema);

module.exports = HubSpotConnection;
