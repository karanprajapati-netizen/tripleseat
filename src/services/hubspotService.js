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
      `${BASE_URL}/crm/v3/objects/deals/${dealId}?properties=dealname,dealstage,tripleseat_push,event_date,amount,tripleseat_event_id,number_of_guests__cloned__,lead_source,event_details,hubspot_owner_id`,
      { headers }
    );

    const processingTime = Date.now() - startTime;
    logger.hubspot(`Deal retrieved successfully`, {
      dealId,
      dealName: res.data.properties.dealname,
      dealStage: res.data.properties.dealstage,
      tripleseatPush: res.data.properties.tripleseat_push,
      eventDate: res.data.properties.event_date,
      guestCount: res.data.properties.number_of_guests__cloned__,
      leadSource: res.data.properties.lead_source,
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
        properties: ["dealname", "dealstage", "amount", "tripleseat_event_id", "event_date", "number_of_guests__cloned__", "event_details"]
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

// Write a message to the tripleseat_error_logs property on a deal.
// Pass an empty string to clear the field after a successful sync.
exports.setErrorLog = async (dealId, message) => {
  try {
    await axios.patch(
      `${BASE_URL}/crm/v3/objects/deals/${dealId}`,
      { properties: { tripleseat_error_logs: message } },
      { headers }
    );
  } catch (err) {
    // Non-fatal - log locally but don't throw so main flow is unaffected
    logger.error(`Failed to write error log to deal ${dealId}`, { error: err.message });
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

// Get a HubSpot owner by ID (returns email and name)
// Tries v3 first; falls back to v2 if the token lacks crm.objects.owners.
exports.getOwner = async (ownerId) => {
  try {
    const res = await axios.get(
      `${BASE_URL}/crm/v3/owners/${ownerId}`,
      { headers }
    );
    return res.data;
  } catch (err) {
    if (err.response?.status === 403) {
      try {
        const res = await axios.get(
          `${BASE_URL}/owners/v2/owners/${ownerId}`,
          { headers }
        );
        return res.data;
      } catch (fallbackErr) {
        logger.error(`Failed to fetch HubSpot owner ${ownerId} (v2 fallback)`, {
          error: fallbackErr.message,
          status: fallbackErr.response?.status
        });
        return null;
      }
    }
    logger.error(`Failed to fetch HubSpot owner ${ownerId}`, {
      error: err.message,
      status: err.response?.status
    });
    return null;
  }
};

// Get associated company for a deal (returns { name, ... } or null)
exports.getAssociatedCompany = async (dealId) => {
  logger.hubspot(`Fetching associated company for deal ${dealId}`);

  const assocRes = await axios.get(
    `${BASE_URL}/crm/v4/objects/deals/${dealId}/associations/companies`,
    { headers }
  );

  const results = assocRes.data.results || [];

  if (!results.length) {
    logger.hubspot(`No company associated with deal ${dealId}`);
    return null;
  }

  // Prefer the primary company; fall back to first if none is marked primary
  const primaryResult = results.find(r =>
    r.associationTypes?.some(t => t.label === "Primary")
  ) || results[0];

  const isPrimary = primaryResult.associationTypes?.some(t => t.label === "Primary");

  const companyRes = await axios.get(
    `${BASE_URL}/crm/v3/objects/companies/${primaryResult.toObjectId}?properties=name,domain,phone`,
    { headers }
  );

  const company = companyRes.data.properties;
  logger.hubspot(`Found associated company`, {
    dealId,
    companyId: primaryResult.toObjectId,
    companyName: company.name,
    isPrimary,
    totalAssociated: results.length
  });
  return company;
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