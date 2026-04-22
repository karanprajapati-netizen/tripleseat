const express = require("express");
const router = express.Router();
const controller = require("../controllers/hubspotController");

router.post("/hubspot", controller.handleWebhook);

module.exports = router;