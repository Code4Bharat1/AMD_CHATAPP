import { Server } from "socket.io";
import http from "http";
import express from "express";

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: ["http://localhost:3000"],
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
  },
});

// Used to store online users and experts
const userSocketMap = {}; // {userId: socketId}
const expertSocketMap = {}; // {expertId: socketId}

export function getReceiverSocketId(userId) {
  return userSocketMap[userId];
}

export function getExpertSocketId(expertId) {
  return expertSocketMap[expertId];
}

io.on("connection", (socket) => {
  console.log("A client connected", socket.id);

  const userId = socket.handshake.query.userId;
  const expertId = socket.handshake.query.expertId;
  
  // Handle user connection
  if (userId) {
    console.log("User connected:", userId);
    userSocketMap[userId] = socket.id;
    
    // Emit updated online users list
    io.emit("getOnlineUsers", Object.keys(userSocketMap));
  }
  
  // Handle expert connection
  if (expertId) {
    console.log("Expert connected:", expertId);
    expertSocketMap[expertId] = socket.id;
    
    // Emit updated online experts list
    io.emit("getOnlineExperts", Object.keys(expertSocketMap));
  }

  // ============== USER TO EXPERT COMMUNICATION ==============
  
  // Listen for sendMessage event from client (User to Expert)
  socket.on("sendMessage", (messageData) => {
    console.log("Message received:", messageData);
    
    const receiverSocketId = userSocketMap[messageData.receiverId] || expertSocketMap[messageData.receiverId];
    
    if (receiverSocketId) {
      console.log(`Sending message to ${messageData.receiverId} via socket ${receiverSocketId}`);
      io.to(receiverSocketId).emit("newMessage", {
        _id: messageData._id || new Date().getTime().toString(),
        senderId: messageData.senderId,
        receiverId: messageData.receiverId,
        text: messageData.text,
        time: messageData.time || new Date(),
        isFile: messageData.isFile || false,
        fileId: messageData.fileId || null,
        isVoice: messageData.isVoice || false
      });
    } else {
      console.log(`Receiver ${messageData.receiverId} is not online`);
    }
  });
  
  // Listen for message edited event
  socket.on("messageEdited", (updatedMessage) => {
    console.log("Message edited:", updatedMessage);
    
    const receiverSocketId = userSocketMap[updatedMessage.receiverId] || expertSocketMap[updatedMessage.receiverId];
    
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("messageEdited", updatedMessage);
    }
  });
  
  // Listen for message deleted event
  socket.on("messageDeleted", (data) => {
    console.log("Message deleted:", data);
    
    const receiverSocketId = userSocketMap[data.receiverId] || expertSocketMap[data.receiverId];
    
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("messageDeleted", {
        messageId: data.messageId,
        fileId: data.fileId
      });
    }
  });
  
  // Listen for all messages deleted event
  socket.on("allMessagesDeleted", (data) => {
    console.log("All messages deleted:", data);
    
    const receiverSocketId = userSocketMap[data.receiverId] || expertSocketMap[data.receiverId];
    
    if (receiverSocketId) {
      console.log(`Emitting delete all messages event to socket: ${receiverSocketId}`);
      io.to(receiverSocketId).emit("allMessagesDeleted", { 
        senderId: data.senderId,
        receiverId: data.receiverId
      });
    } else {
      console.log(`Receiver ${data.receiverId} not connected, cannot emit deletion event`);
    }
  });

  // ============== EXPERT TO EXPERT COMMUNICATION ==============
  
  // Listen for expert message event
  socket.on("sendExpertMessage", (messageData) => {
    console.log("Expert message received:", messageData);
    
    const receiverSocketId = expertSocketMap[messageData.receiverId];
    
    if (receiverSocketId) {
      console.log(`Sending expert message to ${messageData.receiverId} via socket ${receiverSocketId}`);
      io.to(receiverSocketId).emit("newExpertMessage", {
        _id: messageData._id || new Date().getTime().toString(),
        senderId: messageData.senderId,
        receiverId: messageData.receiverId,
        text: messageData.text,
        time: messageData.time || new Date(),
        isFile: messageData.isFile || false,
        fileId: messageData.fileId || null,
        isVoice: messageData.isVoice || false
      });
    } else {
      console.log(`Expert receiver ${messageData.receiverId} is not online`);
    }
  });
  
  // Listen for expert message edited event
  socket.on("expertMessageEdited", (updatedMessage) => {
    console.log("Expert message edited:", updatedMessage);
    
    const receiverSocketId = expertSocketMap[updatedMessage.receiverId];
    
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("expertMessageEdited", updatedMessage);
    }
  });
  
  // Listen for expert message deleted event
  socket.on("expertMessageDeleted", (data) => {
    console.log("Expert message deleted:", data);
    
    // Ensure the receiver ID is available to find the right socket
    const receiverId = data.receiverId;
    
    if (receiverId) {
      const receiverSocketId = expertSocketMap[receiverId];
      
      if (receiverSocketId) {
        io.to(receiverSocketId).emit("expertMessageDeleted", {
          messageId: data.messageId, // Use consistent camelCase
          senderId: data.senderId,
          receiverId: data.receiverId,
          fileId: data.fileId || null
        });
      }
    }
  });
  
  // Listen for all expert messages deleted event
  socket.on("allExpertMessagesDeleted", (data) => {
    console.log("All expert messages deleted:", data);
    
    const receiverSocketId = expertSocketMap[data.receiverId];
    
    if (receiverSocketId) {
      console.log(`Emitting delete all expert messages event to socket: ${receiverSocketId}`);
      io.to(receiverSocketId).emit("allExpertMessagesDeleted", { 
        senderID: data.senderID,
        receiverID: data.receiverID
      });
    } else {
      console.log(`Expert receiver ${data.receiverID} not connected, cannot emit deletion event`);
    }
  });
  
  // Listen for conversation deleted event
  socket.on("conversationDeleted", (data) => {
    console.log("Conversation deleted:", data);
    
    const receiverSocketId = expertSocketMap[data.receiverId];
    
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("conversationDeleted", data);
    }
  });

  // ============== DISCONNECT HANDLING ==============
  
  socket.on("disconnect", () => {
    console.log("A client disconnected", socket.id);
    
    // Find and remove the disconnected user from userSocketMap
    const disconnectedUserId = Object.keys(userSocketMap).find(
      (key) => userSocketMap[key] === socket.id
    );
    
    if (disconnectedUserId) {
      console.log(`User ${disconnectedUserId} went offline`);
      delete userSocketMap[disconnectedUserId];
      
      // Update all clients with new online users list
      io.emit("getOnlineUsers", Object.keys(userSocketMap));
    }
    
    // Find and remove the disconnected expert from expertSocketMap
    const disconnectedExpertId = Object.keys(expertSocketMap).find(
      (key) => expertSocketMap[key] === socket.id
    );
    
    if (disconnectedExpertId) {
      console.log(`Expert ${disconnectedExpertId} went offline`);
      delete expertSocketMap[disconnectedExpertId];
      
      // Update all clients with new online experts list
      io.emit("getOnlineExperts", Object.keys(expertSocketMap));
    }
  });
});

export { io, app, server };