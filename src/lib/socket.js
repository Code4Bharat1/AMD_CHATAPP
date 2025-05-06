import { Server } from "socket.io";
import http from "http";
import express from "express";

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: ["http://localhost:3000"],
    methods: ["GET", "POST" , "PUT" , "DELETE"],
    credentials: true
  },
});

// Used to store online users
const userSocketMap = {}; // {userId: socketId}

export function getReceiverSocketId(userId) {
  return userSocketMap[userId];
}

io.on("connection", (socket) => {
  console.log("A user connected", socket.id);

  const userId = socket.handshake.query.userId;
  console.log("User ID from handshake:", userId);
  
  if (userId) {
    userSocketMap[userId] = socket.id;
    console.log("Updated userSocketMap:", userSocketMap);
  }

  // Send online users to all clients
  io.emit("getOnlineUsers", Object.keys(userSocketMap));

  // Listen for sendMessage event from client
  socket.on("sendMessage", (messageData) => {
    console.log("Message received:", messageData);
    
    const receiverSocketId = userSocketMap[messageData.receiverId];
    if (receiverSocketId) {
      console.log(`Sending message to ${messageData.receiverId} via socket ${receiverSocketId}`);
      io.to(receiverSocketId).emit("newMessage", {
        _id: messageData._id || new Date().getTime().toString(),
        senderId: messageData.senderId,
        receiverId: messageData.receiverId,
        text: messageData.text,
        time: messageData.time || new Date()
      });
    } else {
      console.log(`Receiver ${messageData.receiverId} is not online`);
    }

    if (receiverSocketId) {
      console.log(`Emitting delete all messages event to socket: ${receiverSocketId}`);
      io.to(receiverSocketId).emit("allMessagesDeleted", { 
        senderID: senderID,
        reciverID: reciverID
      });
    } else {
      console.log(`Receiver ${reciverID} not connected, cannot emit deletion event`);
    }

  });

  socket.on("disconnect", () => {
    console.log("A user disconnected", socket.id);
    
    // Find and remove the disconnected user from userSocketMap
    const disconnectedUserId = Object.keys(userSocketMap).find(
      (key) => userSocketMap[key] === socket.id
    );
    
    if (disconnectedUserId) {
      console.log(`User ${disconnectedUserId} went offline`);
      delete userSocketMap[disconnectedUserId];
    }
    
    // Update all clients with new online users list
    io.emit("getOnlineUasers", Object.keys(userSocketMap));
  });
});

export { io, app, server };