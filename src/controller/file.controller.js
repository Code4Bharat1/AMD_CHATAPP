import { getDB } from "../lib/db.js";
import { ObjectId } from "mongodb";
import { getReceiverSocketId, io } from "../lib/socket.js";
import multer from "multer";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";

// Configure storage for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), "uploads");
    
    // Create uploads directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename with original extension
    const fileExt = path.extname(file.originalname);
    const fileName = `${uuidv4()}${fileExt}`;
    cb(null, fileName);
  }
});

// File filter to validate uploads
const fileFilter = (req, file, cb) => {
  // Define allowed file types
  const allowedTypes = [
    // Images
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    // Documents
    'application/pdf', 'application/msword', 
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    // Text
    'text/plain',
    // Archives
    'application/zip', 'application/x-rar-compressed'
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only images, documents, and common files are allowed.'), false);
  }
};

// Configure multer with size limits (10MB)
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Helper to get base file upload middleware
export const uploadMiddleware = upload.single('file');

// Upload a file in a chat
export const uploadFile = async (req, res) => {
  try {
    // File should be available on req.file after multer middleware
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const { id: receiverId } = req.params;
    const senderId = req.user ? req.user._id : req.expert._id;

    if (!senderId || !receiverId) {
      // Remove uploaded file if validation fails
      if (req.file.path) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({ message: "Missing sender or receiver ID" });
    }

    const db = getDB();
    const fileCollection = db.collection("chatFiles");
    const messageCollection = db.collection("messages");

    // Create file document
    const fileDoc = {
      originalName: req.file.originalname,
      fileName: req.file.filename,
      mimeType: req.file.mimetype,
      size: req.file.size,
      path: req.file.path,
      uploadDate: new Date(),
      senderId: typeof senderId === "string" ? new ObjectId(senderId) : senderId,
      receiverId: new ObjectId(receiverId)
    };

    // Save file metadata to database
    const fileResult = await fileCollection.insertOne(fileDoc);

    // Create a corresponding message for this file
    const newMessage = {
      senderId: fileDoc.senderId,
      receiverId: fileDoc.receiverId,
      text: `File: ${req.file.originalname}`,
      fileId: fileResult.insertedId,
      isFile: true,
      fileType: req.file.mimetype,
      fileSize: req.file.size,
      createdAt: new Date()
    };

    // Save message to database
    const messageResult = await messageCollection.insertOne(newMessage);

    // Format the response
    const responseMessage = {
      _id: messageResult.insertedId,
      senderId: newMessage.senderId.toString(),
      receiverId: newMessage.receiverId.toString(),
      text: newMessage.text,
      fileId: newMessage.fileId.toString(),
      isFile: true,
      fileType: newMessage.fileType,
      fileSize: newMessage.fileSize,
      time: newMessage.createdAt
    };

    // Notify receiver via socket.io
    const receiverSocketId = getReceiverSocketId(receiverId);
    if (receiverSocketId) {
      console.log(`Sending file notification to socket: ${receiverSocketId}`);
      io.to(receiverSocketId).emit("newMessage", responseMessage);
    }

    // Send success response
    res.status(201).json({
      message: "File uploaded successfully",
      file: {
        id: fileResult.insertedId,
        name: req.file.originalname,
        type: req.file.mimetype,
        size: req.file.size
      },
      messageId: messageResult.insertedId,
      ...responseMessage
    });
  } catch (error) {
    console.error("❌ Error in uploadFile:", error.message);
    
    // Clean up file if it was uploaded but there was a database error
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({ message: "Internal Server Error" });
  }
};

// Get file info
export const getFileInfo = async (req, res) => {
  try {
    const { fileId } = req.params;
    
    if (!fileId || !ObjectId.isValid(fileId)) {
      return res.status(400).json({ message: "Invalid file ID" });
    }
    
    const db = getDB();
    const fileCollection = db.collection("chatFiles");
    
    const fileDoc = await fileCollection.findOne({ _id: new ObjectId(fileId) });
    
    if (!fileDoc) {
      return res.status(404).json({ message: "File not found" });
    }
    
    // Check authorization
    const userId = req.user ? req.user._id : req.expert._id;
    const userIdObj = typeof userId === "string" ? new ObjectId(userId) : userId;
    
    // Only allow sender or receiver to access the file
    if (!fileDoc.senderId.equals(userIdObj) && !fileDoc.receiverId.equals(userIdObj)) {
      return res.status(403).json({ message: "Not authorized to access this file" });
    }
    
    res.status(200).json({
      id: fileDoc._id,
      originalName: fileDoc.originalName,
      mimeType: fileDoc.mimeType,
      size: fileDoc.size,
      uploadDate: fileDoc.uploadDate,
      senderId: fileDoc.senderId.toString(),
      receiverId: fileDoc.receiverId.toString()
    });
  } catch (error) {
    console.error("❌ Error in getFileInfo:", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

// Download file
export const downloadFile = async (req, res) => {
  try {
    const { fileId } = req.params;
    
    if (!fileId || !ObjectId.isValid(fileId)) {
      return res.status(400).json({ message: "Invalid file ID" });
    }
    
    const db = getDB();
    const fileCollection = db.collection("chatFiles");
    
    const fileDoc = await fileCollection.findOne({ _id: new ObjectId(fileId) });
    
    if (!fileDoc) {
      return res.status(404).json({ message: "File not found" });
    }
    
    // Check authorization
    const userId = req.user ? req.user._id : req.expert._id;
    const userIdObj = typeof userId === "string" ? new ObjectId(userId) : userId;
    
    // Only allow sender or receiver to download the file
    if (!fileDoc.senderId.equals(userIdObj) && !fileDoc.receiverId.equals(userIdObj)) {
      return res.status(403).json({ message: "Not authorized to download this file" });
    }
    
    // Check if file exists on disk
    if (!fs.existsSync(fileDoc.path)) {
      return res.status(404).json({ message: "File not found on server" });
    }
    
    // Set appropriate headers for download
    res.setHeader('Content-Disposition', `attachment; filename=${encodeURIComponent(fileDoc.originalName)}`);
    res.setHeader('Content-Type', fileDoc.mimeType);
    
    // Stream the file to the response
    const fileStream = fs.createReadStream(fileDoc.path);
    fileStream.pipe(res);
  } catch (error) {
    console.error("❌ Error in downloadFile:", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

// Delete a file
export const deleteFile = async (req, res) => {
  try {
    const { messageId, fileId } = req.body;
    
    if (!fileId || !ObjectId.isValid(fileId) || !messageId || !ObjectId.isValid(messageId)) {
      return res.status(400).json({ message: "Invalid message or file ID" });
    }
    
    const db = getDB();
    const fileCollection = db.collection("chatFiles");
    const messageCollection = db.collection("messages");
    
    // Find the file first
    const fileDoc = await fileCollection.findOne({ _id: new ObjectId(fileId) });
    
    if (!fileDoc) {
      return res.status(200).json({
        message: "File already deleted or not found",
        alreadyDeleted: true
      });
    }
    
    // Authorization check - only sender can delete
    const senderId = req.user ? req.user._id : req.expert._id;
    const senderIdObj = typeof senderId === "string" ? new ObjectId(senderId) : senderId;
    
    if (!fileDoc.senderId.equals(senderIdObj)) {
      return res.status(403).json({ message: "Not authorized to delete this file" });
    }
    
    // Find the message
    const message = await messageCollection.findOne({ 
      _id: new ObjectId(messageId),
      fileId: new ObjectId(fileId)
    });
    
    if (!message) {
      return res.status(200).json({
        message: "Message already deleted or not found",
        alreadyDeleted: true
      });
    }
    
    // Delete file from disk
    if (fs.existsSync(fileDoc.path)) {
      fs.unlinkSync(fileDoc.path);
    }
    
    // Delete file document from database
    await fileCollection.deleteOne({ _id: new ObjectId(fileId) });
    
    // Delete the corresponding message
    await messageCollection.deleteOne({ _id: new ObjectId(messageId) });
    
    // Notify receiver
    const receiverSocketId = getReceiverSocketId(fileDoc.receiverId.toString());
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("messageDeleted", {
        messageID: messageId,
        senderID: senderIdObj.toString(),
        isFile: true,
        fileId: fileId
      });
    }
    
    return res.status(200).json({
      message: "File deleted successfully",
      deleted: true
    });
  } catch (error) {
    console.error("❌ Error in deleteFile:", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

// List all files in a conversation
export const getConversationFiles = async (req, res) => {
  try {
    const { id: otherId } = req.params;
    const userId = req.user ? req.user._id : req.expert._id;
    
    if (!userId || !otherId) {
      return res.status(400).json({ message: "Missing user IDs" });
    }
    
    const userIdObj = typeof userId === "string" ? new ObjectId(userId) : userId;
    const otherIdObj = new ObjectId(otherId);
    
    const db = getDB();
    const fileCollection = db.collection("chatFiles");
    
    // Find all files exchanged between these two users
    const files = await fileCollection.find({
      $or: [
        { senderId: userIdObj, receiverId: otherIdObj },
        { senderId: otherIdObj, receiverId: userIdObj }
      ]
    }).sort({ uploadDate: -1 }).toArray();
    
    // Format the response
    const formattedFiles = files.map(file => ({
      id: file._id.toString(),
      originalName: file.originalName,
      mimeType: file.mimeType,
      size: file.size,
      uploadDate: file.uploadDate,
      senderId: file.senderId.toString(),
      senderIsCurrentUser: file.senderId.equals(userIdObj)
    }));
    
    res.status(200).json(formattedFiles);
  } catch (error) {
    console.error("❌ Error in getConversationFiles:", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
};