// Expert Chat Controller
// Handles messaging between experts in the system

import { getDB } from "../lib/db.js";
import { ObjectId } from "mongodb";
import { getReceiverSocketId, io } from "../lib/socket.js";

// Get other experts for sidebar - used in frontend expert chat component
export const getExpertsForSidebar = async (req, res) => {
  try {
    const db = getDB();
    
    // More robust check for authenticated expert
    if (!req.expert || !req.expert._id) {
      console.error("Authentication error: Missing expert data in request");
      return res.status(401).json({ message: "Unauthorized - Only experts can access this feature" });
    }
    
    // Convert string ID to ObjectId if needed
    const expertId = typeof req.expert._id === 'string' ? new ObjectId(req.expert._id) : req.expert._id;
    
    console.log("Current expert ID:", expertId);
    
    const expertCollection = db.collection("expert");
    
    try {
      // Find all experts except the current one
      const experts = await expertCollection
        .find(
          { _id: { $ne: expertId } },
          {
            projection: {
              role: 1,
              firstName: 1,
              lastName: 1,
              photoFile: 1,
              specialization: 1, // Include specialization for experts
              status: 1 // Include status (online/offline)
            },
          }
        )
        .toArray();
      
      console.log(`Found ${experts.length} other experts for sidebar`);
      return res.status(200).json(experts);
    } catch (dbError) {
      console.error("Database error in getExpertsForSidebar:", dbError);
      return res.status(500).json({ message: "Database error", error: dbError.message });
    }
  } catch (error) {
    console.error("❌ Error in getExpertsForSidebar:", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

// Get messages between current expert and selected expert
export const getExpertMessages = async (req, res) => {
  try {
    const db = getDB();
    const expertMessageCollection = db.collection("expertMessages");
    const { id: receiverId } = req.params; // Receiver expert ID from the request

    // More robust check for authenticated expert
    if (!req.expert || !req.expert._id) {
      console.error("Authentication error: Missing expert data in request");
      return res.status(401).json({ message: "Unauthorized - Only experts can access this feature" });
    }

    // Get sender ID from authenticated expert
    const senderId = req.expert._id;

    // Convert string IDs to ObjectIds for MongoDB query
    const senderObjectId = typeof senderId === 'string' ? new ObjectId(senderId) : senderId;
    const receiverObjectId = new ObjectId(receiverId);

    console.log("Expert Sender ID:", senderObjectId);
    console.log("Expert Receiver ID:", receiverObjectId);

    // Find all messages between these two experts
    const messages = await expertMessageCollection
      .find({
        $or: [
          { senderId: senderObjectId, receiverId: receiverObjectId },
          { senderId: receiverObjectId, receiverId: senderObjectId },
        ],
      })
      .sort({ createdAt: 1 }) // Sort messages by time
      .toArray();

    console.log(`Found ${messages.length} expert messages`);

    // Format messages for frontend
    const formattedMessages = messages.map(msg => ({
      _id: msg._id,
      senderId: msg.senderId.toString(),
      receiverId: msg.receiverId.toString(),
      text: msg.text,
      time: msg.createdAt,
      isEdited: msg.isEdited || false,
      attachments: msg.attachments || [] // Support for attachments like files or images
    }));

    // Always return an array of messages
    res.status(200).json({ messages: formattedMessages });
  } catch (error) {
    console.error("❌ Error in getExpertMessages:", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

// Rest of the controller functions remain unchanged
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
      return res.status(400).json({ message: "Message must contain text or attachments" });
    }

    // Create the new message
    const newMessage = {
      senderId: typeof senderId === 'string' ? new ObjectId(senderId) : senderId,
      receiverId: new ObjectId(receiverId),
      text: text ? String(text) : "",
      attachments: attachments || [],
      createdAt: new Date(),
    };

    // Insert the message into the database
    const result = await expertMessageCollection.insertOne(newMessage);

    // Format the response message
    const responseMessage = {
      _id: result.insertedId,
      senderId: newMessage.senderId.toString(),
      receiverId: newMessage.receiverId.toString(),
      text: newMessage.text,
      attachments: newMessage.attachments,
      time: newMessage.createdAt
    };

    // Emit the message through socket.io if receiver is online
    const receiverSocketId = getReceiverSocketId(receiverId);
    if (receiverSocketId) {
      console.log(`Sending expert message to socket: ${receiverSocketId}`);
      io.to(receiverSocketId).emit("newExpertMessage", responseMessage);
    }

    // Send success response
    res.status(201).json(responseMessage);
  } catch (error) {
    console.error("❌ Error in sendExpertMessage:", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

// Delete a specific message between experts
export const deleteExpertMessage = async (req, res) => {
  const { messageID } = req.body;

  try {
    const senderID = req.expert._id;
    const db = getDB();
    const expertMessages = db.collection("expertMessages");

    // Validate messageID format
    if (!messageID || typeof messageID !== 'string' || messageID.trim() === '') {
      return res.status(400).json({ message: "Invalid message ID format" });
    }
    
    let messageObjectId;
    try {
      messageObjectId = new ObjectId(messageID);
    } catch (err) {
      console.error("Invalid ObjectId format:", err);
      return res.status(400).json({ message: "Invalid message ID format" });
    }

    // Find the message by its ID
    const message = await expertMessages.findOne({
      _id: messageObjectId,
    });

    if (!message) {
      console.log(`Expert message not found with ID: ${messageID}`);
      return res.status(404).json({ 
        message: "Message already deleted or not found",
        alreadyDeleted: true 
      });
    }

    // Check if the sender is the one who sent the message
    if (!message.senderId.equals(new ObjectId(senderID))) {
      return res
        .status(403)
        .json({ message: "You are not authorized to delete this message" });
    }

    // Delete the message permanently
    const result = await expertMessages.findOneAndDelete({
      _id: messageObjectId,
    });

    if (!result.value) {
      return res.status(404).json({ 
        message: "Message already deleted", 
        alreadyDeleted: true 
      });
    }

    // Get receiver socket ID to notify them of message deletion in real-time
    const receiverSocketId = getReceiverSocketId(message.receiverId.toString());
    if (receiverSocketId) {
      console.log(`Emitting expert message deletion event to socket: ${receiverSocketId}`);
      io.to(receiverSocketId).emit("expertMessageDeleted", { 
        messageId: messageID,
        senderId: senderID.toString()
      });
    }

    // Return success response
    return res.status(200).json({
      message: "Message deleted",
      deleted: result.value,
    });
  } catch (err) {
    console.error("❌ Error deleting expert message:", err.message);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

// Delete all messages between two experts
export const deleteAllExpertMessages = async (req, res) => {
  const { receiverId } = req.body;

  try {
    const db = getDB();
    const expertMessages = db.collection("expertMessages");

    const senderObjId = req.expert._id;
    const receiverObjId = new ObjectId(receiverId);

    // Find and delete all messages from sender to receiver and vice versa
    const result = await expertMessages.deleteMany({
      $or: [
        { senderId: senderObjId, receiverId: receiverObjId },
        { senderId: receiverObjId, receiverId: senderObjId },
      ],
    });

    if (result.deletedCount === 0) {
      return res.status(200).json({ 
        message: "No messages found to delete",
        alreadyDeleted: true
      });
    }

    // Emit to the receiver that all messages have been deleted
    const receiverSocketId = getReceiverSocketId(receiverId);
    if (receiverSocketId) {
      console.log(`Emitting delete all expert messages event to socket: ${receiverSocketId}`);
      io.to(receiverSocketId).emit("allExpertMessagesDeleted", { 
        conversationPartnerId: senderObjId.toString()
      });
    }

    return res.status(200).json({
      message: "All messages deleted",
      deletedCount: result.deletedCount,
    });
  } catch (err) {
    console.error("❌ Error deleting expert messages:", err.message);
    return res.status(500).json({ message: "Error deleting messages" });
  }
};

// Edit a message between experts
export const editExpertMessage = async (req, res) => {
  const { messageID, newText } = req.body;

  try {
    const db = getDB();
    const expertMessages = db.collection("expertMessages");

    // Validate messageID format
    if (!messageID || typeof messageID !== 'string' || messageID.trim() === '') {
      return res.status(400).json({ message: "Invalid message ID format" });
    }
    
    let messageObjectId;
    try {
      messageObjectId = new ObjectId(String(messageID));
    } catch (err) {
      console.error("Invalid ObjectId format:", err);
      return res.status(400).json({ message: "Invalid message ID format" });
    }

    // Find the message by its ID
    const message = await expertMessages.findOne({
      _id: messageObjectId,
    });

    if (!message) {
      console.log(`Expert message not found with ID: ${messageID}`);
      return res.status(404).json({ 
        message: "Message not found or has been deleted"
      });
    }

    // Check if the authenticated expert is the sender of the message
    if (!message.senderId.equals(req.expert._id)) {
      return res
        .status(403)
        .json({ message: "Only the sender can edit this message" });
    }

    // Update the message
    const result = await expertMessages.findOneAndUpdate(
      { _id: messageObjectId },
      {
        $set: { text: newText, isEdited: true, editedAt: new Date() },
      },
      { returnDocument: "after" }
    );

    if (!result.value) {
      return res.status(404).json({ 
        message: "Message update failed, message may have been deleted"
      });
    }

    // Format the updated message for response
    const updatedMessage = {
      _id: result.value._id.toString(),
      senderId: result.value.senderId.toString(),
      receiverId: result.value.receiverId.toString(),
      text: result.value.text,
      attachments: result.value.attachments || [],
      time: result.value.createdAt,
      isEdited: true,
      editedAt: result.value.editedAt
    };

    // Get receiver socket ID to notify them of the edit
    const receiverSocketId = getReceiverSocketId(result.value.receiverId.toString());
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("expertMessageEdited", updatedMessage);
    }

    // Respond with the updated message
    return res.status(200).json(updatedMessage);
  } catch (err) {
    console.error("❌ Error updating expert message:", err.message);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

// Mark messages as read
export const markExpertMessagesAsRead = async (req, res) => {
  try {
    const db = getDB();
    const expertMessageCollection = db.collection("expertMessages");
    const { senderId } = req.body;
    const receiverId = req.expert._id;

    if (!senderId) {
      return res.status(400).json({ message: "Missing sender ID" });
    }

    // Convert IDs to ObjectId
    const senderObjectId = new ObjectId(senderId);
    const receiverObjectId = typeof receiverId === 'string' ? new ObjectId(receiverId) : receiverId;

    // Mark messages as read where current expert is the receiver
    const result = await expertMessageCollection.updateMany(
      { 
        senderId: senderObjectId, 
        receiverId: receiverObjectId,
        read: { $ne: true } // Only update unread messages
      },
      { $set: { read: true, readAt: new Date() } }
    );

    // Notify sender that messages have been read
    const senderSocketId = getReceiverSocketId(senderId);
    if (senderSocketId) {
      io.to(senderSocketId).emit("expertMessagesRead", {
        readBy: receiverObjectId.toString(),
        timestamp: new Date()
      });
    }

    return res.status(200).json({
      message: "Messages marked as read",
      count: result.modifiedCount
    });
  } catch (error) {
    console.error("❌ Error marking messages as read:", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

// Get unread message count for an expert
export const getUnreadExpertMessageCount = async (req, res) => {
  try {
    const db = getDB();
    const expertMessageCollection = db.collection("expertMessages");
    
    // More robust check for authenticated expert
    if (!req.expert || !req.expert._id) {
      console.error("Authentication error: Missing expert data in request");
      return res.status(401).json({ message: "Unauthorized - Only experts can access this feature" });
    }
    
    const expertId = req.expert._id;

    // Count all unread messages where expert is the receiver
    const unreadCounts = await expertMessageCollection.aggregate([
      { 
        $match: { 
          receiverId: expertId,
          read: { $ne: true } 
        } 
      },
      {
        $group: {
          _id: "$senderId",
          count: { $sum: 1 }
        }
      }
    ]).toArray();

    // Format the response
    const formattedCounts = {};
    unreadCounts.forEach(item => {
      formattedCounts[item._id.toString()] = item.count;
    });

    return res.status(200).json(formattedCounts);
  } catch (error) {
    console.error("❌ Error getting unread message count:", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
};