require("dotenv").config();
const hubspot = require("./src/services/hubspotService");
const tripleseat = require("./src/services/tripleseatService");

async function testDealFlow() {
  try {
    console.log("Testing deal-based webhook flow...");
    
    // Test with a sample deal ID (you'll need to replace this with a real deal ID)
    const sampleDealId = "208389168090"; // Replace with actual deal ID
    
    console.log(`1. Fetching deal: ${sampleDealId}`);
    const deal = await hubspot.getDeal(sampleDealId);
    console.log("Deal properties:", deal.properties);
    
    // Check if deal has the test push flag
    if (deal.properties.tripleseat_push === "true") {
      console.log("✅ Deal has tripleseat_push = true");
      
      console.log("2. Getting associated contacts...");
      const contactIds = await hubspot.getAssociatedContacts(sampleDealId);
      console.log(`Found ${contactIds.length} contacts:`, contactIds);
      
      for (const contactId of contactIds) {
        console.log(`3. Processing contact: ${contactId}`);
        const contact = await hubspot.getContact(contactId);
        console.log("Contact properties:", contact.properties);
        
        // Note: Uncomment the following lines to actually create in Tripleseat
         const tsContact = await tripleseat.createContact(contact.properties);
         console.log("Created Tripleseat contact:", tsContact);
         await tripleseat.createEvent(deal.properties, tsContact.id);
        console.log("Would create contact and event in Tripleseat");
      }
    } else {
      console.log("⚠ Deal does not have tripleseat_push = true");
    }
    
  } catch (error) {
    console.error("❌ Test failed:", error.message);
    if (error.response?.data) {
      console.error("Response data:", error.response.data);
    }
  }
}

testDealFlow();
