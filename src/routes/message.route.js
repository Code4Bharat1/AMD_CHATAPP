import express from "express"
import { protectRoute } from "../middleware/auth.middleware.js";
import { sessionMiddleware } from "../middleware/sessionvalidation.js";
import { ExpertSessionMiddleware } from "../middleware/expertSessionValidation.js";
import { getExpertsForSidebar , getExpertMessages, sendExpertMessage , deleteExpertMessage , deleteAllExpertMessages , editExpertMessage } from "../controller/expert.message.controller.js";
import { getUserForSidebar , getMessages , sendMessage , deleteOneMessage , deleteAllMessage ,editMessage , getLogginUser } from "../controller/message.controller.js";

const route = express.Router();


route.get("/logginuser",protectRoute , sessionMiddleware , getLogginUser)

//user to user chat
route.get("/users",protectRoute, sessionMiddleware , getUserForSidebar) // first checking login user then session then giving the user data
route.get("/:id", protectRoute , sessionMiddleware , getMessages) // same and  geting the message
route.post("/send/:id",protectRoute, sessionMiddleware , sendMessage) // same and sending message
route.delete("/delete" ,protectRoute ,sessionMiddleware, deleteOneMessage) // same but to delete selected message 
route.delete("/deleteallmessage",protectRoute ,sessionMiddleware, deleteAllMessage) // same but delete all message 
route.put('/edit' ,protectRoute ,sessionMiddleware, editMessage ) // same but edit selected message

//expert to expert chat
route.get("/expert",protectRoute, ExpertSessionMiddleware , getExpertsForSidebar) // first checking login user then session then giving the user data
route.get("/expert/:id", protectRoute , ExpertSessionMiddleware , getExpertMessages) // same and  geting the message
route.post("/expert/send/:id",protectRoute, ExpertSessionMiddleware , sendExpertMessage) // same and sending message
route.delete("/expert/delete" ,protectRoute ,ExpertSessionMiddleware, deleteExpertMessage) // same but to delete selected message 
route.delete("/expert/deleteallmessage",protectRoute ,ExpertSessionMiddleware, deleteAllExpertMessages) // same but delete all message 
route.put('/expert/edit' ,protectRoute ,ExpertSessionMiddleware, editExpertMessage ) // same but edit selected message

export default route;