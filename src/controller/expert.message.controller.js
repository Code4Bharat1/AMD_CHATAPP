import { getDB } from "../lib/db.js";
import { ObjectId } from "mongodb";
import { getExpertSocketId, io } from "../lib/socket.js"; // Use getExpertSocketId for experts

// Get connected experts for sidebar (unchanged)
export const getExpertsForSidebar = async (req, res) => {
  try {
    const db = getDB();

    if (!req.expert || !req.expert._id || !ObjectId.isValid(req.expert._id)) {
      console.error("Authentication error: Missing expert data in request");
      return res.status(401).json({
        message:
          "Unauthorized - Only authenticated experts can access this feature",
      });
    }

    const currentExpertId = new ObjectId(req.expert._id);
    const sessionsCollection = db.collection("experttoexpertsessions");
    const expertCollection = db.collection("expert");

    const activeSessions = await sessionsCollection
      .find({
        $or: [
          { consultingExpertID: currentExpertId },
          { expertId: currentExpertId },
        ],
        status: "confirmed",
      })
      .toArray();

    const expertIds = activeSessions
      .flatMap((session) => [session.consultingExpertID, session.expertId])
      .filter((id) => !id.equals(currentExpertId));

    if (expertIds.length === 0) {
      console.log("No active expert sessions found");
      return res.status(200).json([]);
    }

    const connectedExperts = await expertCollection
      .find(
        { _id: { $in: expertIds } },
        {
          projection: {
            _id: 1,
            role: 1,
            firstName: 1,
            lastName: 1,
            photoFile: 1,
            specialization: 1,
            status: 1,
            lastActive: 1,
            rating: 1,
          },
        }
      )
      .toArray();

    console.log(`Found ${connectedExperts.length} connected experts`);
    return res.status(200).json(connectedExperts);
  } catch (error) {
    console.error("❌ Error in getExpertsForSidebar:", error.message);
    res.status(500).json({
      message: "Internal Server Error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Get messages between current expert and selected expert (unchanged)
export const getExpertMessages = async (req, res) => {
  try {
    const db = getDB();
    const expertMessageCollection = db.collection("expertMessages");
    const { id: receiverId } = req.params;

    if (!req.expert || !req.expert._id) {
      console.error("Authentication error: Missing expert data in request");
      return res.status(401).json({
        message: "Unauthorized - Only experts can access this feature",
      });
    }

    const senderId = req.expert._id;
    const senderObjectId =
      typeof senderId === "string" ? new ObjectId(senderId) : senderId;
    const receiverObjectId = new ObjectId(receiverId);

    console.log("Expert Sender ID:", senderObjectId);
    console.log("Expert Receiver ID:", receiverObjectId);

    const messages = await expertMessageCollection
      .find({
        $or: [
          { senderId: senderObjectId, receiverId: receiverObjectId },
          { senderId: receiverObjectId, receiverId: senderObjectId },
        ],
      })
      .sort({ createdAt: 1 })
      .toArray();

    console.log(`Found ${messages.length} expert messages`);

    const formattedMessages = messages.map((msg) => ({
      _id: msg._id,
      senderId: msg.senderId.toString(),
      receiverId: msg.receiverId.toString(),
      text: msg.text,
      time: msg.createdAt,
      isEdited: msg.isEdited || false,
      attachments: msg.attachments || [],
    }));

    res.status(200).json({ messages: formattedMessages });
  } catch (error) {
    console.error("❌ Error in getExpertMessages:", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

// Send message between experts (updated for room-based messaging)
export const sendExpertMessage = async (req, res) => {
  try {
    const db = getDB();
    const expertMessageCollection = db.collection("expertMessages");

    const { id: receiverId } = req.params;
    const { text, attachments } = req.body;
    const senderId = req.expert._id;

    if (!senderId || !receiverId) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    if (!text && (!attachments || attachments.length === 0)) {
      return res
        .status(400)
        .json({ message: "Message must contain text or attachments" });
    }

    // Create the new message
    const newMessage = {
      senderId:
        typeof senderId === "string" ? new ObjectId(senderId) : senderId,
      receiverId: new ObjectId(receiverId),
      text: text ? String(text) : "",
      attachments: attachments || [],
      createdAt: new Date(),
    };

    // Insert the message into the database
    const result = await expertMessageCollection.insertOne(newMessage);

    // Format the response message
    const responseMessage = {
      _id: result.insertedId.toString(),
      senderId: newMessage.senderId.toString(),
      receiverId: newMessage.receiverId.toString(),
      text: newMessage.text,
      attachments: newMessage.attachments,
      time: newMessage.createdAt,
    };

    // Emit to the conversation room
    const roomId = [senderId.toString(), receiverId.toString()]
      .sort()
      .join("-");
    console.log(`Emitting newExpertMessage to room: ${roomId}`);
    io.to(roomId).emit("newExpertMessage", responseMessage);

    // Send success response
    res.status(201).json(responseMessage);
  } catch (error) {
    console.error("❌ Error in sendExpertMessage:", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

// Delete a specific message between experts (updated)
export const deleteExpertMessage = async (req, res) => {
  const { messageID } = req.body;

  try {
    const senderID = req.expert._id;
    const db = getDB();
    const expertMessages = db.collection("expertMessages");

    if (
      !messageID ||
      typeof messageID !== "string" ||
      messageID.trim() === ""
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid message ID format",
      });
    }

    let messageObjectId;
    try {
      messageObjectId = new ObjectId(messageID);
    } catch (err) {
      console.error("Invalid ObjectId format:", err);
      return res.status(400).json({
        success: false,
        message: "Invalid message ID format",
      });
    }

    const message = await expertMessages.findOne({ _id: messageObjectId });

    if (!message) {
      console.log(`Message not found: ${messageID}`);
      return res.status(200).json({
        message: "Message already deleted or not found",
        alreadyDeleted: true,
      });
    }

    if (!message.senderId.equals(new ObjectId(senderID))) {
      return res
        .status(403)
        .json({ message: "Not authorized to delete this message" });
    }

    const receiverId = message.receiverId;
    const result = await expertMessages.deleteOne({ _id: messageObjectId });

    if (result.deletedCount === 0) {
      return res.status(200).json({
        message: "Message already deleted",
        alreadyDeleted: true,
      });
    }

    // Emit to the conversation room
    const roomId = [senderID.toString(), receiverId.toString()]
      .sort()
      .join("-");
    console.log(`Emitting expertMessageDeleted to room: ${roomId}`);
    io.to(roomId).emit("expertMessageDeleted", {
      messageID: messageID,
      senderID: senderID.toString(),
      receiverID: receiverId.toString(),
    });

    return res.status(200).json({
      success: true,
      message: "Message deleted successfully",
      messageId: messageID,
      deleted: true,
    });
  } catch (err) {
    console.error("❌ Error deleting expert message:", err.message);
    return res.status(500).json({
      success: false,
      message: "Error processing deletion request",
    });
  }
};

// Delete all messages between experts (updated)
export const deleteAllExpertMessages = async (req, res) => {
  const { senderID, receiverID } = req.body; // Fixed typo

  // Validate inputs
  if (!senderID || !receiverID) {
    return res
      .status(400)
      .json({ message: "senderID and receiverID are required" });
  }

  try {
    // Validate ObjectId format
    if (!ObjectId.isValid(senderID) || !ObjectId.isValid(receiverID)) {
      return res
        .status(400)
        .json({ message: "Invalid senderID or receiverID format" });
    }

    const db = getDB();
    const expertMessages = db.collection("expertMessages");

    const senderObjId = new ObjectId(senderID);
    const receiverObjId = new ObjectId(receiverID);

    console.log("Deleting messages between:", { senderObjId, receiverObjId });

    // Check if messages exist before deletion
    const messageCount = await expertMessages.countDocuments({
      $or: [
        { senderId: senderObjId, receiverId: receiverObjId },
        { senderId: receiverObjId, receiverId: senderObjId },
      ],
    });
    console.log(`Found ${messageCount} messages to delete`);

    const result = await expertMessages.deleteMany({
      $or: [
        { senderId: senderObjId, receiverId: receiverObjId },
        { senderId: receiverObjId, receiverId: senderObjId },
      ],
    });

    if (result.deletedCount === 0) {
      return res.status(200).json({
        message: "No messages found to delete",
        alreadyDeleted: true,
      });
    }

    // Emit to the conversation room only on successful deletion
    const roomId = [senderID.toString(), receiverID.toString()]
      .sort()
      .join("-");
    console.log(`Emitting allExpertMessagesDeleted to room: ${roomId}`);
    io.to(roomId).emit("allExpertMessagesDeleted", {
      senderID,
      receiverID, // Fixed typo
      deletedBy: senderID,
      deletedAt: new Date(),
    });

    return res.status(200).json({
      message: "All messages deleted",
      deletedCount: result.deletedCount,
    });
  } catch (err) {
    console.error("❌ Error deleting expert messages:", err);
    return res
      .status(500)
      .json({ message: "Error deleting messages", error: err.message });
  }
};

// Edit a message between experts (updated)
export const editExpertMessage = async (req, res) => {
  const { messageID, newText } = req.body;

  try {
    const db = getDB();
    const expertMessages = db.collection("expertMessages");

    if (
      !messageID ||
      typeof messageID !== "string" ||
      messageID.trim() === ""
    ) {
      return res.status(400).json({ message: "Invalid message ID format" });
    }

    let messageObjectId;
    try {
      messageObjectId = new ObjectId(String(messageID));
    } catch (err) {
      console.error("Invalid ObjectId format:", err);
      return res.status(400).json({ message: "Invalid message ID format" });
    }

    const message = await expertMessages.findOne({
      _id: messageObjectId,
    });

    if (!message) {
      console.log(`Expert message not found with ID: ${messageID}`);
      return res.status(404).json({
        message: "Message not found or has been deleted",
      });
    }

    if (!message.senderId.equals(req.expert._id)) {
      return res
        .status(403)
        .json({ message: "Only the sender can edit this message" });
    }

    const result = await expertMessages.updateOne(
      { _id: messageObjectId },
      {
        $set: { text: newText, isEdited: true, editedAt: new Date() },
      }
    );

    if (result.modifiedCount === 0) {
      return res.status(200).json({
        success: false,
        message: "Message update failed, message may have been deleted",
      });
    }

    const updatedMessageDoc = await expertMessages.findOne({
      _id: messageObjectId,
    });

    const updatedMessage = {
      _id: updatedMessageDoc._id.toString(),
      senderId: updatedMessageDoc.senderId.toString(),
      receiverId: updatedMessageDoc.receiverId.toString(),
      text: updatedMessageDoc.text,
      attachments: updatedMessageDoc.attachments || [],
      time: updatedMessageDoc.createdAt,
      isEdited: true,
      editedAt: updatedMessageDoc.editedAt,
    };

    // Emit to the conversation room
    const roomId = [updatedMessage.senderId, updatedMessage.receiverId]
      .sort()
      .join("-");
    console.log(`Emitting expertMessageEdited to room: ${roomId}`);
    io.to(roomId).emit("expertMessageEdited", updatedMessage);

    return res.status(200).json(updatedMessage);
  } catch (err) {
    console.error("❌ Error updating expert message:", err.message);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};
