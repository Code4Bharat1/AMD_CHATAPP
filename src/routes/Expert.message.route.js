import { ExpertSessionMiddleware } from "../middleware/expertSessionValidation.js";
import { getExpertsForSidebar , getExpertMessages , sendExpertMessage , deleteExpertMessage} from "../controller/expert.message.controller.js";
import { protectRoute } from "../middleware/auth.middleware.js";
import express from "express";

const route = express.Router();

// ===== EXPERT TO EXPERT CHAT =====
// Basic messaging
route.get("/expert", protectRoute, ExpertSessionMiddleware, getExpertsForSidebar);
// Disabled expert-to-expert routes (as per your original commented out routes)
route.get("/expert-messages/get/:id", protectRoute, ExpertSessionMiddleware, getExpertMessages)
route.post("/expert-messages/send/:id", protectRoute, ExpertSessionMiddleware, sendExpertMessage)
route.delete("/expert-message/delete", protectRoute, ExpertSessionMiddleware, deleteExpertMessage)
// route.delete("/expert/deleteallmessage", protectRoute, ExpertSessionMiddleware, deleteAllExpertMessages)
// route.put('/expert/edit', protectRoute, ExpertSessionMiddleware, editExpertMessage)

// File operations - Expert to expert
// route.post("/expert/upload/:id", protectRoute, ExpertSessionMiddleware, uploadMiddleware, uploadFile);
// route.get("/expert/files/info/:fileId", protectRoute, ExpertSessionMiddleware, getFileInfo);
// route.get("/expert/files/download/:fileId", protectRoute, ExpertSessionMiddleware, downloadFile);
// route.delete("/expert/files/delete", protectRoute, ExpertSessionMiddleware, deleteFile);
// route.get("/expert/files/conversation/:id", protectRoute, ExpertSessionMiddleware, getConversationFiles);

export default route;