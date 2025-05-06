import { MongoClient } from "mongodb";

let db;
export const connectDB = async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    await client.connect();
    console.log("connect to mongodb");
    db = client.db("AMD");
  } catch (error) {
    console.log("error in connecting database", error);
  }
};
export const getDB = () => {
  if (!db) throw new Error("DB not initialized. Call connectDB() first.");
  return db;
};
