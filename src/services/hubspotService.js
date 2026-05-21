const axios = require("axios");
const logger = require("../utils/logger");

const BASE_URL = "https://api.hubapi.com";
const TOKEN = process.env.HUBSPOT_TOKEN;

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  "Content-Type": "application/json"
};

// Get Contact
exports.getContact = async (contactId) => {
  const startTime = Date.now();

  try {
    logger.hubspot(`Fetching contact ${contactId}`, {
      properties: ["firstname", "lastname", "email", "phone", "company", "jobtitle"]
    });

    const res = await axios.get(
      `${BASE_URL}/crm/v3/objects/contacts/${contactId}?properties=firstname,lastname,email,phone,company,jobtitle`,
      { headers }
    );
    
    const processingTime = Date.now() - startTime;
    logger.hubspot(`Contact retrieved successfully`, {
      contactId,
      email: res.data.properties.email,
      name: `${res.data.properties.firstname} ${res.data.properties.lastname}`,
      processingTime: `${processingTime}ms`
    });
    
    return res.data;
  } catch (error) {
    logger.error(`Failed to fetch contact ${contactId}`, {
      error: error.message,
      status: error.response?.status,
      response: error.response?.data
    });
    throw error;
  }
};

// Get ALL associated deals
exports.getAssociatedDeals = async (contactId) => {
  const startTime = Date.now();
  
  try {
    logger.hubspot(`Fetching associated deals for contact ${contactId}`);
    
    const res = await axios.get(
      `${BASE_URL}/crm/v4/objects/contacts/${contactId}/associations/deals`,
      { headers }
    );

    const dealIds = res.data.results.map(d => d.toObjectId);
    const processingTime = Date.now() - startTime;
    
    logger.hubspot(`Found ${dealIds.length} associated deals`, {
      contactId,
      dealIds,
      processingTime: `${processingTime}ms`
    });
    
    return dealIds;
  } catch (error) {
    logger.error(`Failed to fetch associated deals for contact ${contactId}`, {
      error: error.message,
      status: error.response?.status
    });
    throw error;
  }
};

// Get Deal
exports.getDeal = async (dealId) => {
  const startTime = Date.now();
  
  try {
    logger.hubspot(`Fetching deal ${dealId}`);
    
    const res = await axios.get(
      `${BASE_URL}/crm/v3/objects/deals/${dealId}?properties=dealname,dealstage,tripleseat_push,closedate,amount,tripleseat_event_id`,
      { headers }
    );

    const processingTime = Date.now() - startTime;
    logger.hubspot(`Deal retrieved successfully`, {
      dealId,
      dealName: res.data.properties.dealname,
      dealStage: res.data.properties.dealstage,
      tripleseatPush: res.data.properties.tripleseat_push,
      closeDate: res.data.properties.closedate,
      eventDate: res.data.properties.event_date,
      amount: res.data.properties.amount,
      tripleseatEventId: res.data.properties.tripleseat_event_id,
      processingTime: `${processingTime}ms`
    });
    
    return res.data;
  } catch (error) {
    logger.error(`Failed to fetch deal ${dealId}`, {
      error: error.message,
      status: error.response?.status
    });
    throw error;
  }
};

// Find a HubSpot deal by its linked Tripleseat event ID (reverse lookup for inbound TS webhooks)
exports.findDealByTripleseatEventId = async (tripleseatEventId) => {
  const startTime = Date.now();

  try {
    logger.hubspot(`Searching deal by tripleseat_event_id: ${tripleseatEventId}`);

    const res = await axios.post(
      `${BASE_URL}/crm/v3/objects/deals/search`,
      {
        filterGroups: [{
          filters: [{
            propertyName: "tripleseat_event_id",
            operator: "EQ",
            value: String(tripleseatEventId)
          }]
        }],
        properties: ["dealname", "dealstage", "amount", "tripleseat_event_id"]
      },
      { headers }
    );

    const deals = res.data.results || [];
    const processingTime = Date.now() - startTime;

    if (deals.length === 0) {
      logger.hubspot(`No deal found for tripleseat_event_id: ${tripleseatEventId}`, { processingTime: `${processingTime}ms` });
      return null;
    }

    logger.hubspot(`Deal found for tripleseat_event_id: ${tripleseatEventId}`, {
      dealId: deals[0].id,
      dealName: deals[0].properties.dealname,
      processingTime: `${processingTime}ms`
    });

    return deals[0];
  } catch (error) {
    logger.error(`Failed to search deal by tripleseat_event_id: ${tripleseatEventId}`, {
      error: error.message,
      status: error.response?.status,
      response: error.response?.data
    });
    throw error;
  }
};

// Update Deal properties (used to write back Tripleseat IDs)
exports.updateDeal = async (dealId, properties) => {
  const startTime = Date.now();

  try {
    logger.hubspot(`Updating deal ${dealId}`, { properties });

    const res = await axios.patch(
      `${BASE_URL}/crm/v3/objects/deals/${dealId}`,
      { properties },
      { headers }
    );

    const processingTime = Date.now() - startTime;
    logger.hubspot(`Deal updated successfully`, {
      dealId,
      properties,
      processingTime: `${processingTime}ms`
    });

    return res.data;
  } catch (error) {
    logger.error(`Failed to update deal ${dealId}`, {
      error: error.message,
      status: error.response?.status,
      response: error.response?.data
    });
    throw error;
  }
};

// Get associated contacts for a deal
exports.getAssociatedContacts = async (dealId) => {
  const startTime = Date.now();
  
  try {
    logger.hubspot(`Fetching associated contacts for deal ${dealId}`);
    
    const res = await axios.get(
      `${BASE_URL}/crm/v4/objects/deals/${dealId}/associations/contacts`,
      { headers }
    );

    const contactIds = res.data.results.map(c => c.toObjectId);
    const processingTime = Date.now() - startTime;
    
    logger.hubspot(`Found ${contactIds.length} associated contacts`, {
      dealId,
      contactIds,
      processingTime: `${processingTime}ms`
    });
    
    return contactIds;
  } catch (error) {
    logger.error(`Failed to fetch associated contacts for deal ${dealId}`, {
      error: error.message,
      status: error.response?.status
    });
    throw error;
  }
};