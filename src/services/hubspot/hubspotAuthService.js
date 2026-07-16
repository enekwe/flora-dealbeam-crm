/**
 * HubSpot OAuth Authentication Service
 * Handles OAuth flow, token management, and credential security
 * Following Flora multi-tenant integration architecture
 */

const axios = require('axios');
const crypto = require('crypto');
const HubSpotConnection = require('../../models/hubspot/HubSpotConnection');

class HubSpotAuthService {
  constructor() {
    this.clientId = process.env.HUBSPOT_CLIENT_ID;
    this.clientSecret = process.env.HUBSPOT_CLIENT_SECRET;
    this.redirectUri = process.env.HUBSPOT_REDIRECT_URI || 'http://localhost:3001/api/v1/integrations/hubspot/callback';
    this.authUrl = 'https://app.hubspot.com/oauth/authorize';
    this.tokenUrl = 'https://api.hubapi.com/oauth/v3/token';
    this.scopes = [
      'crm.objects.contacts.read',
      'crm.objects.contacts.write',
      'crm.objects.deals.read',
      'crm.objects.deals.write',
      'crm.objects.companies.read',
      'crm.objects.companies.write',
      'crm.objects.owners.read',
      'crm.schemas.contacts.read',
      'crm.schemas.deals.read',
      'crm.schemas.companies.read',
      'oauth'
    ];
  }

  /**
   * Generate OAuth authorization URL
   */
  getAuthorizationUrl(userId, organizationId) {
    const state = this.generateState(userId, organizationId);

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope: this.scopes.join(' '),
      state: state
    });

    return `${this.authUrl}?${params.toString()}`;
  }

  /**
   * Generate secure state parameter for CSRF protection
   * State includes encrypted user context (userId + organizationId)
   */
  generateState(userId, organizationId) {
    const data = {
      userId,
      organizationId,
      timestamp: Date.now(),
      nonce: crypto.randomBytes(16).toString('hex')
    };

    const stateString = JSON.stringify(data);
    const encrypted = this.encrypt(stateString);

    return Buffer.from(encrypted).toString('base64url');
  }

  /**
   * Verify and decode state parameter
   */
  verifyState(state) {
    try {
      const encrypted = Buffer.from(state, 'base64url').toString();
      const decrypted = this.decrypt(encrypted);
      const data = JSON.parse(decrypted);

      // Verify timestamp (valid for 10 minutes)
      const now = Date.now();
      const age = now - data.timestamp;
      if (age > 10 * 60 * 1000) {
        throw new Error('State parameter expired');
      }

      return data;
    } catch (error) {
      console.error('State verification failed:', error);
      throw new Error('Invalid state parameter');
    }
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(code) {
    try {
      const response = await axios.post(
        this.tokenUrl,
        new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: this.clientId,
          client_secret: this.clientSecret,
          redirect_uri: this.redirectUri,
          code: code
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      const tokenData = {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresIn: response.data.expires_in,
        tokenType: response.data.token_type || 'Bearer',
        expiresAt: new Date(Date.now() + (response.data.expires_in * 1000))
      };

      return tokenData;
    } catch (error) {
      console.error('HubSpot token exchange failed:', error.response?.data);
      throw new Error(`HubSpot token exchange failed: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Refresh an expired access token
   */
  async refreshAccessToken(refreshToken) {
    try {
      const response = await axios.post(
        this.tokenUrl,
        new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: this.clientId,
          client_secret: this.clientSecret,
          refresh_token: refreshToken
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      return {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token || refreshToken,
        expiresIn: response.data.expires_in,
        expiresAt: new Date(Date.now() + (response.data.expires_in * 1000))
      };
    } catch (error) {
      console.error('HubSpot token refresh failed:', error.response?.data);

      // If refresh fails, need to re-authenticate
      if (error.response?.status === 401) {
        throw new Error('Refresh token expired - re-authentication required');
      }

      throw error;
    }
  }

  /**
   * Get HubSpot account details
   */
  async getAccountDetails(accessToken) {
    try {
      const response = await axios.get('https://api.hubapi.com/account-info/v3/details', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      return {
        portalId: response.data.portalId.toString(),
        hubId: response.data.hubId?.toString(),
        hubDomain: response.data.hubDomain,
        accountName: response.data.companyName || response.data.hubDomain
      };
    } catch (error) {
      console.error('Failed to get HubSpot account details:', error.response?.data);
      throw error;
    }
  }

  /**
   * Save or update connection
   */
  async saveConnection(userId, organizationId, tokenData, accountDetails) {
    try {
      const connectionData = {
        userId,
        organizationId,
        portalId: accountDetails.portalId,
        hubId: accountDetails.hubId,
        hubDomain: accountDetails.hubDomain,
        accountName: accountDetails.accountName,
        tokenType: tokenData.tokenType || 'Bearer',
        scopes: this.scopes,
        status: 'active',
        isActive: true,
        lastConnectedAt: new Date(),
        createdBy: userId,
        updatedBy: userId
      };

      const connection = await HubSpotConnection.findOneAndUpdate(
        { userId, organizationId },
        connectionData,
        { upsert: true, new: true, runValidators: true }
      ).select('+accessToken +refreshToken');

      // Set encrypted tokens using instance method
      connection.setEncryptedTokens(
        tokenData.accessToken,
        tokenData.refreshToken,
        tokenData.expiresAt
      );

      await connection.save();

      console.log('HubSpot connection saved:', {
        userId,
        organizationId,
        portalId: accountDetails.portalId,
        connectionId: connection._id
      });

      return connection;
    } catch (error) {
      console.error('Failed to save HubSpot connection:', error);
      throw error;
    }
  }

  /**
   * Get active connection for user/organization
   */
  async getConnection(userId, organizationId) {
    try {
      const connection = await HubSpotConnection.findOne({
        userId,
        organizationId,
        isActive: true,
        status: 'active'
      });

      if (!connection) {
        return null;
      }

      // Check if token is expired and refresh if needed
      if (connection.needsRefresh()) {
        try {
          const connectionWithTokens = await HubSpotConnection.getWithTokens(userId, organizationId);
          const { refreshToken } = await connectionWithTokens.getDecryptedTokens();

          const newTokens = await this.refreshAccessToken(refreshToken);

          connectionWithTokens.setEncryptedTokens(
            newTokens.accessToken,
            newTokens.refreshToken,
            newTokens.expiresAt
          );

          await connectionWithTokens.save();

          // Return fresh connection
          return await HubSpotConnection.findOne({
            userId,
            organizationId,
            isActive: true
          });
        } catch (error) {
          console.error('Token refresh failed, connection invalid:', error);
          connection.status = 'expired';
          connection.isActive = false;
          await connection.save();
          return null;
        }
      }

      return connection;
    } catch (error) {
      console.error('Failed to get HubSpot connection:', error);
      throw error;
    }
  }

  /**
   * Get decrypted access token
   */
  async getAccessToken(userId, organizationId) {
    const connection = await this.getConnection(userId, organizationId);
    if (!connection) {
      throw new Error('No active HubSpot connection found');
    }

    const connectionWithTokens = await HubSpotConnection.getWithTokens(userId, organizationId);
    const { accessToken } = await connectionWithTokens.getDecryptedTokens();

    return accessToken;
  }

  /**
   * Disconnect (deactivate) connection
   */
  async disconnect(userId, organizationId) {
    try {
      const connection = await HubSpotConnection.findOne({
        userId,
        organizationId
      });

      if (!connection) {
        throw new Error('Connection not found');
      }

      await connection.disconnect(userId);

      console.log('HubSpot connection disconnected:', {
        userId,
        organizationId
      });

      return connection;
    } catch (error) {
      console.error('Failed to disconnect HubSpot connection:', error);
      throw error;
    }
  }

  /**
   * Encrypt sensitive data using AES-256-GCM
   * REQUIRED: Must use AES-256-GCM for OAuth token encryption
   */
  encrypt(text) {
    const algorithm = 'aes-256-gcm';
    const key = crypto.scryptSync(
      process.env.ENCRYPTION_KEY || 'default-key-change-in-production',
      'salt',
      32
    );
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return JSON.stringify({
      encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex')
    });
  }

  /**
   * Decrypt sensitive data using AES-256-GCM
   * REQUIRED: Must use AES-256-GCM for OAuth token decryption
   */
  decrypt(encryptedData) {
    const algorithm = 'aes-256-gcm';
    const key = crypto.scryptSync(
      process.env.ENCRYPTION_KEY || 'default-key-change-in-production',
      'salt',
      32
    );

    const data = JSON.parse(encryptedData);
    const decipher = crypto.createDecipheriv(
      algorithm,
      key,
      Buffer.from(data.iv, 'hex')
    );

    decipher.setAuthTag(Buffer.from(data.authTag, 'hex'));

    let decrypted = decipher.update(data.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Test connection
   */
  async testConnection(userId, organizationId) {
    try {
      const accessToken = await this.getAccessToken(userId, organizationId);

      // Make a simple API call to verify connection
      await axios.get('https://api.hubapi.com/account-info/v3/details', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      return {
        status: 'connected',
        message: 'Connection is active and valid'
      };
    } catch (error) {
      console.error('HubSpot connection test failed:', error);
      return {
        status: 'error',
        message: error.message
      };
    }
  }

  /**
   * Get configuration status
   */
  getConfigurationStatus() {
    return {
      clientIdConfigured: !!this.clientId,
      clientSecretConfigured: !!this.clientSecret,
      redirectUriConfigured: !!this.redirectUri,
      redirectUri: this.redirectUri,
      scopes: this.scopes
    };
  }
}

module.exports = new HubSpotAuthService();
