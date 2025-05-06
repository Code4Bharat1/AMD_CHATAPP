import { ObjectId } from "mongodb";
import { getDB } from "../lib/db.js";

export const sessionMiddleware = async (req, res, next) => {
  console.log("🔥 SessionMiddleware called");

  const db = getDB();
  const userToExpertSessionCollection = db.collection("usertoexpertsessions");
  try {
    let session;

    if (req.user) {
      const sessions = await userToExpertSessionCollection
        .find({"$and" : [{ userId: new ObjectId(req.user._id) } , {status : "confirmed"}]})
        .toArray();

      req.session = sessions; // all sessions (array) stored here
      console.log("session middleware is passed")
      return next();
    }
    if (req.expert) {
      const sessions = await userToExpertSessionCollection
        .find({"$and" : [{ expertId: new ObjectId(req.expert._id) } , {status : "confirmed"}]})
        .toArray();

      req.session = sessions;
      console.log("session middleware is passed")
      return next();
    }

    console.error("❌ user/expert not found in session validation");
  } catch (error) {
    console.error("❌ Error in session middleware:", error.message);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};
