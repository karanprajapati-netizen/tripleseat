const hubspot = require("../services/hubspotService");
const tripleseat = require("../services/tripleseatService");
const logger = require("../utils/logger");

exports.handleWebhook = async (req, res) => {
  const startTime = Date.now();

  // Handle new payload structure with deal object
  let dealData, dealId;
  
  if (req.body.deal) {
    // New payload format: { "deal": { "id": "...", "properties": {...} } }
    dealData = req.body.deal;
    dealId = dealData.id;
  } else if (req.body.objectId) {
    // Old payload format: { "objectId": "..." }
    dealId = req.body.objectId;
    dealData = null;
  } else {
    logger.error(`Invalid webhook payload structure`, {
      body: req.body
    });
    return res.status(400).json({ 
      success: false,
      message: "Invalid webhook payload structure. Expected {deal: {id, properties}} or {objectId}"
    });
  }

  logger.webhook(`Deal webhook received`, {
    dealId,
    hasDealData: !!dealData,
    timestamp: new Date().toISOString()
  });

  try {
    // Get deal details (from payload or API)
    let deal;
    if (dealData && dealData.properties) {
      // Use deal data from webhook payload
      deal = dealData;
      logger.webhook(`Using deal data from webhook payload`, {
        dealId,
        dealName: deal.properties.dealname
      });
    } else {
      // Fetch deal from HubSpot API
      deal = await hubspot.getDeal(dealId);
      logger.webhook(`Fetched deal from HubSpot API`, {
        dealId,
        dealName: deal.properties.dealname
      });
    }

    // Check if deal should be processed - check for "true" (not "Yes")
    if (deal.properties.tripleseat_push !== "true") {
      logger.webhook(`Skipping deal - tripleseat_push is not "true"`, {
        dealId,
        tripleseatPush: deal.properties.tripleseat_push
      });
      return res.status(200).json({ 
        success: true,
        message: `Deal skipped - tripleseat_push is "${deal.properties.tripleseat_push}" (expected "true")`,
        dealId,
        processed: false
      });
    }

    logger.webhook(`Processing deal: ${deal.properties.dealname}`, {
      dealId,
      dealStage: deal.properties.dealstage,
      tripleseatPush: deal.properties.tripleseat_push
    });

    // Get associated contacts
    const contactIds = await hubspot.getAssociatedContacts(dealId);

    if (!contactIds || contactIds.length === 0) {
      logger.webhook(`Skipping deal - no associated contacts found`, { dealId });
      return res.status(200).json({ 
        success: true,
        message: `Deal skipped - no associated contacts found`,
        dealId,
        processed: false
      });
    }

    logger.webhook(`Found ${contactIds.length} contacts to process`, {
      dealId,
      contactIds
    });

    // Process each contact
    const results = { success: 0, failed: 0, details: [] };
    
    for (let i = 0; i < contactIds.length; i++) {
      const contactId = contactIds[i];
      
      try {
        logger.webhook(`Processing contact ${i + 1}/${contactIds.length}`, {
          contactId
        });

        // Get contact details
        const contact = await hubspot.getContact(contactId);
        
        logger.webhook(`Contact retrieved: ${contact.properties.email}`, {
          name: `${contact.properties.firstname} ${contact.properties.lastname}`
        });

        // Create Tripleseat contact
        const tsContact = await tripleseat.createContact(contact.properties);
        
        // Create Tripleseat event
        const tsEvent = await tripleseat.createEvent(deal.properties, tsContact.contact?.id);

        results.success++;
        results.details.push({
          contactId,
          email: contact.properties.email,
          tripleseatContactId: tsContact.contact?.id,
          tripleseatEventId: tsEvent.event?.id,
          status: 'success'
        });

        logger.webhook(`Successfully processed contact ${contact.properties.email}`, {
          tripleseatContactId: tsContact.contact?.id,
          tripleseatEventId: tsEvent.event?.id
        });

      } catch (error) {
        results.failed++;
        results.details.push({
          contactId,
          status: 'error',
          error: error.message
        });

        logger.error(`Failed to process contact ${contactId}`, {
          error: error.message,
          response: error.response?.data
        });
      }
    }

    const totalProcessingTime = Date.now() - startTime;
    
    logger.webhook(`Webhook processing completed`, {
      dealId,
      totalContacts: contactIds.length,
      success: results.success,
      failed: results.failed,
      processingTime: `${totalProcessingTime}ms`
    });

    return res.status(200).json({
      success: true,
      message: `Successfully processed ${results.success} contacts for deal "${deal.properties.dealname}"`,
      dealId,
      dealName: deal.properties.dealname,
      totalContacts: contactIds.length,
      processedContacts: results.success,
      failedContacts: results.failed,
      processingTime: `${totalProcessingTime}ms`,
      details: results.details
    });

  } catch (error) {
    const totalProcessingTime = Date.now() - startTime;
    
    logger.error(`Critical error in webhook processing`, {
      dealId,
      error: error.message,
      stack: error.stack,
      processingTime: `${totalProcessingTime}ms`
    });

    return res.status(500).json({
      success: false,
      message: `Webhook processing failed: ${error.message}`,
      dealId,
      error: error.message,
      processingTime: `${totalProcessingTime}ms`
    });
  }
};