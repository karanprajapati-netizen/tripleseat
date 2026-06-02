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

      // --------------------------------------------------
      // RESOLVE TRIPLESEAT OWNER FROM HUBSPOT DEAL OWNER
      // --------------------------------------------------
      let tsOwnedById = 220867;
      const hubspotOwnerId = deal.properties.hubspot_owner_id;
      if (hubspotOwnerId) {
        const owner = await hubspot.getOwner(hubspotOwnerId);
        if (owner?.email) {
          const tsUser = await tripleseat.findUserByEmail(owner.email);
          if (tsUser?.id) {
            tsOwnedById = tsUser.id;
            logger.webhook("Resolved TripleSeat owner from HubSpot deal owner", {
              dealId,
              hubspotOwnerId,
              email: owner.email,
              tsUserId: tsUser.id
            });
          } else {
            logger.webhook("No matching TripleSeat user - using default owner", { dealId, email: owner.email });
          }
        }
      }

      const existingTsEventId = deal.properties.tripleseat_event_id;
      logger.webhook("Existing Tripleseat event ID on deal", { dealId, existingTsEventId });

      // Only the first contact is used for syncing and event creation
      const primaryContactId = contactIds[0];
      let tsEventId = null;

      // --------------------------------------------------
      // RESOLVE DYNAMIC TRIPLESEAT ACCOUNT
      // Scenario 1: deal has an associated HubSpot company (primary if multiple)
      //   -> search Tripleseat by company name; use found or create new
      // Scenario 2: no associated company
      //   -> create (or find existing) account using primary contact's full name
      // Errors here are fatal for this deal - logged to TripleSeat Error logs.
      // --------------------------------------------------
      let tsAccountId = null;
      let cachedPrimaryContact = null; // avoid double-fetch when Scenario 2 already called getContact

      try {
        const company = await hubspot.getAssociatedCompany(dealId);

        if (company?.name) {
          // --- Scenario 1 ---
          logger.webhook("Scenario 1: deal has associated company, resolving Tripleseat account", {
            dealId,
            companyName: company.name
          });

          const existingAccount = await tripleseat.findAccountByName(company.name);

          if (existingAccount) {
            tsAccountId = existingAccount.id;
            logger.webhook("Using existing Tripleseat account", { dealId, accountId: tsAccountId, companyName: company.name });
          } else {
            const newAccount = await tripleseat.createAccount(company.name, tsOwnedById, company.domain, company.phone);
            tsAccountId = newAccount.id;
            logger.webhook("Created new Tripleseat account from company name", { dealId, accountId: tsAccountId, companyName: company.name, domain: company.domain || "none", phone: company.phone || "none" });
          }
        } else {
          // --- Scenario 2 ---
          logger.webhook("Scenario 2: no associated company, resolving account from primary contact name", { dealId, primaryContactId });

          cachedPrimaryContact = await hubspot.getContact(primaryContactId);
          const firstName = cachedPrimaryContact.properties?.firstname || "";
          const lastName = cachedPrimaryContact.properties?.lastname || "";
          const accountName = `${firstName} ${lastName}`.trim() || `Contact ${primaryContactId}`;

          const existingAccount = await tripleseat.findAccountByName(accountName);

          if (existingAccount) {
            tsAccountId = existingAccount.id;
            logger.webhook("Using existing Tripleseat account matched by contact name", { dealId, accountId: tsAccountId, accountName });
          } else {
            const newAccount = await tripleseat.createAccount(accountName, tsOwnedById, null, cachedPrimaryContact.properties?.phone);
            tsAccountId = newAccount.id;
            logger.webhook("Created new Tripleseat account from contact name", { dealId, accountId: tsAccountId, accountName, phone: cachedPrimaryContact.properties?.phone || "none" });
          }
        }
      } catch (err) {
        const msg = `Failed to resolve Tripleseat account: ${apiErrorMsg(err)}`;
        errorLogs.push(msg);
        logger.error("Account resolution failed - skipping event creation", { dealId, error: err.message });
        await hubspot.setErrorLog(dealId, `[${new Date().toUTCString()}]\n• ${msg}`);
        continue;
      }

      // --------------------------------------------------
      // SYNC PRIMARY CONTACT + CREATE / UPDATE EVENT
      // Only the first associated contact is processed.
      // --------------------------------------------------
      let contactEmail = primaryContactId;
      try {
        const contact = cachedPrimaryContact || await hubspot.getContact(primaryContactId);
        contactEmail = contact.properties?.email || primaryContactId;

        const tsContact = await tripleseat.createContact(contact.properties, tsAccountId);
        logger.webhook("Contact pushed", { contactId: primaryContactId, tsId: tsContact.contact?.id, accountId: tsAccountId });

        if (existingTsEventId) {
          await tripleseat.updateEvent(existingTsEventId, deal.properties, tsContact.contact?.id, dealId, tsOwnedById, tsAccountId);
          logger.webhook("Event updated", { eventId: existingTsEventId, accountId: tsAccountId });
          tsEventId = existingTsEventId;
        } else {
          const tsEvent = await tripleseat.createEvent(deal.properties, tsContact.contact?.id, dealId, tsOwnedById, tsAccountId);
          tsEventId = tsEvent.event?.id;
          logger.webhook("Event created", { eventId: tsEventId, accountId: tsAccountId });
        }
      } catch (err) {
        const msg = `Failed to sync contact (${contactEmail}) and event was not created: ${apiErrorMsg(err)}`;
        errorLogs.push(msg);
        logger.error("Contact/event sync failed", { contactId: primaryContactId, dealId, error: err.message });
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