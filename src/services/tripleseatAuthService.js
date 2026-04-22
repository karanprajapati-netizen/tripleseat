const axios = require("axios");
const logger = require("../utils/logger");

class TripleseatAuth {
  constructor() {
    this.baseURL = process.env.TRIPLESEAT_BASE_URL;
    this.clientId = process.env.TRIPLESEAT_CLIENT_ID;
    this.clientSecret = process.env.TRIPLESEAT_CLIENT_SECRET;
    this.accessToken = null;
    this.tokenExpiry = null;
    this.tokenRequestCount = 0;
    
    logger.auth(`Authentication service initialized`, {
      baseURL: this.baseURL,
      hasClientId: !!this.clientId,
      hasClientSecret: !!this.clientSecret
    });
  }

  async getAccessToken() {
    const startTime = Date.now();
    
    // Check if we have a valid token
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      const timeUntilExpiry = Math.round((this.tokenExpiry - Date.now()) / 1000);
      logger.auth(`Using cached token (expires in ${timeUntilExpiry}s)`);
      return this.accessToken;
    }

    try {
      this.tokenRequestCount++;
      
      logger.auth(`Requesting new OAuth2 access token (#${this.tokenRequestCount})`);
      
      const response = await axios.post(
        `${this.baseURL}/oauth2/token`,
        new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.clientId,
          client_secret: this.clientSecret
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          timeout: 10000 // 10 second timeout
        }
      );

      this.accessToken = response.data.access_token;
      
      // Set token expiry (typically 1 hour, but we'll use 50 minutes to be safe)
      this.tokenExpiry = Date.now() + (50 * 60 * 1000);
      
      const processingTime = Date.now() - startTime;
      logger.auth(`OAuth2 token obtained successfully`, {
        tokenLength: this.accessToken.length,
        expiresIn: response.data.expires_in,
        processingTime: `${processingTime}ms`,
        expiresAt: new Date(this.tokenExpiry).toLocaleString()
      });
      
      return this.accessToken;

    } catch (error) {
      logger.error(`Failed to obtain OAuth2 token`, {
        error: error.message,
        status: error.response?.status,
        response: error.response?.data
      });
      
      // Reset token state on error
      this.accessToken = null;
      this.tokenExpiry = null;
      
      throw new Error(`Failed to authenticate with Tripleseat API: ${error.message}`);
    }
  }

  async getHeaders() {
    try {
      const token = await this.getAccessToken();
      return {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      };
    } catch (error) {
      logger.error(`Failed to generate auth headers`, {
        error: error.message
      });
      throw error;
    }
  }

  // Force token refresh
  async refreshToken() {
    logger.auth(`Forcing token refresh`);
    this.accessToken = null;
    this.tokenExpiry = null;
    return this.getAccessToken();
  }
  
  // Get authentication status for monitoring
  getAuthStatus() {
    return {
      hasToken: !!this.accessToken,
      tokenExpiry: this.tokenExpiry ? new Date(this.tokenExpiry).toISOString() : null,
      isTokenExpired: this.tokenExpiry ? Date.now() > this.tokenExpiry : true,
      tokenRequestCount: this.tokenRequestCount,
      timeUntilExpiry: this.tokenExpiry ? Math.max(0, this.tokenExpiry - Date.now()) : 0
    };
  }
}

module.exports = new TripleseatAuth();
