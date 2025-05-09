import express from "express";
import { protectRoute } from "../middleware/auth.middleware.js";
import { sessionMiddleware } from "../middleware/sessionvalidation.js";
import { 
  getUserForSidebar, 
  getMessages, 
  sendMessage, 
  deleteOneMessage, 
  deleteAllMessage, 
  editMessage, 
  getLogginUser 
} from "../controller/message.controller.js";
import { 
  uploadMiddleware, 
  uploadFile, 
  getFileInfo, 
  downloadFile, 
  deleteFile, 
  getConversationFiles 
} from "../controller/file.controller.js";
import {
  voiceUploadMiddleware,
  uploadVoiceMessage,
  getVoiceInfo,
  streamVoiceMessage,
  downloadVoiceMessage,
  deleteVoiceMessage,
  getConversationVoiceMessages,
  handleMulterError
} from "../controller/voice.controller.js";

const route = express.Router();

// User authentication
route.get("/logginuser", protectRoute, sessionMiddleware, getLogginUser);

// ===== USER TO EXPERT CHAT =====
// Basic messaging
route.get("/users", protectRoute, sessionMiddleware, getUserForSidebar);
route.get("/get/:id", protectRoute, sessionMiddleware, getMessages);
route.post("/send/:id", protectRoute, sessionMiddleware, sendMessage);
route.delete("/delete", protectRoute, sessionMiddleware, deleteOneMessage);
route.delete("/deleteallmessage", protectRoute, sessionMiddleware, deleteAllMessage);
route.put('/edit', protectRoute, sessionMiddleware, editMessage);

// File operations - User to EXPERT
route.post("/upload/:id", protectRoute, sessionMiddleware, uploadMiddleware, uploadFile);
route.get("/files/info/:fileId", protectRoute, sessionMiddleware, getFileInfo);
route.get("/files/download/:fileId", protectRoute, sessionMiddleware, downloadFile);
route.delete("/files/delete", protectRoute, sessionMiddleware, deleteFile);
route.get("/files/conversation/:id", protectRoute, sessionMiddleware, getConversationFiles);

// Voice message operations - User to EXPERT
route.post("/voice/:id", protectRoute, sessionMiddleware, voiceUploadMiddleware, handleMulterError, uploadVoiceMessage);
route.get("/voice/info/:voiceId", protectRoute, sessionMiddleware, getVoiceInfo);
route.get("/voice/stream/:voiceId",protectRoute,sessionMiddleware, streamVoiceMessage);
route.get("/voice/download/:voiceId", protectRoute, sessionMiddleware, downloadVoiceMessage);
route.delete("/voice/delete", protectRoute, sessionMiddleware, deleteVoiceMessage);
route.get("/voice/conversation/:id", protectRoute, sessionMiddleware, getConversationVoiceMessages);
export default route;