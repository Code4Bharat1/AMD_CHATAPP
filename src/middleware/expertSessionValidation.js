import { ObjectId } from "mongodb";
import { getDB } from "../lib/db.js";

export const ExpertSessionMiddleware = async (req, res, next) => {
  console.log("🔥 expert SessionMiddleware called");

  const db = getDB();
  const ExpertToExpertSessionCollection = db.collection("experttoexpertsessions");
  
  try {
    // Verify this is an expert request
    if (!req.expert) {
      console.log("❌ Error: Only experts can access expert-to-expert sessions");
      return res.status(403).json({ message: "Only experts can access expert-to-expert sessions" });
    }
    // Check if current expert is either the consulting expert or the consulted expert
    const session = await ExpertToExpertSessionCollection.findOne({
      status: "confirmed",
      $or: [
        { consultingExpertID: new ObjectId(req.expert._id) }, // They're the one giving consultation
        { expertId: new ObjectId(req.expert._id) }            // They're the one receiving consultation
      ]
    });

    if (!session) {
      return res.status(403).json({ 
        message: "Not authorized to access this session or session not found" 
      });
    }

    // Attach session to request and proceed
    req.session = session;
    console.log("✅ expert session middleware passed");
    next();
  } catch (error) {
    console.error("❌ Error in expert session middleware:", error.message);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};