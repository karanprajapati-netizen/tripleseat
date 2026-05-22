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
          search_query: email
        }
      }
    );

    const processingTime = Date.now() - startTime;

    // TripleSeat returns fuzzy search results so filter by exact email match
    const allContacts = res.data.contacts || [];
    const contacts = allContacts.filter(c =>
      c.email_addresses?.some(e => e.address?.toLowerCase() === email.toLowerCase())
    );

    if (contacts.length > 0) {
      logger.tripleseat(`Found existing contact`, {
        email,
        contactId: contacts[0].id,
        totalFound: contacts.length,
        processingTime: `${processingTime}ms`
      });
      return contacts[0];
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
      account_id: ACCOUNT_ID,
      email_addresses: [{ address: contact.email, label: "Work" }],
      phone_numbers: contact.phone ? [{ number: contact.phone, label: "Work" }] : []
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

// Format datetime as MM/DD/YYYY HH:MM AM/PM (TripleSeat expected format)
function formatDateTime(date) {
  const d = new Date(date);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const year = d.getFullYear();
  const hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const formattedHours = hours % 12 || 12;
  return `${month}/${day}/${year} ${formattedHours}:${minutes} ${ampm}`;
}

// Format date-only as MM/DD/YYYY (TripleSeat date picker format)
function formatDateOnly(date) {
  const d = new Date(date);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const year = d.getFullYear();
  return `${month}/${day}/${year}`;
}

// Build the TripleSeat event payload from a HubSpot deal
function buildEventData(deal, contactId) {
  // event_date is date-only from HubSpot; use current time for start, +1hr for end
  const now = new Date();
  const endTime = new Date(now.getTime() + 60 * 60 * 1000);

  let eventStart, eventEnd, tsEventDate;

  if (deal.event_date) {
    // Parse the date portion from HubSpot, combine with current wall-clock time
    const datePart = new Date(deal.event_date);
    const start = new Date(
      datePart.getUTCFullYear(),
      datePart.getUTCMonth(),
      datePart.getUTCDate(),
      now.getHours(),
      now.getMinutes(),
      0
    );
    const end = new Date(start.getTime() + 60 * 60 * 1000);

    tsEventDate = formatDateOnly(datePart);
    eventStart = formatDateTime(start);
    eventEnd = formatDateTime(end);
  } else {
    tsEventDate = formatDateOnly(now);
    eventStart = formatDateTime(now);
    eventEnd = formatDateTime(endTime);
  }

  const dealAmount = deal.amount ? parseFloat(deal.amount) : null;
  const guestCount = deal.number_of_guests__cloned__ ? parseInt(deal.number_of_guests__cloned__) : null;
  const leadSources = deal.lead_source ? [deal.lead_source] : [];

  return {
    eventStart,
    eventEnd,
    payload: {
      name: deal.dealname || "Event from HubSpot",
      status: mapDealStageToEventStatus(deal.dealstage),
      contact_id: contactId,
      account_id: parseInt(ACCOUNT_ID),
      event_date: tsEventDate,
      event_start: eventStart,
      event_end: eventEnd,
      location_id: 20271,
      room_ids: [238254],
      description: deal.event_details || "",
      ...(dealAmount ? { actual_amount: dealAmount } : {}),
      ...(guestCount ? { guest_count: guestCount } : {}),
      ...(leadSources.length ? { selected_lead_sources: leadSources } : {}),
      booking: {
        status: mapDealStageToEventStatus(deal.dealstage).toLowerCase(),
        source: "HubSpot Integration"
      }
    }
  };
}

// Create Event
exports.createEvent = async (deal, contactId, hubspotDealId) => {
  const startTime = Date.now();

  try {
    logger.tripleseat(`Creating event for deal: ${deal.dealname}`, {
      contactId,
      hubspotDealId,
      dealStage: deal.dealstage,
      eventDate: deal.event_date || 'none',
      guestCount: deal.number_of_guests__cloned__ || 'none',
      leadSource: deal.lead_source || 'none',
      amount: deal.amount || 'none'
    });

    const headers = await auth.getHeaders();
    const { eventStart, eventEnd, payload } = buildEventData(deal, contactId);

    const res = await axios.post(
      `${BASE_URL}/v1/events.json`,
      { event: payload },
      { headers }
    );

    const processingTime = Date.now() - startTime;
    logger.tripleseat(`Event created successfully`, {
      eventName: payload.name,
      tripleseatEventId: res.data.event?.id,
      eventDates: `${eventStart} - ${eventEnd}`,
      grandTotal: payload.actual_amount || 'none',
      hubspotDealId,
      processingTime: `${processingTime}ms`
    });

    return res.data;
  } catch (error) {
    logger.error(`Failed to create event for deal: ${deal.dealname}`, {
      contactId,
      hubspotDealId,
      error: error.message,
      status: error.response?.status,
      response: error.response?.data
    });
    throw error;
  }
};

// Update existing TripleSeat event from updated HubSpot deal
exports.updateEvent = async (tsEventId, deal, contactId, hubspotDealId) => {
  const startTime = Date.now();

  try {
    logger.tripleseat(`Updating event ${tsEventId} for deal: ${deal.dealname}`, {
      contactId,
      hubspotDealId,
      dealStage: deal.dealstage,
      eventDate: deal.event_date || 'none',
      guestCount: deal.number_of_guests__cloned__ || 'none',
      leadSource: deal.lead_source || 'none',
      amount: deal.amount || 'none'
    });

    const headers = await auth.getHeaders();
    const { eventStart, eventEnd, payload } = buildEventData(deal, contactId);

    const res = await axios.put(
      `${BASE_URL}/v1/events/${tsEventId}.json`,
      { event: payload },
      { headers }
    );

    const processingTime = Date.now() - startTime;
    logger.tripleseat(`Event updated successfully`, {
      eventName: payload.name,
      tripleseatEventId: tsEventId,
      eventDates: `${eventStart} - ${eventEnd}`,
      grandTotal: payload.actual_amount || 'none',
      hubspotDealId,
      processingTime: `${processingTime}ms`
    });

    return res.data;
  } catch (error) {
    logger.error(`Failed to update event ${tsEventId} for deal: ${deal.dealname}`, {
      contactId,
      hubspotDealId,
      error: error.message,
      status: error.response?.status,
      response: error.response?.data
    });
    throw error;
  }
};

// Helper function to map HubSpot deal stage IDs (Event Sales Pipeline) to Tripleseat event statuses
function mapDealStageToEventStatus(dealStage) {
  const statusMap = {
    '2822434791': 'TENTATIVE',  // Qualified Lead
    '2822424509': 'TENTATIVE',  // Tour Booked
    '2847159289': 'TENTATIVE',  // Tour Complete
    '2847160250': 'TENTATIVE',  // Preparing Proposal
    '2822434792': 'TENTATIVE',  // Quote Sent
    '2822434793': 'TENTATIVE',  // Contract Sent
    '2822434794': 'DEFINITE',   // Closed Won (deposit received)
    '2822434795': 'LOST'        // Closed Lost
  };

  return statusMap[dealStage] || 'TENTATIVE';
}