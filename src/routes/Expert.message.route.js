import { ExpertSessionMiddleware } from "../middleware/expertSessionValidation.js";
import {
  getExpertsForSidebar,
  getExpertMessages,
  sendExpertMessage,
  deleteExpertMessage,
  editExpertMessage,
  deleteAllExpertMessages,
} from "../controller/expert.message.controller.js";

import {
  downloadFileExpert,
  uploadFileExpert,
  deleteFileExpert,
  uploadMiddleware,
  getExpertFileInfo,
} from "../controller/expert.file.controller.js";

import {
  voiceUploadMiddleware,
  handleMulterError,
  uploadVoiceMessage,
  getVoiceInfo,
  streamVoiceMessage,
  downloadVoiceMessage,
  deleteVoiceMessage,
  getConversationVoiceMessages,
} from "../controller/expert.voiceController.js";

import { protectRoute } from "../middleware/auth.middleware.js";
import express from "express";

const route = express.Router();

// ===== EXPERT TO EXPERT CHAT =====
// Basic messaging
route.get(
  "/expert",
  protectRoute,
  ExpertSessionMiddleware,
  getExpertsForSidebar
);
route.get(
  "/expert-messages/get/:id",
  protectRoute,
  ExpertSessionMiddleware,
  getExpertMessages
);
route.post(
  "/expert-messages/send/:id",
  protectRoute,
  ExpertSessionMiddleware,
  sendExpertMessage
);
route.delete(
  "/expert-message/delete",
  protectRoute,
  ExpertSessionMiddleware,
  deleteExpertMessage
);
route.delete(
  "/expert-message/deleteallmessage",
  protectRoute,
  ExpertSessionMiddleware,
  deleteAllExpertMessages
);
route.put(
  "/expert-message/edit",
  protectRoute,
  ExpertSessionMiddleware,
  editExpertMessage
);

// File operations - Expert to expert
route.post(
  "/expert-file/upload/:id",
  protectRoute,
  ExpertSessionMiddleware,
  uploadMiddleware,
  uploadFileExpert
);
route.get(
  "/expert-file/:fileId",
  protectRoute,
  ExpertSessionMiddleware,
  getExpertFileInfo
);
route.get(
  "/expert-file/download/:fileId",
  protectRoute,
  ExpertSessionMiddleware,
  downloadFileExpert
);
route.delete(
  "/expert-file/delete",
  protectRoute,
  ExpertSessionMiddleware,
  deleteFileExpert
);

// voice operations
route.post(
  "/expert-voice/upload/:id",
  protectRoute , ExpertSessionMiddleware,
  voiceUploadMiddleware,
  handleMulterError,
  uploadVoiceMessage
);
route.get("/expert-voice/details/:voiceId", protectRoute , ExpertSessionMiddleware, getVoiceInfo);
route.get("/expert-voice/stream/:voiceId", protectRoute , ExpertSessionMiddleware, streamVoiceMessage);
route.get("/expert-voice/download/:voiceId", protectRoute , ExpertSessionMiddleware, downloadVoiceMessage);
route.delete("/expert-voice/delete", protectRoute , ExpertSessionMiddleware, deleteVoiceMessage);
route.get(
  "/expert-voice/conversation/:id",
  protectRoute , ExpertSessionMiddleware,
  getConversationVoiceMessages
);

export default route;
