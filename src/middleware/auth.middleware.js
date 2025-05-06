import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";
import { getDB } from "../lib/db.js";

export const protectRoute = async (req, res, next) => {
  console.log("🔥 LogginMiddleware called");

  const db = getDB();
  const userCollection = db.collection("user");
  const expertCollection = db.collection("expert");

  try {
    let token =
      req.header("Authorization")?.replace("Bearer ", "") || req.body.token;

    if (!token || token.trim() === "") {
      throw new ApiError(401, "Unauthorized Request: No token provided");
    }

    if (!/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(token)) {
      throw new ApiError(401, "Invalid token format: Token is malformed");
    }

    const decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    const id = decodedToken?._id;

    if (!ObjectId.isValid(id)) {
      throw new ApiError(401, "Invalid ID format in token");
    }

    let user = null;
    let expert = null;

    if (decodedToken?.role === "user") {
      user = await userCollection.findOne(
        { _id: new ObjectId(id) },
        { projection: { password: 0, refreshToken: 0 } }
      );

      if (!user) {
        throw new ApiError(401, "Invalid Access Token: User not found");
      }

      req.user = user;
      console.log("loggin middleware is passed user")
      next();
    } else if (decodedToken?.role === "expert") {
      expert = await expertCollection.findOne({ _id: new ObjectId(id) });

      if (!expert) {
        throw new ApiError(401, "Invalid Access Token: Expert not found");
      }
      req.expert = expert;
      console.log("loggin middleware is passed as expert")
      next();
    } else {
      throw new ApiError(401, "Invalid Access Token: Role not found");
    }
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Token has expired" });
    }

    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({ message: "Invalid token format" });
    }
    res.status(401).json({ message: error.message || "Invalid Access Token" });
  }
};
