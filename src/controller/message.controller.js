// Backend Controller Fixes
// Fix misspelled receiverId and improve socket event handling

import { getDB } from "../lib/db.js";
import { ObjectId } from "mongodb";
import { getReceiverSocketId, io } from "../lib/socket.js";

// Get users for sidebar - used in frontend chat component
export const getUserForSidebar = async (req, res) => {
  try {
    const db = getDB();

    // If a user is logged in, find expert(s) from session
    if (req.user && req.session?.length > 0) {
      const expertIds = req.session.map((s) => new ObjectId(s.expertId));
      const expertCollection = db.collection("expert");

      const experts = await expertCollection
        .find(
          { _id: { $in: expertIds } },
          {
            projection: {
              role: 1,
              firstName: 1,
              lastName: 1,
              photoFile: 1,
            },
          }
        )
        .toArray();

      return res.status(200).json(experts);
    }

    // If an expert is logged in, find user(s) from session
    if (req.expert && req.session?.length > 0) {
      const userIds = req.session.map((s) => new ObjectId(s.userId));
      const userCollection = db.collection("user");

      const users = await userCollection
        .find(
          { _id: { $in: userIds } },
          {
            projection: {
              role: 1,
              firstName: 1,
              lastName: 1,
              photoFile: 1,
            },
          }
        )
        .toArray();

      console.log("Users found for expert:", users);
      return res.status(200).json(users);
    }

    // If no users found, return empty array instead of message object
    console.log("No users found in getUserForSidebar");
    return res.status(200).json([]);
  } catch (error) {
    console.error("❌ Error in getUserForSidebar:", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

export const getMessages = async (req, res) => {
  console.log("🔍 Route hit:", req.path);
  console.log("🔍 Params:", req.params);
  console.log("🔍 User:", req.user);
  console.log("🔍 Expert:", req.expert);
  try {
    const db = getDB();
    if (!db) throw new Error("Database connection failed");
    const messageCollection = db.collection("messages");
    const { id: receiverId } = req.params;

    // Get sender ID from authenticated user or expert
    const senderId = req.user?._id || req.expert?._id;
    if (!senderId) {
      return res.status(401).json({ message: "Unauthorized - No sender ID" });
    }

    // Validate IDs
    if (!ObjectId.isValid(senderId) || !ObjectId.isValid(receiverId)) {
      return res.status(400).json({ message: "Invalid sender or receiver ID" });
    }

    // Convert string IDs to ObjectIds
    const senderObjectId =
      typeof senderId === "string" ? new ObjectId(senderId) : senderId;
    const receiverObjectId = new ObjectId(receiverId);

    // Pagination parameters (optional, from query)
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    // Find messages between the two users
    const messages = await messageCollection
      .find({
        $or: [
          { senderId: senderObjectId, receiverId: receiverObjectId },
          { senderId: receiverObjectId, receiverId: senderObjectId },
        ],
      })
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    // Format messages for frontend
    const formattedMessages = messages.map((msg) => {
      const formattedMsg = {
        _id: msg._id.toString(),
        senderId: msg.senderId.toString(),
        receiverId: msg.receiverId.toString(),
        text: msg.text,
        time: msg.createdAt,
        isEdited: msg.isEdited || false,
      };

      // File message formatting
      if (msg.isFile) {
        formattedMsg.isFile = true;
        formattedMsg.fileId = msg.fileId?.toString() || null;
        formattedMsg.fileType = msg.fileType;
        formattedMsg.fileSize = msg.fileSize;
      }

      // Voice message formatting
      if (msg.isVoice) {
        formattedMsg.isVoice = true;
        formattedMsg.voiceId = msg.voiceId?.toString() || null;
        formattedMsg.voiceDuration = msg.voiceDuration || null;
        formattedMsg.voiceMimeType = msg.voiceMimeType || "audio/webm";
      }

      return formattedMsg;
    });

    // Get total message count for pagination (optional)
    const totalMessages = await messageCollection.countDocuments({
      $or: [
        { senderId: senderObjectId, receiverId: receiverObjectId },
        { senderId: receiverObjectId, receiverId: senderObjectId },
      ],
    });

    res.status(200).json({
      messages: formattedMessages,
      totalMessages,
      page,
      limit,
    });
  } catch (error) {
    console.error("❌ Error in getMessages:", error.message);
    if (error.message.includes("ObjectId")) {
      return res.status(400).json({ message: "Invalid ID format" });
    }
    res.status(500).json({ message: "Internal Server Error" });
  }
};

// Send a new message
export const sendMessage = async (req, res) => {
  try {
    const db = getDB();
    const messageCollection = db.collection("messages");

    const { id: receiverId } = req.params;
    const { text } = req.body;
    const senderId = req.user ? req.user._id : req.expert._id;

    if (!senderId || !receiverId || !text) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // Create the new message with proper field names
    const newMessage = {
      senderId:
        typeof senderId === "string" ? new ObjectId(senderId) : senderId,
      receiverId: new ObjectId(receiverId), // FIXED: reciverId -> receiverId
      text: String(text),
      createdAt: new Date(),
    };

    // Insert the message into the database
    const result = await messageCollection.insertOne(newMessage);

    // Format the response message
    const responseMessage = {
      _id: result.insertedId,
      senderId: newMessage.senderId.toString(),
      receiverId: newMessage.receiverId.toString(), // FIXED: reciverId -> receiverId
      text: newMessage.text,
      time: newMessage.createdAt,
    };

    // Emit the message through socket.io if receiver is online
    const receiverSocketId = getReceiverSocketId(receiverId);
    if (receiverSocketId) {
      console.log(`Sending message to socket: ${receiverSocketId}`);
      io.to(receiverSocketId).emit("newMessage", responseMessage);
    }

    // Send success response
    res.status(201).json(responseMessage);
  } catch (error) {
    console.error("❌ Error in sendMessage:", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

// Get logged in user info
export const getLogginUser = async (req, res) => {
  try {
    // Return the current authenticated user - from middleware
    if (req.user) {
      const userInfo = {
        _id: req.user._id.toString(),
        firstName: req.user.firstName,
        lastName: req.user.lastName,
        photoFile: req.user.photoFile,
        role: req.user.role,
      };
      return res.status(200).json(userInfo);
    }

    if (req.expert) {
      const expertInfo = {
        _id: req.expert._id.toString(),
        firstName: req.expert.firstName,
        lastName: req.expert.lastName,
        photoFile: req.expert.photoFile,
        role: req.expert.role,
      };
      return res.status(200).json(expertInfo);
    }

    console.log("No authenticated user found");
    return res.status(401).json({ message: "Not authenticated" });
  } catch (error) {
    console.error("❌ Error in getLogginUser:", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

export const deleteOneMessage = async (req, res) => {
  const { messageID } = req.body;

  try {
    const senderID = req.user?._id || req.expert?._id;
    const db = getDB();
    const messages = db.collection("messages");

    console.log(`Attempting to delete message ID: ${messageID}`);

    // Validate messageID
    if (!messageID || !ObjectId.isValid(messageID)) {
      console.error(`Invalid message ID: ${messageID}`);
      return res.status(400).json({ message: "Invalid message ID" });
    }

    const messageObjId = new ObjectId(messageID);

    // Find the message first
    const message = await messages.findOne({ _id: messageObjId });

    if (!message) {
      console.log(`Message not found: ${messageID}`);
      return res.status(200).json({
        // Changed from 404 to 200
        message: "Message already deleted or not found",
        alreadyDeleted: true,
      });
    }

    // Authorization check
    if (!message.senderId.equals(new ObjectId(senderID))) {
      return res
        .status(403)
        .json({ message: "Not authorized to delete this message" });
    }

    // Store receiver info before deleting
    const receiverId = message.receiverId || message.reciverId;

    // Delete the message
    const result = await messages.deleteOne({ _id: messageObjId });

    if (result.deletedCount === 0) {
      return res.status(200).json({
        // Changed from 404 to 200
        message: "Message already deleted",
        alreadyDeleted: true,
      });
    }

    console.log(`Message deleted, notifying receiver: ${receiverId}`);

    // Emit socket event to receiver
    const receiverSocketId = getReceiverSocketId(receiverId.toString());
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("messageDeleted", {
        messageID: messageID,
        senderID: senderID.toString(),
      });
    }

    return res.status(200).json({
      message: "Message deleted successfully",
      deleted: true,
    });
  } catch (err) {
    console.error("Error deleting message:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Delete all messages between two users
export const deleteAllMessage = async (req, res) => {
  const { senderID, reciverID } = req.body;

  try {
    const db = getDB();
    const messages = db.collection("messages");

    const senderObjId = new ObjectId(senderID);
    const receiverObjId = new ObjectId(reciverID);

    // Only sender can perform this delete action (security check)
    const userId = req.user?._id || req.expert?._id;
    if (!userId || !senderObjId.equals(userId)) {
      return res
        .status(403)
        .json({ message: "You are not authorized to delete these messages" });
    }

    // Find and delete all messages from sender to receiver and vice versa
    // FIXED: Use receiverId instead of reciverId
    const result = await messages.deleteMany({
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

    // Emit to the receiver that all messages have been deleted
    const receiverSocketId = getReceiverSocketId(reciverID);
    if (receiverSocketId) {
      console.log(
        `Emitting delete all messages event to socket: ${receiverSocketId}`
      );
      io.to(receiverSocketId).emit("allMessagesDeleted", {
        senderID: senderID,
        reciverID: reciverID,
      });
    }

    return res.status(200).json({
      message: "Messages deleted for everyone",
      deletedCount: result.deletedCount,
    });
  } catch (err) {
    console.error("❌ Error deleting messages:", err.message);
    return res.status(500).json({ message: "Error deleting messages" });
  }
};

export const editMessage = async (req, res) => {
  const { messageID, newText } = req.body;

  try {
    const db = getDB();
    const messages = db.collection("messages");

    // Validate messageID format
    if (
      !messageID ||
      typeof messageID !== "string" ||
      messageID.trim() === ""
    ) {
      return res.status(200).json({
        success: false,
        message: "Invalid message ID format",
      });
    }

    let messageObjectId;
    try {
      messageObjectId = new ObjectId(String(messageID));
    } catch (err) {
      console.error("Invalid ObjectId format:", err);
      return res.status(200).json({
        success: false,
        message: "Invalid message ID format",
      });
    }

    // Find the message by its ID first
    const message = await messages.findOne({
      _id: messageObjectId,
    });

    if (!message) {
      console.log(`Message not found with ID: ${messageID}`);
      return res.status(200).json({
        success: false,
        message: "Message not found or has been deleted",
      });
    }

    // Get the authenticated user ID from the middleware
    const userId = req.user?._id || req.expert?._id;
    if (!userId) {
      return res.status(200).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Check if the authenticated user is the sender of the message
    // Convert userId to ObjectId for comparison if it's not already
    const userObjectId =
      typeof userId === "string" ? new ObjectId(userId) : userId;

    if (!message.senderId.equals(userObjectId)) {
      return res.status(200).json({
        success: false,
        message: "Only the sender can edit this message",
      });
    }

    // Update the message
    const updateResult = await messages.updateOne(
      { _id: messageObjectId },
      {
        $set: {
          text: newText,
          isEdited: true,
          editedAt: new Date(),
        },
      }
    );

    console.log("Update result:", updateResult);

    // Check if update was successful
    if (updateResult.modifiedCount === 0) {
      return res.status(200).json({
        success: false,
        message: "Message update failed, message may have been deleted",
      });
    }

    // Get the updated message for emitting via socket
    const updatedMessageDoc = await messages.findOne({ _id: messageObjectId });

    // IMPORTANT: Format the updated message correctly to match client expectations
    const updatedMessage = {
      _id: updatedMessageDoc._id.toString(),
      senderId: updatedMessageDoc.senderId.toString(),
      receiverId: updatedMessageDoc.receiverId.toString(),
      text: updatedMessageDoc.text,
      time: updatedMessageDoc.createdAt,
      createdAt: updatedMessageDoc.createdAt,
      isEdited: true,
      editedAt: updatedMessageDoc.editedAt,
      // Include any other fields that might be in your message objects
    };

    console.log("Message updated successfully:", updatedMessage);

    // Emit socket event to both sender and receiver
    // Get socket IDs for both users
    const senderSocketId = getReceiverSocketId(
      updatedMessageDoc.senderId.toString()
    );
    const receiverSocketId = getReceiverSocketId(
      updatedMessageDoc.receiverId.toString()
    );

    // Emit to sender
    if (senderSocketId) {
      io.to(senderSocketId).emit("messageEdited", updatedMessage);
      console.log("Socket event emitted to sender");
    }

    // Emit to receiver
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("messageEdited", updatedMessage);
      console.log("Socket event emitted to receiver");
    }

    // Respond with success and the updated message
    return res.status(200).json({
      success: true,
      message: updatedMessage,
    });
  } catch (err) {
    console.error("❌ Error updating message:", err.message);
    return res.status(200).json({
      success: false,
      message: "Server error while processing message edit",
    });
  }
};
