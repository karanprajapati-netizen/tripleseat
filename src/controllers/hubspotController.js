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

      for (const contactId of contactIds) {
        try {
          const contact = await hubspot.getContact(contactId);
          const tsContact = await tripleseat.createContact(contact.properties);
          const tsEvent = await tripleseat.createEvent(deal.properties, tsContact.contact?.id);
          logger.webhook("Contact pushed", {
            contactId,
            tsId: tsContact.contact?.id
          });
          logger.webhook("Event created", {
            eventId: tsEvent.event?.id
          });

        } catch (err) {
          logger.error("Contact failed", {
            contactId,
            error: err.message
          });
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