# Google Cloud Deployment Guide

## Overview
Deploy the Tripleseat middleware to Google Cloud and configure it as a HubSpot webhook endpoint.

## Main Target File
**Primary Endpoint**: `src/controllers/hubspotController.js` - `handleWebhook` function
- **URL Path**: `/webhook` (defined in `src/routes/webhookRoutes.js`)
- **Method**: POST
- **Full URL**: `https://your-domain.com/webhook`

## Deployment Steps

### 1. Prepare for Deployment

#### Update Environment Variables
```bash
# Copy production environment file
cp .env.production .env

# Edit .env with your production values
nano .env
```

#### Install Dependencies
```bash
npm install --production
```

### 2. Google Cloud Deployment Options

#### Option A: Google Cloud Run (Recommended)
```bash
# 1. Install Google Cloud CLI
# Follow: https://cloud.google.com/sdk/docs/install

# 2. Authenticate
gcloud auth login
gcloud config set project your-project-id

# 3. Enable APIs
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com

# 4. Create Dockerfile
```

Create `Dockerfile`:
```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

# Create logs directory
RUN mkdir -p logs

EXPOSE 8080

# Use PORT environment variable (Cloud Run default)
ENV PORT=8080

CMD ["node", "src/app.js"]
```

Create `.dockerignore`:
```
node_modules
npm-debug.log
logs/*
.git
.gitignore
README.md
.env.development
test-*.js
```

```bash
# 5. Build and Deploy
gcloud run deploy tripleseat-middleware \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --timeout 60s \
  --concurrency 10 \
  --max-instances 10
```

#### Option B: Google Compute Engine (VM)
```bash
# 1. Create VM instance
gcloud compute instances create tripleseat-server \
  --zone=us-central1-a \
  --machine-type=e2-micro \
  --image-family=ubuntu-2004-lts \
  --image-project=ubuntu-os-cloud \
  --boot-disk-size=20GB

# 2. SSH into VM
gcloud compute ssh tripleseat-server --zone=us-central1-a

# 3. Setup Node.js on VM
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# 4. Clone and setup project
git clone <your-repo>
cd tripleseat
npm install --production
cp .env.production .env
# Edit .env with production values

# 5. Install PM2 for process management
sudo npm install -g pm2

# 6. Start application
pm2 start src/app.js --name "tripleseat-middleware"
pm2 startup
pm2 save

# 7. Setup firewall
gcloud compute firewall-rules create allow-http \
  --allow tcp:80,tcp:443 \
  --source-ranges 0.0.0.0/0
```

### 3. SSL Certificate (Required for HubSpot)

#### For Cloud Run (Auto SSL)
- Cloud Run provides automatic SSL certificates
- Your URL will be: `https://tripleseat-middleware-<hash>.run.app`

#### For Compute Engine
```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx

# Get SSL certificate (replace your-domain.com)
sudo certbot --nginx -d your-domain.com

# Auto-renewal
sudo crontab -e
# Add: 0 12 * * * /usr/bin/certbot renew --quiet
```

### 4. Configure HubSpot Webhook

1. **Go to HubSpot Developers**: https://developers.hubspot.com/
2. **Navigate to your app**
3. **Go to Webhooks section**
4. **Create new webhook**:
   - **Webhook URL**: `https://your-domain.com/webhook`
   - **Subscription type**: `deals`
   - **Events**: `deal.propertyChange`, `deal.creation`
   - **Active**: ✅

5. **Test the webhook**:
   ```bash
   # Test endpoint
   curl -X POST https://your-domain.com/webhook \
     -H "Content-Type: application/json" \
     -d '{"objectId": "test-deal-id"}'
   ```

### 5. Production Configuration

#### Environment Variables (.env)
```bash
NODE_ENV=production
PORT=8080
LOG_LEVEL=info

# HubSpot
HUBSPOT_TOKEN=your_production_hubspot_token

# Tripleseat
TRIPLESEAT_BASE_URL=https://api.tripleseat.com
TRIPLESEAT_CLIENT_ID=your_client_id
TRIPLESEAT_CLIENT_SECRET=your_client_secret
TRIPLESEAT_ACCOUNT_ID=your_account_id
```

#### PM2 Configuration (for VM)
Create `ecosystem.config.js`:
```javascript
module.exports = {
  apps: [{
    name: 'tripleseat-middleware',
    script: 'src/app.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 8080
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_file: './logs/pm2-combined.log',
    time: true
  }]
};
```

Start with:
```bash
pm2 start ecosystem.config.js
```

### 6. Monitoring and Health Checks

#### Health Check Endpoints
- **Health**: `https://your-domain.com/health`
- **Metrics**: `https://your-domain.com/metrics`
- **Root**: `https://your-domain.com/`

#### Log Monitoring
```bash
# For Cloud Run
gcloud logs read "resource.type=cloud_run_revision" --limit 50

# For VM with PM2
pm2 logs
tail -f logs/app.log
```

### 7. Security Considerations

1. **API Keys**: Store in environment variables, never in code
2. **Firewall**: Only allow necessary ports (80, 443)
3. **HTTPS**: Always use SSL in production
4. **Rate Limiting**: Consider implementing rate limiting for webhooks
5. **Input Validation**: Webhook data is already validated in controller

### 8. Testing Production Deployment

#### Test Webhook Flow
1. Update a deal in HubSpot with `tripleseat_push = "Yes"`
2. Check logs: `tail -f logs/app.log`
3. Verify Tripleseat contact/event creation

#### Test Health Check
```bash
curl https://your-domain.com/health
```

Expected response:
```json
{
  "status": "healthy",
  "services": {
    "tripleseat": {
      "authenticated": true,
      "tokenExpired": false
    },
    "hubspot": {
      "hasToken": true
    }
  }
}
```

### 9. Troubleshooting

#### Common Issues
1. **Webhook not triggering**: Check webhook URL in HubSpot
2. **Authentication errors**: Verify environment variables
3. **CORS issues**: Not applicable for webhooks
4. **Memory issues**: Increase Cloud Run memory or VM size

#### Debug Commands
```bash
# Check application status
pm2 status
pm2 logs tripleseat-middleware

# Check environment
curl https://your-domain.com/health

# Test webhook manually
curl -X POST https://your-domain.com/webhook \
  -H "Content-Type: application/json" \
  -d '{"objectId": "208389168090"}'
```

## File Structure Summary

```
tripleseat/
├── src/
│   ├── controllers/
│   │   └── hubspotController.js    # MAIN WEBHOOK HANDLER
│   ├── services/
│   │   ├── hubspotService.js       # HubSpot API
│   │   ├── tripleseatService.js    # Tripleseat API
│   │   └── tripleseatAuthService.js # OAuth2 Auth
│   ├── routes/
│   │   └── webhookRoutes.js        # Route definitions
│   ├── utils/
│   │   └── logger.js               # Logging system
│   └── app.js                      # Express server
├── logs/                           # Log files
├── .env                            # Environment variables
├── package.json                    # Dependencies
└── Dockerfile                      # Container definition (if needed)
```

## Main Endpoint Summary

**Webhook URL**: `https://your-domain.com/webhook/hubspot`
- **Controller**: `src/controllers/hubspotController.js`
- **Function**: `handleWebhook`
- **Method**: POST
- **Expected Payload**: `{"objectId": "deal_id"}`

This endpoint will:
1. Receive deal updates from HubSpot
2. Check if `tripleseat_push = "Yes"`
3. Find associated contacts
4. Create contacts and events in Tripleseat
5. Log all activities to `logs/app.log`
