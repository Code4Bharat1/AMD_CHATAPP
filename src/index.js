import express from "express";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import { connectDB } from "./lib/db.js";
import jwt from "jsonwebtoken";
import cors from "cors";

import messageRoute from "./routes/message.route.js";
import { app, server } from "./lib/socket.js";

dotenv.config();

const PORT = process.env.PORT;

const allowedOrigins = ["http://localhost:3001", "http://localhost:3000"]; // your frontend dev URL
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true, // allow cookies if using auth
  })
);

app.use(express.json());
app.use(cookieParser());

app.use("/api/message", messageRoute);

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
