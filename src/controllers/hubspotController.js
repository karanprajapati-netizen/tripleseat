const hubspot = require("../services/hubspotService");
const tripleseat = require("../services/tripleseatService");
const logger = require("../utils/logger");

exports.handleWebhook = async (req, res) => {
  const startTime = Date.now();
  
  logger.webhook(`Deal webhook received`, {
    dealId: req.body.objectId,
    timestamp: new Date().toISOString()
  });

  try {
    const dealId = req.body.objectId;
    
    if (!dealId) {
      logger.error(`No deal ID in webhook payload`);
      return res.status(400).json({ error: "Missing deal ID" });
    }

    // 1. Get deal details
    const deal = await hubspot.getDeal(dealId);
    
    logger.webhook(`Processing deal: ${deal.properties.dealname}`, {
      dealId,
      dealStage: deal.properties.dealstage,
      tripleseatPush: deal.properties.tripleseat_push
    });

    // Check if deal should be processed
    if (deal.properties.tripleseat_push !== "Yes") {
      logger.webhook(`Skipping deal - tripleseat_push is not "Yes"`, {
        dealId,
        tripleseatPush: deal.properties.tripleseat_push
      });
      return res.sendStatus(200);
    }

    // 2. Get associated contacts
    const contactIds = await hubspot.getAssociatedContacts(dealId);

    if (!contactIds || contactIds.length === 0) {
      logger.webhook(`Skipping deal - no associated contacts found`, { dealId });
      return res.sendStatus(200);
    }

    logger.webhook(`Found ${contactIds.length} contacts to process`, {
      dealId,
      contactIds
    });

    // 3. Process each contact
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

    res.status(200).json({
      message: "Webhook processed successfully",
      dealId,
      processedContacts: results.success,
      failedContacts: results.failed,
      processingTime: totalProcessingTime
    });

  } catch (error) {
    const totalProcessingTime = Date.now() - startTime;
    
    logger.error(`Critical error in webhook processing`, {
      error: error.message,
      stack: error.stack,
      processingTime: `${totalProcessingTime}ms`
    });

    res.status(500).json({
      error: "Internal server error",
      message: error.message
    });
  }
};