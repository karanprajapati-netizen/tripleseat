const crypto = require("crypto");
const hubspot = require("../services/hubspotService");
const logger = require("../utils/logger");

const SIGNING_KEY = process.env.TRIPLESEAT_SIGNING_KEY || "";

// Verify the X-Signature header TripleSeat sends with every webhook
// Format: "t=<timestamp>,v1=<hmac-sha256>"
const verifySignature = (rawBody, signatureHeader) => {
  if (!SIGNING_KEY || !signatureHeader) return false;

  const parts = Object.fromEntries(
    signatureHeader.split(",").map(p => p.split("="))
  );
  const timestamp = parts.t;
  const receivedSig = parts.v1;
  if (!timestamp || !receivedSig) return false;

  const expected = crypto
    .createHmac("sha256", SIGNING_KEY)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(receivedSig, "hex")
  );
};

// TripleSeat status → HubSpot deal stage ID mapping (Event Sales Pipeline)
const TS_STATUS_TO_HS_STAGE = {
  PROSPECT:  process.env.HS_STAGE_PROSPECT  || "2822434791", // Qualified Lead
  TENTATIVE: process.env.HS_STAGE_TENTATIVE || "2822434792", // Quote Sent
  DEFINITE:  process.env.HS_STAGE_DEFINITE  || "2822434793", // Contract Sent
  CLOSED:    process.env.HS_STAGE_CLOSED    || "2822434794", // Closed Won
  LOST:      process.env.HS_STAGE_LOST      || "2822434795", // Closed Lost
  WAITLIST:  process.env.HS_STAGE_WAITLIST  || "2822434791"  // Qualified Lead
};



exports.handleWebhook = async (req, res) => {
  const startTime = Date.now();

  try {
    const payload = req.body;

    // Verify X-Signature header (HMAC-SHA256 from TripleSeat)
    // Only enforce when TRIPLESEAT_SIGNING_KEY is set in env
    if (SIGNING_KEY) {
      const sigHeader = req.headers["x-signature"] || "";
      if (!verifySignature(req.rawBody || "", sigHeader)) {
        logger.error("TripleSeat webhook signature verification failed", {
          sigHeader
        });
        return res.status(200).json({ success: false, message: "Invalid signature" });
      }
    }

    // Log the raw payload first so we can debug field names if TripleSeat
    // sends a shape different from what we expect
    logger.tripleseat("TripleSeat webhook received", {
      rawPayload: JSON.stringify(payload).substring(0, 800)
    });

    // TripleSeat can wrap the data under an "event" key or send it flat
    const eventData = payload.event ?? payload;

    const tsEventId = eventData.id;
    if (!tsEventId) {
      logger.error("TripleSeat webhook missing event ID", { payload });
      return res.status(200).json({ success: false, message: "Missing event ID" });
    }

    // --------------------------------------------------
    // FIND THE LINKED HUBSPOT DEAL
    // Search by tripleseat_event_id property stored on the deal
    // --------------------------------------------------
    const deal = await hubspot.findDealByTripleseatEventId(String(tsEventId));

    if (!deal) {
      logger.tripleseat("No linked HubSpot deal found - skipping", { tsEventId });
      return res.status(200).json({ success: true, message: "No linked deal - skipped" });
    }

    const dealId = deal.id;
    const updates = {};

    // --------------------------------------------------
    // CR-02: STATUS SYNC
    // Triggered by: Status Change Event, Status Change Booking
    // --------------------------------------------------
    const tsStatus = (eventData.status || "").toUpperCase();
    if (tsStatus && TS_STATUS_TO_HS_STAGE[tsStatus]) {
      const mappedStage = TS_STATUS_TO_HS_STAGE[tsStatus];
      // Only update if the stage is actually changing
      if (deal.properties?.dealstage !== mappedStage) {
        updates.dealstage = mappedStage;
        logger.tripleseat("Mapping TripleSeat status to HubSpot stage", {
          tsStatus,
          mappedStage,
          dealId
        });
      }
    }

    // --------------------------------------------------
    // CR-01: AMOUNT SYNC
    // Reads grand_total from the event payload and syncs to HubSpot deal amount
    // --------------------------------------------------
    const grandTotal = eventData.grand_total != null ? parseFloat(eventData.grand_total) : null;
    logger.tripleseat("grand_total from TripleSeat payload", {
      grandTotal,
      dealId
    });
    if (grandTotal !== null && grandTotal > 0) {
      const currentAmount = parseFloat(deal.properties?.amount || 0);
      if (grandTotal !== currentAmount) {
        updates.amount = String(grandTotal);
        logger.tripleseat("Syncing grand_total to HubSpot deal amount", {
          grandTotal,
          currentAmount,
          dealId
        });
      }
    }

    // --------------------------------------------------
    // APPLY UPDATES
    // --------------------------------------------------
    if (Object.keys(updates).length > 0) {
      await hubspot.updateDeal(dealId, updates);
      logger.tripleseat("HubSpot deal updated from TripleSeat webhook", {
        dealId,
        updates,
        tsEventId
      });
    } else {
      logger.tripleseat("No relevant changes detected - nothing to update", {
        tsEventId,
        dealId
      });
    }

    return res.status(200).json({
      success: true,
      message: "TripleSeat webhook processed",
      dealId,
      updates,
      processingTime: `${Date.now() - startTime}ms`
    });

  } catch (error) {
    logger.error("TripleSeat webhook error", {
      error: error.message,
      stack: error.stack
    });

    // Always return 200 so TripleSeat does not keep retrying
    return res.status(200).json({
      success: false,
      error: error.message,
      processingTime: `${Date.now() - startTime}ms`
    });
  }
};
