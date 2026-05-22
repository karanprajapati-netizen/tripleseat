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
  TENTATIVE: process.env.HS_STAGE_TENTATIVE || "2822434793", // Contract Sent (highest pre-deposit stage)
  DEFINITE:  process.env.HS_STAGE_DEFINITE  || "2822434794", // Closed Won (deposit received)
  CLOSED:    process.env.HS_STAGE_CLOSED    || "2822434794", // Closed Won (final numbers updated)
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

    // Log the full raw payload so we can verify exact field names from TripleSeat
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
    // STATUS SYNC
    // Triggered by: Status Change Event, Update Event
    // --------------------------------------------------
    const tsStatus = (eventData.status || "").toUpperCase();
    if (tsStatus && TS_STATUS_TO_HS_STAGE[tsStatus]) {
      const mappedStage = TS_STATUS_TO_HS_STAGE[tsStatus];
      if (deal.properties?.dealstage !== mappedStage) {
        updates.dealstage = mappedStage;
        logger.tripleseat("Mapping TripleSeat status to HubSpot stage", { tsStatus, mappedStage, dealId });
      }
    }

    // --------------------------------------------------
    // AMOUNT SYNC  (actual_amount → HubSpot amount)
    // Triggered by: Update Event
    // --------------------------------------------------
    const actualAmount = eventData.actual_amount != null ? parseFloat(eventData.actual_amount) : null;
    if (actualAmount !== null && actualAmount > 0) {
      const currentAmount = parseFloat(deal.properties?.amount || 0);
      if (actualAmount !== currentAmount) {
        updates.amount = String(actualAmount);
        logger.tripleseat("Syncing actual_amount to HubSpot amount", { actualAmount, currentAmount, dealId });
      }
    }

    // --------------------------------------------------
    // GUEST COUNT SYNC  (guest_count → number_of_guests__cloned__)
    // Triggered by: Update Event, Change Event Guest Counts
    // --------------------------------------------------
    const guestCount = eventData.guest_count != null ? parseInt(eventData.guest_count) : null;
    if (guestCount !== null) {
      const currentGuests = parseInt(deal.properties?.number_of_guests__cloned__ || 0);
      if (guestCount !== currentGuests) {
        updates.number_of_guests__cloned__ = String(guestCount);
        logger.tripleseat("Syncing guest_count to HubSpot", { guestCount, currentGuests, dealId });
      }
    }

    // --------------------------------------------------
    // EVENT DATE SYNC  (event_date → HubSpot event_date)
    // Triggered by: Update Event, Change Event Datetime
    // --------------------------------------------------
    const tsEventDate = eventData.event_date || null;
    if (tsEventDate) {
      // TripleSeat sends MM/DD/YYYY; HubSpot date fields expect midnight UTC as ms timestamp
      const parsed = new Date(tsEventDate);
      if (!isNaN(parsed)) {
        const midnightUtc = Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate());
        const currentEventDate = deal.properties?.event_date
          ? new Date(deal.properties.event_date).getTime()
          : null;
        if (midnightUtc !== currentEventDate) {
          updates.event_date = String(midnightUtc);
          logger.tripleseat("Syncing event_date to HubSpot", { tsEventDate, midnightUtc, dealId });
        }
      }
    }

    // --------------------------------------------------
    // DESCRIPTION SYNC  (description → event_details)
    // Triggered by: Update Event
    // --------------------------------------------------
    const tsDescription = eventData.description != null ? String(eventData.description) : null;
    if (tsDescription !== null) {
      const currentDescription = deal.properties?.event_details || "";
      if (tsDescription !== currentDescription) {
        updates.event_details = tsDescription;
        logger.tripleseat("Syncing description to HubSpot event_details", { dealId });
      }
    }
    // --------------------------------------------------
    // LEAD SOURCE SYNC  (selected_lead_sources → lead_source)
    // Triggered by: Update Event
    // --------------------------------------------------
    const tsLeadSources = Array.isArray(eventData.selected_lead_sources)
      ? eventData.selected_lead_sources.map(String)
      : [];
    const currentLeadSource = deal.properties?.lead_source || "";
    if (tsLeadSources.length > 0) {
      const tsLeadSourcesStr = tsLeadSources.join("|");
      if (tsLeadSourcesStr !== currentLeadSource) {
        updates.lead_source = tsLeadSourcesStr;
        logger.tripleseat("Syncing selected_lead_sources to HubSpot lead_source", { tsLeadSources, dealId });
      }
    }
    // --------------------------------------------------
    // Event Name SYNC  (name → dealname)
    // Triggered by: Update Event 
    // --------------------------------------------------
    const tsEventName = eventData.name != null ? String(eventData.name) : null;
    if (tsEventName !== null) {
      const currentName = deal.properties?.dealname || "";
      if (tsEventName !== currentName) {
        updates.dealname = tsEventName;
        logger.tripleseat("Syncing event name to HubSpot dealname", { dealId });
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
