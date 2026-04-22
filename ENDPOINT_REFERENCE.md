# Main Endpoint Reference

## Primary Target

### Webhook Endpoint
- **URL**: `/webhook/hubspot`
- **Method**: `POST`
- **Main File**: `src/controllers/hubspotController.js`
- **Main Function**: `handleWebhook`

### Request Flow
1. HubSpot sends POST to `/webhook/hubspot`
2. `webhookRoutes.js` routes to `hubspotController.handleWebhook`
3. Controller processes deal and creates Tripleseat records

### Expected HubSpot Payload
```json
{
  "objectId": "deal_id_here",
  "propertyName": "tripleseat_push",
  "propertyValue": "Yes"
}
```

### Success Response
```json
{
  "message": "Webhook processed successfully",
  "dealId": "208389168090",
  "processedContacts": 1,
  "failedContacts": 0,
  "processingTime": 2500
}
```

## Configuration Files

### Routes
- **File**: `src/routes/webhookRoutes.js`
- **Defines**: POST `/webhook` route

### Environment
- **File**: `.env`
- **Required**: HUBSPOT_TOKEN, TRIPLESEAT_CLIENT_ID, TRIPLESEAT_CLIENT_SECRET, TRIPLESEAT_ACCOUNT_ID

### Main Server
- **File**: `src/app.js`
- **Port**: 3000 (or PORT env var)
- **Health Check**: `/health`

## Quick Test Commands

```bash
# Test health
curl https://your-domain.com/health

# Test webhook
curl -X POST https://your-domain.com/webhook/hubspot \
  -H "Content-Type: application/json" \
  -d '{"objectId": "208389168090"}'
```

## Deployment Target Files

### For Google Cloud Run
- `Dockerfile`
- `.dockerignore`
- `.env`

### For Google Compute Engine
- `ecosystem.config.js` (PM2 config)
- `.env`
- `src/app.js`

## Key Dependencies

- `express` - Web server
- `axios` - HTTP client for APIs
- `winston` - Logging
- `dotenv` - Environment variables
