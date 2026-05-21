const hubspot = require("../services/hubspotService");
const logger = require("../utils/logger");

// TripleSeat status → HubSpot deal stage mapping
// Override these via env vars to match your HubSpot pipeline stage IDs
const TS_STATUS_TO_HS_STAGE = {
  PROSPECT:  process.env.HS_STAGE_PROSPECT  || "appointmentscheduled",
  TENTATIVE: process.env.HS_STAGE_TENTATIVE || "presentationscheduled",
  DEFINITE:  process.env.HS_STAGE_DEFINITE  || "closedwon",
  LOST:      process.env.HS_STAGE_LOST      || "closedlost"
};


// Extract the best available booking amount from the payload
const extractAmount = (bookings = []) => {
  const activeBookings = bookings.filter(
    (b) => b.status !== "cancelled" && b.status !== "lost"
  );
  if (activeBookings.length === 0) return null;

  const total = activeBookings.reduce((sum, b) => {
    const amount = parseFloat(
      b.estimated_amount ?? b.total_amount ?? b.subtotal ?? 0
    );
    return sum + amount;
  }, 0);

  return total > 0 ? total : null;
};

exports.handleWebhook = async (req, res) => {
  const startTime = Date.now();

  try {
    const payload = req.body;

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
    // Triggered by: Update Booking (payload includes bookings because
    // "Include Event Payment and Line Item Information" is checked)
    // --------------------------------------------------
    const bookings = eventData.bookings || [];
    const amount = extractAmount(bookings);
    if (amount !== null) {
      const currentAmount = parseFloat(deal.properties?.amount || 0);
      if (amount !== currentAmount) {
        updates.amount = String(amount);
        logger.tripleseat("Syncing booking amount to HubSpot", {
          amount,
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
