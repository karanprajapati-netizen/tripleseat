require("dotenv").config();
const auth = require("./src/services/tripleseatAuthService");

async function testAuth() {
  try {
    console.log("Testing Tripleseat OAuth2 authentication...");
    
    const token = await auth.getAccessToken();
    console.log(" Successfully obtained access token");
    console.log("Token (first 20 chars):", token.substring(0, 20) + "...");
    
    const headers = await auth.getHeaders();
    console.log("Successfully generated headers");
    console.log("Headers:", headers);
    
  } catch (error) {
    console.error("Authentication test failed:", error.message);
    if (error.response?.data) {
      console.error("Response data:", error.response.data);
    }
  }
}

testAuth();
