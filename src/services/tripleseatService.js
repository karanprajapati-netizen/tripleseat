const axios = require("axios");
const auth = require("./tripleseatAuthService");
const logger = require("../utils/logger");

const BASE_URL = process.env.TRIPLESEAT_BASE_URL;
const ACCOUNT_ID = process.env.TRIPLESEAT_ACCOUNT_ID;

// Search for existing contact by email
exports.findContactByEmail = async (email) => {
  const startTime = Date.now();
  
  try {
    logger.tripleseat(`Searching for existing contact: ${email}`, {
      accountId: ACCOUNT_ID
    });
    
    const headers = await auth.getHeaders();
    
    const res = await axios.get(
      `${BASE_URL}/v1/contacts.json`,
      { 
        headers,
        params: {
          account_id: ACCOUNT_ID,
          email: email
        }
      }
    );

    const processingTime = Date.now() - startTime;
    const contacts = res.data.contacts || [];
    
    if (contacts.length > 0) {
      logger.tripleseat(`Found existing contact`, {
        email,
        contactId: contacts[0].id,
        totalFound: contacts.length,
        processingTime: `${processingTime}ms`
      });
      return contacts[0]; // Return first match
    }
    
    logger.tripleseat(`No existing contact found`, {
      email,
      processingTime: `${processingTime}ms`
    });
    return null;
    
  } catch (error) {
    logger.error(`Failed to search for contact: ${email}`, {
      error: error.message,
      status: error.response?.status,
      response: error.response?.data
    });
    throw error;
  }
};

// Create Contact (or return existing)
exports.createContact = async (contact) => {
  const startTime = Date.now();
  
  try {
    // First check if contact already exists
    const existingContact = await exports.findContactByEmail(contact.email);
    
    if (existingContact) {
      logger.tripleseat(`Using existing contact for ${contact.email}`, {
        contactId: existingContact.id,
        name: `${existingContact.first_name} ${existingContact.last_name}`
      });
      return { contact: existingContact };
    }
    
    logger.tripleseat(`Creating new contact for ${contact.email}`, {
      name: `${contact.firstname} ${contact.lastname}`,
      phone: contact.phone || 'none',
      accountId: ACCOUNT_ID
    });
    
    const headers = await auth.getHeaders();
    
    const contactData = {
      first_name: contact.firstname || "",
      last_name: contact.lastname || "",
      email: contact.email,
      phone_number: contact.phone || "",
      account_id: ACCOUNT_ID
    };
    
    const res = await axios.post(
      `${BASE_URL}/v1/contacts.json`,
      { contact: contactData },
      { headers }
    );

    const processingTime = Date.now() - startTime;
    logger.tripleseat(`Contact created successfully`, {
      email: contact.email,
      tripleseatContactId: res.data.contact?.id,
      processingTime: `${processingTime}ms`
    });
    
    return res.data;
  } catch (error) {
    logger.error(`Failed to create contact for ${contact.email}`, {
      error: error.message,
      status: error.response?.status,
      response: error.response?.data
    });
    throw error;
  }
};

// Create Event
exports.createEvent = async (deal, contactId) => {
  const startTime = Date.now();
  
  try {
    logger.tripleseat(`Creating event for deal: ${deal.dealname}`, {
      contactId,
      dealStage: deal.dealstage,
      closeDate: deal.closedate || 'none'
    });
    
    const headers = await auth.getHeaders();
    
    // Format dates as MM/DD/YYYY HH:MM AM/PM
    const formatDate = (date) => {
      const d = new Date(date);
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const year = d.getFullYear();
      const hours = d.getHours();
      const minutes = String(d.getMinutes()).padStart(2, '0');
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const formattedHours = hours % 12 || 12;
      
      return `${month}/${day}/${year} ${formattedHours}:${minutes} ${ampm}`;
    };
    
    // Use deal close date if available, otherwise default to today 6PM-9PM
    let eventStart, eventEnd;
    if (deal.closedate) {
      const closeDate = new Date(deal.closedate);
      eventStart = formatDate(closeDate);
      eventEnd = formatDate(new Date(closeDate.getTime() + 3 * 60 * 60 * 1000)); // +3 hours
    } else {
      const today = new Date();
      today.setHours(18, 0, 0, 0); // 6:00 PM today
      eventStart = formatDate(today);
      eventEnd = formatDate(new Date(today.getTime() + 3 * 60 * 60 * 1000)); // 9:00 PM today
    }
    
    const eventData = {
      name: deal.dealname || "Event from HubSpot",
      status: mapDealStageToEventStatus(deal.dealstage),
      contact_id: contactId,
      account_id: parseInt(ACCOUNT_ID),
      event_start: eventStart,
      event_end: eventEnd,
      location_id: 20271,
      room_ids: [238254],
      booking: {
        status: "pending",
        source: "HubSpot Integration"
      }
    };
    
    const res = await axios.post(
      `${BASE_URL}/v1/events.json`,
      { event: eventData },
      { headers }
    );

    const processingTime = Date.now() - startTime;
    logger.tripleseat(`Event created successfully`, {
      eventName: eventData.name,
      tripleseatEventId: res.data.event?.id,
      eventDates: `${eventStart} - ${eventEnd}`,
      processingTime: `${processingTime}ms`
    });
    
    return res.data;
  } catch (error) {
    logger.error(`Failed to create event for deal: ${deal.dealname}`, {
      contactId,
      error: error.message,
      status: error.response?.status,
      response: error.response?.data
    });
    throw error;
  }
};

// Helper function to map HubSpot deal stages to Tripleseat event statuses
function mapDealStageToEventStatus(dealStage) {
  const statusMap = {
    'open': 'PROSPECT',
    'appointment scheduled': 'TENTATIVE', 
    'qualified to buy': 'DEFINITE',
    'presentation scheduled': 'TENTATIVE',
    'decision maker bought-in': 'DEFINITE',
    'contract sent': 'DEFINITE',
    'closed won': 'DEFINITE',
    'closed lost': 'LOST',
    'default': 'PROSPECT'
  };
  
  return statusMap[dealStage?.toLowerCase()] || statusMap['default'];
}