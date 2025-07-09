import express from "express";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import { connectDB } from "./lib/db.js";
import jwt from "jsonwebtoken";
import cors from "cors";

import messageRoute from "./routes/message.route.js";
import expertMessageRoute from "./routes/Expert.message.route.js";
import { app, server } from "./lib/socket.js";

dotenv.config();

const PORT = process.env.PORT;


const allowedOrigins = [
  "https://hibafarrash.shourk.com",
  "https://hiba-chat.shourk.com",// your specific frontend URL
  "https://www.hibafarrash.shourk.com", // www version of your frontend URL
  "https://shourk.com", // root domain
  "https://www.shourk.com", // www version of root domain
  "http://localhost:3000", // Local development URL
];

app.use(
  cors({
    origin: (origin, callback) => {
      // If the origin is in the allowedOrigins array or is not present (e.g., Postman requests)
      if (allowedOrigins.includes(origin) || !origin) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true, // Allow cookies if using authentication
  })
);


app.use(express.json());
app.use(cookieParser());

app.use("/api/message", messageRoute);
app.use("/api/message", expertMessageRoute);

// Route to set a cookie based on user input
app.get("/set-user-cookie/:id", (req, res) => {
  const { id } = req.params;
  const token = jwt.sign({ id }, "1234", { expiresIn: "1d" });

  res.cookie("expert", token, {
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 1 day
  });

  res.send("JWT Cookie has been set");
});

app.get("/set-session-cookie/:id", (req, res) => {
  const { id } = req.params;
  const token = jwt.sign({ id }, "1234", { expiresIn: "1d" });

  res.cookie("session", token, {
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 1 day
  });

  res.send("JWT Cookie has been set");
});

server.listen(PORT, async () => {
  console.log(`server is running on ${PORT}`);
  await connectDB();
});
