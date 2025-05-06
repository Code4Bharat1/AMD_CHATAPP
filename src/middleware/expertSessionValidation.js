import { ObjectId } from "mongodb";
import { getDB } from "../lib/db.js";

export const ExpertSessionMiddleware = async (req, res, next) => {
  console.log("🔥 expert SessionMiddleware called");

  const db = getDB();
  const ExpertToExpertSessionCollection = db.collection("experttoexpertsessions");
  try {

    if (req.user) {
      console.log("❌ Error in session middleware this is expert-to-expert chat");
      return res.status(401).json({ message: "user not allowed this is expert to expert chat" });
    }
    if (req.expert) {
      const sessions = await ExpertToExpertSessionCollection
        .find({"$and" : [{ expertId: new ObjectId(req.expert._id) } , {status : "confirmed"}]})
        .toArray();

      req.session = sessions;
      console.log(" expert session middleware is passed")
      return next();
    }

    console.error("❌ user/expert not found in session validation");
  } catch (error) {
    console.error("❌ Error in session middleware:", error.message);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};
