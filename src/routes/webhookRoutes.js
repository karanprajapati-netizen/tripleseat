const express = require("express");
const router = express.Router();
const hubspotController = require("../controllers/hubspotController");
const tripleseatController = require("../controllers/tripleseatController");

// HubSpot → Middleware → TripleSeat (one-way, original flow)
router.post("/hubspot", hubspotController.handleWebhook);

// TripleSeat → Middleware → HubSpot (reverse sync, CR-01 + CR-02)
router.post("/tripleseat", tripleseatController.handleWebhook);

module.exports = router;