const hubspot = require("../services/hubspotService");
const tripleseat = require("../services/tripleseatService");
const logger = require("../utils/logger");

exports.handleWebhook = async (req, res) => {
  const startTime = Date.now();

  let events = [];

  // 🔥 Handle HubSpot array payload
  if (Array.isArray(req.body)) {
    events = req.body;
  } else {
    events = [req.body]; // fallback
  }

  try {
    for (const event of events) {

      let dealId;
      let dealData = null;

      // --------------------------------------------------
      // HANDLE DIFFERENT PAYLOAD TYPES
      // --------------------------------------------------
      if (event.deal) {
        dealData = event.deal;
        dealId = dealData.id;

      } else if (event.objectId) {
        dealId = event.objectId;

      } else {
        logger.error("Invalid event format", { event });
        continue; // skip instead of failing entire webhook
      }

      logger.webhook("Processing event", { dealId });

      // --------------------------------------------------
      // PROPERTY FILTER (VERY IMPORTANT)
      // --------------------------------------------------
      if (
        event.propertyName &&
        event.propertyName !== "tripleseat_push"
      ) {
        logger.webhook("Skipping - not tripleseat_push change", { dealId });
        continue;
      }

      if (
        event.propertyValue &&
        event.propertyValue !== "true"
      ) {
        logger.webhook("Skipping - tripleseat_push not true", { dealId });
        continue;
      }

      // --------------------------------------------------
      // FETCH DEAL
      // --------------------------------------------------
      let deal;

      if (dealData?.properties) {
        deal = dealData;
      } else {
        deal = await hubspot.getDeal(dealId);
      }

      if (deal.properties.tripleseat_push !== "true") {
        continue;
      }

      // --------------------------------------------------
      // YOUR EXISTING LOGIC (UNCHANGED)
      // --------------------------------------------------
      const contactIds = await hubspot.getAssociatedContacts(dealId);

      if (!contactIds?.length) continue;

      // Check if a Tripleseat event already exists for this deal (deduplication)
      const existingTsEventId = deal.properties.tripleseat_event_id;
      if (existingTsEventId) {
        logger.webhook("Skipping - Tripleseat event already exists for this deal", {
          dealId,
          existingTsEventId
        });
        continue;
      }

      // Only process the first associated contact for event creation
      const primaryContactId = contactIds[0];
      let tsEventId = null;

      for (const contactId of contactIds) {
        try {
          const contact = await hubspot.getContact(contactId);
          const tsContact = await tripleseat.createContact(contact.properties);
          logger.webhook("Contact pushed", {
            contactId,
            tsId: tsContact.contact?.id
          });

          // Create the event once using the primary contact
          if (contactId === primaryContactId) {
            const tsEvent = await tripleseat.createEvent(deal.properties, tsContact.contact?.id, dealId);
            tsEventId = tsEvent.event?.id;
            logger.webhook("Event created", { eventId: tsEventId });
          }

        } catch (err) {
          logger.error("Contact failed", {
            contactId,
            error: err.message
          });
        }
      }

      // Write the Tripleseat event ID back to the HubSpot deal for cross-system linking
      if (tsEventId) {
        try {
          await hubspot.updateDeal(dealId, { tripleseat_event_id: String(tsEventId) });
          logger.webhook("Tripleseat event ID saved to HubSpot deal", { dealId, tsEventId });
        } catch (err) {
          logger.error("Failed to save tripleseat_event_id to deal", { dealId, error: err.message });
        }
      }
    }

    return res.status(200).json({ 
      success: true,
      message: "Webhook processed successfully",
      processingTime: `${Date.now() - startTime}ms`
    });

  } catch (error) {
    logger.error("Webhook error", {
      error: error.message
    });

    return res.status(500).json({ 
      success: false,
      error: error.message,
      processingTime: `${Date.now() - startTime}ms`
    });
  }
};