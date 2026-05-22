require("dotenv").config();
const hubspot = require("./src/services/hubspotService");
const tripleseat = require("./src/services/tripleseatService");

async function testDealFlow() {
  const sampleDealId = "211084399576"; // Replace with actual deal ID

  try {
    console.log("=== STEP 1: Fetch deal from HubSpot ===");
    const deal = await hubspot.getDeal(sampleDealId);
    console.log("Deal properties:", deal.properties);

    const existingTsEventId = deal.properties.tripleseat_event_id || null;
    console.log(`\nExisting tripleseat_event_id: ${existingTsEventId || "none"}`);
    console.log(`tripleseat_push: ${deal.properties.tripleseat_push}`);
    console.log(`event_date: ${deal.properties.event_date || "none"}`);
    console.log(`amount: ${deal.properties.amount || "none"}`);
    console.log(`guest_count: ${deal.properties.number_of_guests__cloned__ || "none"}`);
    console.log(`lead_source: ${deal.properties.lead_source || "none"}`);
    console.log(`event_details: ${deal.properties.event_details || "none"}`);

    console.log("\n=== STEP 2: Fetch associated contacts ===");
    const contactIds = await hubspot.getAssociatedContacts(sampleDealId);
    console.log(`Found ${contactIds.length} contact(s):`, contactIds);

    if (!contactIds.length) {
      console.log("No contacts found - stopping.");
      return;
    }

    const primaryContactId = contactIds[0];
    let tsEventId = null;

    for (const contactId of contactIds) {
      console.log(`\n=== STEP 3: Processing contact ${contactId} ===`);
      const contact = await hubspot.getContact(contactId);
      console.log("Contact properties:", contact.properties);

      const tsContact = await tripleseat.createContact(contact.properties);
      console.log("Tripleseat contact:", tsContact);

      if (contactId === primaryContactId) {
        if (existingTsEventId) {
          console.log(`\n=== STEP 4: UPDATE existing TripleSeat event ${existingTsEventId} ===`);
          const updated = await tripleseat.updateEvent(
            existingTsEventId,
            deal.properties,
            tsContact.contact?.id,
            sampleDealId
          );
          console.log("Update response:", updated);
          tsEventId = existingTsEventId;
          console.log(`✅ Event updated: ${tsEventId}`);
        } else {
          console.log("\n=== STEP 4: CREATE new TripleSeat event ===");
          const tsEvent = await tripleseat.createEvent(
            deal.properties,
            tsContact.contact?.id,
            sampleDealId
          );
          console.log("Create response:", tsEvent);
          tsEventId = tsEvent.event?.id;
          console.log(`✅ Event created: ${tsEventId}`);
        }
      }
    }

    // Save tripleseat_event_id back to HubSpot only on first create
    if (tsEventId && !existingTsEventId) {
      console.log("\n=== STEP 5: Save tripleseat_event_id back to HubSpot ===");
      await hubspot.updateDeal(sampleDealId, { tripleseat_event_id: String(tsEventId) });
      console.log(`✅ tripleseat_event_id saved to HubSpot deal: ${tsEventId}`);
    } else if (existingTsEventId) {
      console.log("\n=== STEP 5: Skipped - event already existed, ID unchanged ===");
    } else {
      console.log("\n⚠ No tsEventId returned - tripleseat_event_id NOT saved");
    }

  } catch (error) {
    console.error("\n❌ Test failed:", error.message);
    if (error.response?.data) {
      console.error("Response data:", JSON.stringify(error.response.data, null, 2));
    }
  }
}

testDealFlow();
