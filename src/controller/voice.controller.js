import { getDB } from "../lib/db.js";
import { ObjectId } from "mongodb";
import { getReceiverSocketId, io } from "../lib/socket.js";
import multer from "multer";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";

// Configure storage for voice message uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const voiceDir = path.join(process.cwd(), "uploads", "voice");
    
    // Create uploads/voice directory if it doesn't exist
    if (!fs.existsSync(voiceDir)) {
      fs.mkdirSync(voiceDir, { recursive: true });
    }
    
    cb(null, voiceDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename with original extension
    const fileExt = path.extname(file.originalname) || '.mp3';
    const fileName = `voice-${uuidv4()}${fileExt}`;
    cb(null, fileName);
  }
});

// Enhanced file filter to validate voice uploads
const fileFilter = (req, file, cb) => {
  // Extended list of allowed audio file types
  const allowedTypes = [
    'audio/mpeg',           // .mp3
    'audio/mp4',            // .m4a
    'audio/webm',           // .webm
    'audio/ogg',            // .ogg
    'audio/wav',            // .wav
    'audio/x-wav',
    'audio/aac',            // .aac
    'audio/x-m4a',
    'audio/basic',
    'audio/vnd.wave',
    'audio/*'               // Allow any audio/* MIME type as fallback
  ];
  
  // Check MIME type
  if (allowedTypes.includes(file.mimetype) || file.mimetype.startsWith('audio/')) {
    cb(null, true);
  } else {
    // Log the rejected file type for debugging
    console.log(`Rejected file upload with MIME type: ${file.mimetype}`);
    cb(new Error('Invalid file type. Only audio formats are allowed.'), false);
  }
};

// Configure multer with size limits (10MB for voice messages - increased from 5MB)
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit for voice messages
});

// Helper to get voice upload middleware
export const voiceUploadMiddleware = upload.single('voice');

// Error handler middleware for multer errors
export const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    // A Multer error occurred when uploading
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ 
        error: true,
        message: "File too large. Maximum size is 10MB."
      });
    }
    return res.status(400).json({ 
      error: true,
      message: `Upload error: ${err.message}`
    });
  } else if (err) {
    // An unknown error occurred
    return res.status(400).json({ 
      error: true,
      message: err.message || "Unknown error during file upload"
    });
  }
  
  // If no error, continue
  next();
};

// Helper function to safely convert to ObjectId
const safeObjectId = (id) => {
  if (!id) return null;
  
  // If already an ObjectId instance, return as is
  if (id instanceof ObjectId) return id;
  
  // If string, try to convert
  if (typeof id === "string" && ObjectId.isValid(id)) {
    return new ObjectId(id);
  }
  
  // If it's some other object with a toString method that gives a valid ObjectId string
  if (id && id.toString && typeof id.toString === "function") {
    const idStr = id.toString();
    if (ObjectId.isValid(idStr)) {
      return new ObjectId(idStr);
    }
  }
  
  // If we get here, we can't convert to a valid ObjectId
  return null;
};

// Helper function to ensure directory exists
const ensureDirectoryExists = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`Created directory: ${dirPath}`);
  }
};

// Upload a voice message in a chat
export const uploadVoiceMessage = async (req, res) => {
  try {
    // Check if uploads directory exists and create if not
    const uploadsDir = path.join(process.cwd(), "uploads");
    const voiceDir = path.join(uploadsDir, "voice");
    ensureDirectoryExists(uploadsDir);
    ensureDirectoryExists(voiceDir);
    
    // Voice file should be available on req.file after multer middleware
    if (!req.file) {
      return res.status(400).json({ 
        error: true, 
        message: "No voice message uploaded"
      });
    }

    // Validate required parameters
    const { id: receiverId } = req.params;
    if (!receiverId) {
      // Clean up file if parameters are invalid
      if (req.file && req.file.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({ 
        error: true, 
        message: "Receiver ID is required"
      });
    }

    // Get sender ID from authenticated user
    const senderId = req.user ? req.user._id : (req.expert ? req.expert._id : null);
    if (!senderId) {
      // Clean up file if user is not authenticated
      if (req.file && req.file.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(401).json({ 
        error: true, 
        message: "User not authenticated"
      });
    }

    const { duration } = req.body; // Voice duration in seconds

    // Validate and convert IDs to ObjectId safely
    const senderIdObj = safeObjectId(senderId);
    const receiverIdObj = safeObjectId(receiverId);

    if (!senderIdObj || !receiverIdObj) {
      // Remove uploaded file if validation fails
      if (req.file.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({ 
        error: true, 
        message: "Invalid sender or receiver ID"
      });
    }

    const db = getDB();
    const voiceCollection = db.collection("messages");
    const messageCollection = db.collection("messages");

    // Create voice message document
    const voiceDoc = {
      fileName: req.file.filename,
      mimeType: req.file.mimetype,
      size: req.file.size,
      path: req.file.path,
      duration: duration ? parseFloat(duration) : null,
      uploadDate: new Date(),
      senderId: senderIdObj,
      receiverId: receiverIdObj
    };

    // Save voice metadata to database
    const voiceResult = await voiceCollection.insertOne(voiceDoc);
    
    if (!voiceResult.acknowledged || !voiceResult.insertedId) {
      // Remove uploaded file if database insertion fails
      if (req.file.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(500).json({ 
        error: true, 
        message: "Failed to save voice message metadata"
      });
    }

    // Create a corresponding message for this voice message
    const newMessage = {
      senderId: voiceDoc.senderId,
      receiverId: voiceDoc.receiverId,
      text: "Voice message",
      voiceId: voiceResult.insertedId,
      isVoice: true,
      voiceDuration: voiceDoc.duration,
      voiceSize: req.file.size,
      createdAt: new Date()
    };

    // Save message to database
    const messageResult = await messageCollection.insertOne(newMessage);
    
    if (!messageResult.acknowledged || !messageResult.insertedId) {
      // Remove uploaded file and voice document if message insertion fails
      if (req.file.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      await voiceCollection.deleteOne({ _id: voiceResult.insertedId });
      return res.status(500).json({ 
        error: true, 
        message: "Failed to save message data"
      });
    }

    // Format the response
    const responseMessage = {
      _id: messageResult.insertedId,
      senderId: newMessage.senderId.toString(),
      receiverId: newMessage.receiverId.toString(),
      text: newMessage.text,
      voiceId: newMessage.voiceId.toString(),
      isVoice: true,
      voiceDuration: newMessage.voiceDuration,
      voiceSize: newMessage.voiceSize,
      time: newMessage.createdAt
    };

    // Notify receiver via socket.io
    const receiverSocketId = getReceiverSocketId(receiverId);
    if (receiverSocketId) {
      console.log(`Sending voice message notification to socket: ${receiverSocketId}`);
      io.to(receiverSocketId).emit("newMessage", responseMessage);
    }

    // Send success response
    res.status(201).json({
      error: false,
      message: "Voice message uploaded successfully",
      voice: {
        id: voiceResult.insertedId,
        duration: voiceDoc.duration,
        size: req.file.size
      },
      messageId: messageResult.insertedId,
      ...responseMessage
    });
  } catch (error) {
    console.error("❌ Error in uploadVoiceMessage:", error.message, error.stack);
    
    // Clean up file if it was uploaded but there was a database error
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({ 
      error: true, 
      message: "Internal Server Error: " + error.message
    });
  }
};

// Get voice message info
export const getVoiceInfo = async (req, res) => {
  try {
    const { voiceId } = req.params;
    
    if (!voiceId || !ObjectId.isValid(voiceId)) {
      return res.status(400).json({ 
        error: true, 
        message: "Invalid voice message ID"
      });
    }
    
    const db = getDB();
    const voiceCollection = db.collection("messages");
    
    const voiceDoc = await voiceCollection.findOne({ _id: new ObjectId(voiceId) });
    
    if (!voiceDoc) {
      return res.status(404).json({ 
        error: true, 
        message: "Voice message not found"
      });
    }
    
    // Check authorization
    const userId = req.user ? req.user._id : (req.expert ? req.expert._id : null);
    if (!userId) {
      return res.status(401).json({ 
        error: true, 
        message: "User not authenticated"
      });
    }
    
    const userIdObj = safeObjectId(userId);
    
    if (!userIdObj) {
      return res.status(400).json({ 
        error: true, 
        message: "Invalid user ID"
      });
    }
    
    // Only allow sender or receiver to access the voice message
    if (!voiceDoc.senderId.equals(userIdObj) && !voiceDoc.receiverId.equals(userIdObj)) {
      return res.status(403).json({ 
        error: true, 
        message: "Not authorized to access this voice message"
      });
    }
    
    res.status(200).json({
      error: false,
      id: voiceDoc._id,
      mimeType: voiceDoc.mimeType,
      size: voiceDoc.size,
      duration: voiceDoc.duration,
      uploadDate: voiceDoc.uploadDate,
      senderId: voiceDoc.senderId.toString(),
      receiverId: voiceDoc.receiverId.toString()
    });
  } catch (error) {
    console.error("❌ Error in getVoiceInfo:", error.message, error.stack);
    res.status(500).json({ 
      error: true, 
      message: "Internal Server Error: " + error.message
    });
  }
};

export const streamVoiceMessage = async (req, res) => {
  try {
    const { voiceId } = req.params;
    
    if (!voiceId || !ObjectId.isValid(voiceId)) {
      return res.status(400).json({
        error: true,
        message: "Invalid voice message ID",
      });
    }
    
    const db = getDB();
    const voiceCollection = db.collection("messages");
    const voiceDoc = await voiceCollection.findOne({ _id: new ObjectId(voiceId) });
    
    if (!voiceDoc) {
      return res.status(404).json({
        error: true,
        message: "Voice message not found",
      });
    }
    
    const userId = req.user?._id || req.expert?._id;
    if (!userId) {
      return res.status(401).json({
        error: true,
        message: "User not authenticated",
      });
    }
    
    const userIdObj = safeObjectId(userId);
    if (!userIdObj) {
      return res.status(400).json({
        error: true,
        message: "Invalid user ID",
      });
    }
    
    if (!voiceDoc.senderId.equals(userIdObj) && !voiceDoc.receiverId.equals(userIdObj)) {
      return res.status(403).json({
        error: true,
        message: "Not authorized to access this voice message",
      });
    }
    
    if (!fs.existsSync(voiceDoc.path)) {
      return res.status(404).json({
        error: true,
        message: "Voice file not found on server",
      });
    }
    
    const stat = fs.statSync(voiceDoc.path);
    const fileSize = stat.size;
    const range = req.headers.range;
    
    // Log file details for debugging
    console.log("Voice file details:", {
      path: voiceDoc.path,
      size: fileSize,
      storedMimeType: voiceDoc.mimeType,
      extension: path.extname(voiceDoc.path).toLowerCase()
    });
    
    // Improved MIME type handling
    const supportedAudioTypes = {
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
      '.m4a': 'audio/mp4',
      '.aac': 'audio/aac',
      '.webm': 'audio/webm'
    };
    
    // Extract file extension
    const fileExtension = path.extname(voiceDoc.path).toLowerCase();
    
    // First priority: Use the explicit mapping based on extension
    // Second priority: Use the stored MIME type
    // Last resort: Default to audio/mpeg
    const mimeType = supportedAudioTypes[fileExtension] || 
                     voiceDoc.mimeType || 
                     'audio/mpeg';
    
    console.log(`Using MIME type: ${mimeType} for file with extension: ${fileExtension}`);
    
    // Enhanced headers for better browser compatibility
    const headers = {
      'Content-Type': mimeType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Range',
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `inline; filename="voice-${voiceId}${fileExtension}"`
    };
    
    // Improved range request handling
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      let start = parseInt(parts[0], 10);
      
      // Handle invalid start position
      if (isNaN(start)) {
        start = 0;
      }
      
      // Ensure start is within bounds
      start = Math.max(0, Math.min(start, fileSize - 1));
      
      // End position calculation with safety checks
      let end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      if (isNaN(end) || end >= fileSize) {
        end = fileSize - 1;
      }
      
      // Ensure end is after start
      end = Math.max(start, end);
      
      const chunkSize = end - start + 1;
      
      console.log(`Streaming range: bytes ${start}-${end}/${fileSize}`);
      
      // Set specific headers for range request
      headers['Content-Range'] = `bytes ${start}-${end}/${fileSize}`;
      headers['Content-Length'] = chunkSize;
      
      res.writeHead(206, headers);
      
      // Use high watermark for better streaming performance
      const file = fs.createReadStream(voiceDoc.path, { 
        start, 
        end,
        highWaterMark: 64 * 1024 // 64KB chunks for better performance
      });
      
      // Improved error handling
      file.on('error', (err) => {
        console.error("Stream error:", err);
        if (!res.headersSent) {
          res.status(500).json({
            error: true,
            message: "Error streaming file: " + err.message
          });
        } else {
          res.end();
        }
      });
      
      file.pipe(res);
    } else {
      // Full file request
      headers['Content-Length'] = fileSize;
      
      console.log(`Streaming full file: ${fileSize} bytes`);
      
      res.writeHead(200, headers);
      
      // Use high watermark for better streaming performance
      const stream = fs.createReadStream(voiceDoc.path, {
        highWaterMark: 64 * 1024 // 64KB chunks for better performance
      });
      
      // Improved error handling
      stream.on('error', (err) => {
        console.error("Stream error:", err);
        if (!res.headersSent) {
          res.status(500).json({
            error: true,
            message: "Error streaming file: " + err.message
          });
        } else {
          res.end();
        }
      });
      
      stream.pipe(res);
    }
  } catch (error) {
    console.error("❌ Error in streamVoiceMessage:", error);
    res.status(500).json({
      error: true,
      message: "Internal Server Error: " + error.message,
    });
  }
};

// Download voice message
export const downloadVoiceMessage = async (req, res) => {
  try {
    const { voiceId } = req.params;
    
    if (!voiceId || !ObjectId.isValid(voiceId)) {
      return res.status(400).json({ 
        error: true, 
        message: "Invalid voice message ID"
      });
    }
    
    const db = getDB();
    const voiceCollection = db.collection("messages");
    
    const voiceDoc = await voiceCollection.findOne({ _id: new ObjectId(voiceId) });
    
    if (!voiceDoc) {
      return res.status(404).json({ 
        error: true, 
        message: "Voice message not found"
      });
    }
    
    // Check authorization
    const userId = req.user ? req.user._id : (req.expert ? req.expert._id : null);
    if (!userId) {
      return res.status(401).json({ 
        error: true, 
        message: "User not authenticated"
      });
    }
    
    const userIdObj = safeObjectId(userId);
    
    if (!userIdObj) {
      return res.status(400).json({ 
        error: true, 
        message: "Invalid user ID"
      });
    }
    
    // Only allow sender or receiver to download the voice message
    if (!voiceDoc.senderId.equals(userIdObj) && !voiceDoc.receiverId.equals(userIdObj)) {
      return res.status(403).json({ 
        error: true, 
        message: "Not authorized to download this voice message"
      });
    }
    
    // Check if file exists on disk
    if (!fs.existsSync(voiceDoc.path)) {
      return res.status(404).json({ 
        error: true, 
        message: "Voice message file not found on server"
      });
    }
    
    // Set appropriate headers for download
    res.setHeader('Content-Disposition', `attachment; filename=voice-message-${voiceId}.${path.extname(voiceDoc.path).replace('.', '')}`);
    res.setHeader('Content-Type', voiceDoc.mimeType);
    
    // Stream the file to the response
    const fileStream = fs.createReadStream(voiceDoc.path);
    fileStream.pipe(res);
  } catch (error) {
    console.error("❌ Error in downloadVoiceMessage:", error.message, error.stack);
    res.status(500).json({ 
      error: true, 
      message: "Internal Server Error: " + error.message
    });
  }
};

// Delete a voice message
export const deleteVoiceMessage = async (req, res) => {
  try {
    const { messageId, voiceId } = req.body;
    
    if (!voiceId || !ObjectId.isValid(voiceId)) {
      return res.status(400).json({ 
        error: true, 
        message: "Invalid voice message ID"
      });
    }
    
    if (!messageId || !ObjectId.isValid(messageId)) {
      return res.status(400).json({ 
        error: true, 
        message: "Invalid message ID"
      });
    }
    
    const db = getDB();
    const voiceCollection = db.collection("messages");
    const messageCollection = db.collection("messages");
    
    // Find the voice message first
    const voiceDoc = await voiceCollection.findOne({ _id: new ObjectId(voiceId) });
    
    if (!voiceDoc) {
      return res.status(200).json({
        error: false,
        message: "Voice message already deleted or not found",
        alreadyDeleted: true
      });
    }
    
    // Authorization check - only sender can delete
    const senderId = req.user ? req.user._id : (req.expert ? req.expert._id : null);
    if (!senderId) {
      return res.status(401).json({ 
        error: true, 
        message: "User not authenticated"
      });
    }
    
    const senderIdObj = safeObjectId(senderId);
    
    if (!senderIdObj) {
      return res.status(400).json({ 
        error: true, 
        message: "Invalid user ID"
      });
    }
    
    if (!voiceDoc.senderId.equals(senderIdObj)) {
      return res.status(403).json({ 
        error: true, 
        message: "Not authorized to delete this voice message"
      });
    }
    
    // Find the message
    const message = await messageCollection.findOne({ 
      _id: new ObjectId(messageId),
      voiceId: new ObjectId(voiceId)
    });
    
    if (!message) {
      return res.status(200).json({
        error: false,
        message: "Message already deleted or not found",
        alreadyDeleted: true
      });
    }
    
    // Delete voice file from disk
    if (fs.existsSync(voiceDoc.path)) {
      try {
        fs.unlinkSync(voiceDoc.path);
      } catch (err) {
        console.error("Failed to delete voice file:", err.message);
        // Continue with database deletion even if file delete fails
      }
    }
    
    // Delete voice document from database
    await voiceCollection.deleteOne({ _id: new ObjectId(voiceId) });
    
    // Delete the corresponding message
    await messageCollection.deleteOne({ _id: new ObjectId(messageId) });
    
    // Notify receiver
    const receiverSocketId = getReceiverSocketId(voiceDoc.receiverId.toString());
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("messageDeleted", {
        messageID: messageId,
        senderID: senderIdObj.toString(),
        isVoice: true,
        voiceId: voiceId
      });
    }
    
    return res.status(200).json({
      error: false,
      message: "Voice message deleted successfully",
      deleted: true
    });
  } catch (error) {
    console.error("❌ Error in deleteVoiceMessage:", error.message, error.stack);
    res.status(500).json({ 
      error: true, 
      message: "Internal Server Error: " + error.message
    });
  }
};

// List all voice messages in a conversation
export const getConversationVoiceMessages = async (req, res) => {
  try {
    const { id: otherId } = req.params;
    
    // Get authenticated user ID
    const userId = req.user ? req.user._id : (req.expert ? req.expert._id : null);
    if (!userId) {
      return res.status(401).json({ 
        error: true, 
        message: "User not authenticated"
      });
    }
    
    if (!otherId) {
      return res.status(400).json({ 
        error: true, 
        message: "Other user ID is required"
      });
    }
    
    const userIdObj = safeObjectId(userId);
    const otherIdObj = safeObjectId(otherId);
    
    if (!userIdObj || !otherIdObj) {
      return res.status(400).json({ 
        error: true, 
        message: "Invalid user IDs"
      });
    }
    
    const db = getDB();
    const voiceCollection = db.collection("messages");
    
    // Find all voice messages exchanged between these two users
    const voiceMessages = await voiceCollection.find({
      $or: [
        { senderId: userIdObj, receiverId: otherIdObj },
        { senderId: otherIdObj, receiverId: userIdObj }
      ]
    }).sort({ uploadDate: -1 }).toArray();
    
    // Format the response
    const formattedVoiceMessages = voiceMessages.map(voice => ({
      id: voice._id.toString(),
      duration: voice.duration,
      mimeType: voice.mimeType,
      size: voice.size,
      uploadDate: voice.uploadDate,
      senderId: voice.senderId.toString(),
      senderIsCurrentUser: voice.senderId.equals(userIdObj)
    }));
    
    res.status(200).json({
      error: false,
      voiceMessages: formattedVoiceMessages
    });
  } catch (error) {
    console.error("❌ Error in getConversationVoiceMessages:", error.message, error.stack);
    res.status(500).json({ 
      error: true, 
      message: "Internal Server Error: " + error.message
    });
  }
};