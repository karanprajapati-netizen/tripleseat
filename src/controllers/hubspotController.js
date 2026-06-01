const hubspot = require("../services/hubspotService");
const tripleseat = require("../services/tripleseatService");
const logger = require("../utils/logger");

exports.handleWebhook = async (req, res) => {
  const startTime = Date.now();

  let events = [];

  //  Handle HubSpot array payload
  if (Array.isArray(req.body)) {
    events = req.body;
  } else {
    events = [req.body]; // fallback
  }

  try {
    for (const event of events) {

      let dealId;

      // --------------------------------------------------
      // HANDLE DIFFERENT PAYLOAD TYPES
      // --------------------------------------------------
      if (event.deal) {
        dealId = event.deal.id;

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
      // FETCH DEAL (always fresh - webhook payload may have incomplete properties)
      // --------------------------------------------------
      const deal = await hubspot.getDeal(dealId);

      if (deal.properties.tripleseat_push !== "true") {
        continue;
      }

      const dealName = deal.properties.dealname || `Deal ${dealId}`;
      const errorLogs = [];

      // Helper: extract a readable error message from an API error
      const apiErrorMsg = (err) => {
        const detail = err.response?.data?.errors;
        if (detail) return JSON.stringify(detail).replace(/[{}"]/g, '').trim();
        return err.message;
      };

      // --------------------------------------------------
      // CONTACTS
      // --------------------------------------------------
      const contactIds = await hubspot.getAssociatedContacts(dealId);

      if (!contactIds?.length) {
        const msg = `No contacts are associated with this deal. Event was not created.`;
        logger.webhook(msg, { dealId });
        await hubspot.setErrorLog(dealId, `[${new Date().toUTCString()}]\n• ${msg}`);
        continue;
      }

      const existingTsEventId = deal.properties.tripleseat_event_id;
      logger.webhook("Existing Tripleseat event ID on deal", { dealId, existingTsEventId });

      const primaryContactId = contactIds[0];
      let tsEventId = null;

      for (const contactId of contactIds) {
        let contactEmail = contactId;
        try {
          const contact = await hubspot.getContact(contactId);
          contactEmail = contact.properties?.email || contactId;

          const tsContact = await tripleseat.createContact(contact.properties);
          logger.webhook("Contact pushed", { contactId, tsId: tsContact.contact?.id });

          if (contactId === primaryContactId) {
            if (existingTsEventId) {
              await tripleseat.updateEvent(existingTsEventId, deal.properties, tsContact.contact?.id, dealId);
              logger.webhook("Event updated", { eventId: existingTsEventId });
              tsEventId = existingTsEventId;
            } else {
              const tsEvent = await tripleseat.createEvent(deal.properties, tsContact.contact?.id, dealId);
              tsEventId = tsEvent.event?.id;
              logger.webhook("Event created", { eventId: tsEventId });
            }
          }

        } catch (err) {
          const msg = contactId === primaryContactId
            ? `Failed to sync contact (${contactEmail}) and event was not created: ${apiErrorMsg(err)}`
            : `Failed to sync contact (${contactEmail}): ${apiErrorMsg(err)}`;
          errorLogs.push(msg);
          logger.error("Contact/event sync failed", { contactId, dealId, error: err.message });
        }
      }

      // --------------------------------------------------
      // WRITE TRIPLESEAT EVENT ID BACK (first create only)
      // --------------------------------------------------
      if (tsEventId && !existingTsEventId) {
        try {
          await hubspot.updateDeal(dealId, { tripleseat_event_id: String(tsEventId) });
          logger.webhook("Tripleseat event ID saved to HubSpot deal", { dealId, tsEventId });
        } catch (err) {
          const msg = `Event created (ID: ${tsEventId}) but failed to save TripleSeat ID back to deal: ${err.message}`;
          errorLogs.push(msg);
          logger.error("Failed to save tripleseat_event_id to deal", { dealId, error: err.message });
        }
      }

      // --------------------------------------------------
      // WRITE ERROR LOG TO HUBSPOT DEAL
      // --------------------------------------------------
      if (errorLogs.length > 0) {
        const body = errorLogs.map(e => `• ${e}`).join('\n');
        await hubspot.setErrorLog(dealId, `[${new Date().toUTCString()}]\n${body}`);
      } else {
        // Clear the field - empty = last sync was clean
        await hubspot.setErrorLog(dealId, '');
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