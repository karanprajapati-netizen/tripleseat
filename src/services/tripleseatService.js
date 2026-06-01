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
      `${BASE_URL}/v1/contacts/search.json`,
      {
        headers,
        params: { query: email }
      }
    );

    const processingTime = Date.now() - startTime;

    // Log the raw response keys so we know what the search endpoint actually returns
    logger.tripleseat(`Contact search response keys`, {
      email,
      topLevelKeys: Object.keys(res.data || {}),
      isArray: Array.isArray(res.data),
      rawPreview: JSON.stringify(res.data).substring(0, 600)
    });

    // Search endpoint may return { contacts: [] } or { results: [] } or a bare array
    const allContacts = Array.isArray(res.data)
      ? res.data
      : res.data.contacts || res.data.results || [];

    logger.tripleseat(`Contact search parsed`, {
      email,
      totalFound: allContacts.length
    });

    // TripleSeat returns fuzzy search results - filter by exact email match.
    // Handles both array form ({ email_addresses: [{ address }] }) and
    // flat form ({ email: "..." }) in case the search endpoint returns a trimmed shape.
    const emailLower = email.toLowerCase();
    const contacts = allContacts.filter(c => {
      if (Array.isArray(c.email_addresses)) {
        return c.email_addresses.some(e => e.address?.toLowerCase() === emailLower);
      }
      if (typeof c.email === 'string') {
        return c.email.toLowerCase() === emailLower;
      }
      return false;
    });

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

// Create or update contact in TripleSeat
exports.createContact = async (contact) => {
  const startTime = Date.now();

  try {
    const existingContact = await exports.findContactByEmail(contact.email);

    const headers = await auth.getHeaders();

    if (existingContact) {
      // On update, include existing IDs for email and phone so TripleSeat
      // updates in-place instead of appending duplicate entries
      const existingEmailId = existingContact.email_addresses?.[0]?.id;
      const existingPhoneId = existingContact.phone_numbers?.[0]?.id;

      const updateData = {
        first_name: contact.firstname || "",
        last_name: contact.lastname || "",
        email_addresses: existingEmailId
          ? [{ id: existingEmailId, address: contact.email }]
          : [{ address: contact.email }],
        phone_numbers: contact.phone
          ? existingPhoneId
            ? [{ id: existingPhoneId, number: contact.phone, phone_number_type: "Work" }]
            : [{ number: contact.phone, phone_number_type: "Work" }]
          : []
      };

      logger.tripleseat(`Updating existing contact for ${contact.email}`, {
        contactId: existingContact.id,
        existingEmailId,
        existingPhoneId
      });

      const res = await axios.put(
        `${BASE_URL}/v1/contacts/${existingContact.id}.json`,
        { contact: updateData },
        { headers }
      );

      const processingTime = Date.now() - startTime;
      logger.tripleseat(`Contact updated successfully`, {
        email: contact.email,
        tripleseatContactId: existingContact.id,
        processingTime: `${processingTime}ms`
      });

      return res.data?.contact ? res.data : { contact: { ...existingContact, ...res.data } };
    }

    logger.tripleseat(`Creating new contact for ${contact.email}`, {
      name: `${contact.firstname} ${contact.lastname}`,
      phone: contact.phone || 'none',
      accountId: ACCOUNT_ID
    });

    const createData = {
      first_name: contact.firstname || "",
      last_name: contact.lastname || "",
      account_id: ACCOUNT_ID,
      email_addresses: [{ address: contact.email }],
      phone_numbers: contact.phone ? [{ number: contact.phone, phone_number_type: "Work" }] : []
    };

    const res = await axios.post(
      `${BASE_URL}/v1/contacts.json`,
      { contact: createData },
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
    logger.error(`Failed to create/update contact for ${contact.email}`, {
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

// Find a TripleSeat user by email address
exports.findUserByEmail = async (email) => {
  try {
    const headers = await auth.getHeaders();
    const res = await axios.get(
      `${BASE_URL}/v1/users/search.json`,
      { headers, params: { query: email } }
    );
    logger.tripleseat(`User search raw response`, {
      email,
      topLevelKeys: Object.keys(res.data || {}),
      isArray: Array.isArray(res.data),
      rawPreview: JSON.stringify(res.data).substring(0, 800)
    });

    const users = Array.isArray(res.data)
      ? res.data
      : res.data.users || res.data.results || [];

    const emailLower = email.toLowerCase();
    const match = users.find(u => u.email?.toLowerCase() === emailLower);
    if (match) {
      logger.tripleseat(`Found TripleSeat user for email ${email}`, { userId: match.id });
    } else {
      logger.tripleseat(`No TripleSeat user found for email ${email}`, {
        totalReturned: users.length,
        returnedEmails: users.map(u => u.email)
      });
    }
    return match || null;
  } catch (error) {
    logger.error(`Failed to search TripleSeat user by email: ${email}`, { error: error.message });
    return null;
  }
};

// Build the TripleSeat event payload from a HubSpot deal
function buildEventData(deal, contactId, ownedById = 220867) {
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
      owned_by: ownedById,
      description: deal.event_details || "",
      ...(dealAmount ? { actual_amount: dealAmount } : {}),
      ...(guestCount ? { guest_count: guestCount } : {}),
      ...(leadSources.length ? { selected_lead_sources: leadSources } : {}),
      // booking: {
      //   status: mapDealStageToEventStatus(deal.dealstage).toLowerCase(),
      //   source: "HubSpot Integration"
      // }
    }
  };
}

// Create Event
exports.createEvent = async (deal, contactId, hubspotDealId, ownedById = 220867) => {
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
    const { eventStart, eventEnd, payload } = buildEventData(deal, contactId, ownedById);

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

// Fetch an existing TripleSeat event by ID
async function getEvent(tsEventId) {
  const headers = await auth.getHeaders();
  const res = await axios.get(
    `${BASE_URL}/v1/events/${tsEventId}.json`,
    { headers }
  );
  return res.data?.event || res.data;
}

// Update existing TripleSeat event from updated HubSpot deal
exports.updateEvent = async (tsEventId, deal, contactId, hubspotDealId, ownedById = 220867) => {
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

    // Fetch the existing event so we can preserve its event_start/event_end
    // unless the event_date in HubSpot actually changed
    const existingEvent = await getEvent(tsEventId);
    logger.tripleseat(`Existing event fetched`, {
      tsEventId,
      existingEventStart: existingEvent.event_start,
      existingEventEnd: existingEvent.event_end,
      existingEventDate: existingEvent.event_date
    });

    // Determine whether the HubSpot event_date has changed vs what TripleSeat has
    let eventStart = existingEvent.event_start;
    let eventEnd = existingEvent.event_end;
    let tsEventDate = existingEvent.event_date;

    if (deal.event_date) {
      const incomingDate = new Date(deal.event_date);
      const incomingDateStr = formatDateOnly(incomingDate);

      // Normalise the existing TripleSeat date for comparison
      // TS stores event_date as MM/DD/YYYY or similar
      const existingDateNorm = existingEvent.event_date
        ? formatDateOnly(new Date(existingEvent.event_date))
        : null;

      if (incomingDateStr !== existingDateNorm) {
        // Date changed - recalculate times using current wall-clock time on the new date
        const now = new Date();
        const start = new Date(
          incomingDate.getUTCFullYear(),
          incomingDate.getUTCMonth(),
          incomingDate.getUTCDate(),
          now.getHours(),
          now.getMinutes(),
          0
        );
        const end = new Date(start.getTime() + 60 * 60 * 1000);
        tsEventDate = incomingDateStr;
        eventStart = formatDateTime(start);
        eventEnd = formatDateTime(end);
        logger.tripleseat(`Event date changed - recalculating times`, {
          from: existingDateNorm,
          to: incomingDateStr,
          newEventStart: eventStart,
          newEventEnd: eventEnd
        });
      } else {
        logger.tripleseat(`Event date unchanged - preserving existing times`, {
          date: incomingDateStr,
          eventStart,
          eventEnd
        });
      }
    }

    const dealAmount = deal.amount ? parseFloat(deal.amount) : null;
    const guestCount = deal.number_of_guests__cloned__ ? parseInt(deal.number_of_guests__cloned__) : null;
    const leadSources = deal.lead_source ? [deal.lead_source] : [];

    const payload = {
      name: deal.dealname || "Event from HubSpot",
      status: mapDealStageToEventStatus(deal.dealstage),
      contact_id: contactId,
      account_id: parseInt(ACCOUNT_ID),
      event_date: tsEventDate,
      event_start: eventStart,
      event_end: eventEnd,
      location_id: 20271,
      room_ids: [238254],
      owned_by: ownedById,
      description: deal.event_details || "",
      ...(dealAmount ? { actual_amount: dealAmount } : {}),
      ...(guestCount ? { guest_count: guestCount } : {}),
      ...(leadSources.length ? { selected_lead_sources: leadSources } : {}),
      // booking: {
      //   status: mapDealStageToEventStatus(deal.dealstage).toLowerCase(),
      //   source: "HubSpot Integration"
      // }
    };

    const headers = await auth.getHeaders();
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

// HubSpot deal stage ID → TripleSeat event status (Event Sales Pipeline)
const DEAL_STAGE_TO_TS_STATUS = {
  '2822434791': 'PROSPECT',   // Qualified Lead
  '2822424509': 'PROSPECT',   // Tour Booked
  '2847159289': 'PROSPECT',   // Tour Complete
  '2847160250': 'TENTATIVE',  // Preparing Proposal
  '2822434792': 'TENTATIVE',  // Quote Sent
  '2822434793': 'TENTATIVE',  // Contract Sent
  '2822434794': 'DEFINITE',   // Closed Won
  '2822434795': 'LOST'        // Closed Lost
};

function mapDealStageToEventStatus(dealStage) {
  return DEAL_STAGE_TO_TS_STATUS[dealStage] || 'PROSPECT';
}