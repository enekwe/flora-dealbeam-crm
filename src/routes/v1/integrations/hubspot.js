/**
 * HubSpot Integration Routes
 * OAuth flow and connection management
 */

const express = require('express');
const router = express.Router();
const hubspotAuthService = require('../../../services/hubspot/hubspotAuthService');

/**
 * GET /api/v1/integrations/hubspot/connect
 * Initiate OAuth flow
 */
router.get('/connect', async (req, res) => {
  try {
    const { userId, organizationId } = req.query;

    if (!userId || !organizationId) {
      return res.status(400).json({
        error: 'Missing required parameters: userId and organizationId'
      });
    }

    const authUrl = hubspotAuthService.getAuthorizationUrl(userId, organizationId);

    res.json({
      success: true,
      authUrl,
      message: 'Redirect user to authUrl to complete OAuth flow'
    });
  } catch (error) {
    console.error('HubSpot connect error:', error);
    res.status(500).json({
      error: 'Failed to initiate HubSpot connection',
      message: error.message
    });
  }
});

/**
 * GET /api/v1/integrations/hubspot/callback
 * OAuth callback handler
 */
router.get('/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;

    // Handle OAuth errors
    if (error) {
      console.error('HubSpot OAuth error:', error);
      return res.status(400).json({
        error: 'OAuth authorization failed',
        message: req.query.error_description || error
      });
    }

    if (!code || !state) {
      return res.status(400).json({
        error: 'Missing authorization code or state parameter'
      });
    }

    // Verify state parameter and extract user context
    const stateData = hubspotAuthService.verifyState(state);
    const { userId, organizationId } = stateData;

    // Exchange code for tokens
    const tokenData = await hubspotAuthService.exchangeCodeForToken(code);

    // Get HubSpot account details
    const accountDetails = await hubspotAuthService.getAccountDetails(tokenData.accessToken);

    // Save connection with encrypted tokens
    const connection = await hubspotAuthService.saveConnection(
      userId,
      organizationId,
      tokenData,
      accountDetails
    );

    res.json({
      success: true,
      message: 'HubSpot connected successfully',
      connection: {
        id: connection._id,
        portalId: connection.portalId,
        accountName: connection.accountName,
        status: connection.status,
        connectedAt: connection.lastConnectedAt
      }
    });
  } catch (error) {
    console.error('HubSpot callback error:', error);
    res.status(500).json({
      error: 'Failed to complete HubSpot connection',
      message: error.message
    });
  }
});

/**
 * POST /api/v1/integrations/hubspot/disconnect
 * Disconnect HubSpot integration
 */
router.post('/disconnect', async (req, res) => {
  try {
    const { userId, organizationId } = req.body;

    if (!userId || !organizationId) {
      return res.status(400).json({
        error: 'Missing required parameters: userId and organizationId'
      });
    }

    await hubspotAuthService.disconnect(userId, organizationId);

    res.json({
      success: true,
      message: 'HubSpot disconnected successfully'
    });
  } catch (error) {
    console.error('HubSpot disconnect error:', error);
    res.status(500).json({
      error: 'Failed to disconnect HubSpot',
      message: error.message
    });
  }
});

/**
 * GET /api/v1/integrations/hubspot/status
 * Get connection status
 */
router.get('/status', async (req, res) => {
  try {
    const { userId, organizationId } = req.query;

    if (!userId || !organizationId) {
      return res.status(400).json({
        error: 'Missing required parameters: userId and organizationId'
      });
    }

    const connection = await hubspotAuthService.getConnection(userId, organizationId);

    if (!connection) {
      return res.json({
        connected: false,
        message: 'No active HubSpot connection found'
      });
    }

    res.json({
      connected: true,
      connection: {
        id: connection._id,
        portalId: connection.portalId,
        accountName: connection.accountName,
        status: connection.status,
        lastSyncAt: connection.lastSyncAt,
        syncSettings: connection.syncSettings
      }
    });
  } catch (error) {
    console.error('HubSpot status error:', error);
    res.status(500).json({
      error: 'Failed to get HubSpot status',
      message: error.message
    });
  }
});

/**
 * POST /api/v1/integrations/hubspot/test
 * Test connection
 */
router.post('/test', async (req, res) => {
  try {
    const { userId, organizationId } = req.body;

    if (!userId || !organizationId) {
      return res.status(400).json({
        error: 'Missing required parameters: userId and organizationId'
      });
    }

    const result = await hubspotAuthService.testConnection(userId, organizationId);

    res.json(result);
  } catch (error) {
    console.error('HubSpot test error:', error);
    res.status(500).json({
      error: 'Failed to test HubSpot connection',
      message: error.message
    });
  }
});

module.exports = router;
