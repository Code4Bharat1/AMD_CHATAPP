import { getDB } from "../lib/db.js";
import { ObjectId } from "mongodb";
import { getReceiverSocketId, io } from "../lib/socket.js";
import multer from "multer";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import mime from "mime-types";
import { fileURLToPath } from "url";

// Derive __dirname equivalent for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create dedicated upload directory for expert chat
const uploadDir = path.join(__dirname, "../Uploads/expertChat");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure storage for expert file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(process.cwd(), "Uploads", "expertChat");

    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }

    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    // Generate unique filename with timestamp and UUID
    const fileExt = path.extname(file.originalname);
    const fileName = `expert_${Date.now()}_${uuidv4()}${fileExt}`;
    cb(null, fileName);
  },
});

// Enhanced file filter for expert communications
const fileFilter = (req, file, cb) => {
  // Define allowed file types for expert communications
  const allowedTypes = [
    // Images
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/bmp",
    // Documents
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    // Text files
    "text/plain",
    "text/csv",
    // Archives
    "application/zip",
    "application/x-rar-compressed",
    "application/x-7z-compressed",
    // Audio/Video (for expert presentations)
    "audio/mpeg",
    "audio/wav",
    "video/mp4",
    "video/avi",
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        `Invalid file type: ${file.mimetype}. Only images, documents, audio, video and common files are allowed for expert communications.`
      ),
      false
    );
  }
};

// Configure multer with enhanced limits for expert files (25MB)
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB limit for expert files
    files: 1, // Only one file per upload
  },
});

// Export upload middleware
export const uploadMiddleware = upload.single("file");

// Upload file for expert-to-expert chat with real-time updates
export const uploadFileExpert = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }
    const { id: receiverId } = req.params;
    const senderId = req.expert ? req.expert._id : null;
    if (!senderId || !receiverId) {
      // Remove uploaded file if validation fails
      if (req.file.path) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({ message: "Missing sender or receiver ID" });
    }
    const db = getDB();
    const messageCollection = db.collection("expertMessages");
    // Create file document
    const fileDoc = {
      originalName: req.file.originalname,
      fileName: req.file.filename,
      mimeType: req.file.mimetype,
      size: req.file.size,
      path: req.file.path,
      uploadDate: new Date(),
      senderId:
        typeof senderId === "string" ? new ObjectId(senderId) : senderId,
      receiverId: new ObjectId(receiverId),
    };
    // Save file metadata to database
    const fileResult = await messageCollection.insertOne(fileDoc);

    // Create a corresponding message for this file
    const newMessage = {
      senderId: fileDoc.senderId,
      receiverId: fileDoc.receiverId,
      text: `File: ${req.file.originalname}`,
      fileId: fileResult.insertedId,
      isFile: true,
      fileType: req.file.mimetype,
      fileSize: req.file.size,
      createdAt: new Date(),
    };

    // Format the response
    const responseMessage = {
      _id: fileResult.insertedId,
      senderId: newMessage.senderId.toString(),
      receiverId: newMessage.receiverId.toString(),
      text: `File: ${req.file.originalname}`,
      fileId: newMessage.fileId.toString(),
      isFile: true,
      fileType: newMessage.fileType,
      fileSize: newMessage.fileSize,
      time: newMessage.createdAt,
    };

    // Notify both experts via socket.io using the conversation room
    const roomId = [senderId.toString(), receiverId.toString()].sort().join('-');
    console.log(`Emitting newExpertMessage to room: ${roomId}`);
    io.to(roomId).emit("newExpertMessage", responseMessage);

    // Send success response
    res.status(201).json({
      message: "File uploaded successfully",
      file: {
        id: fileResult.insertedId,
        name: req.file.originalname,
        type: req.file.mimetype,
        size: req.file.size,
      },
      messageId: fileResult.insertedId,
      ...responseMessage,
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

// Download file for expert-to-expert chat with real-time tracking
export const downloadFileExpert = async (req, res) => {
  try {
    const { fileId } = req.params;

    console.log("🔽 Starting expert file download...");
    console.log("File ID:", fileId);
    console.log("Requesting expert:", req.expert);

    // Validate file ID
    if (!fileId || !ObjectId.isValid(fileId)) {
      console.log("❌ Invalid file ID");
      return res.status(400).json({
        message: "Invalid file ID",
        success: false,
      });
    }

    const db = getDB();
    const messageCollection = db.collection("expertMessages");
    const expertCollection = db.collection("expert");

    console.log("🔍 Searching for file in expertMessages collection...");

    // Find file document
    const fileDoc = await messageCollection.findOne({
      _id: new ObjectId(fileId),
    });

    if (!fileDoc) {
      console.log("❌ File not found in database");
      return res.status(404).json({
        message: "File not found or has been deleted",
        success: false,
      });
    }

    console.log("✅ File found:", {
      originalName: fileDoc.originalName,
      mimeType: fileDoc.mimeType,
      size: fileDoc.size,
      senderId: fileDoc.senderId,
      receiverId: fileDoc.receiverId,
    });

    // Validate expert authorization
    const expertId = req.expert ? req.expert._id : null;

    if (!expertId) {
      console.log("❌ No expert ID found in request");
      return res.status(401).json({
        message: "Expert authentication required",
        success: false,
      });
    }

    const expertIdObj =
      typeof expertId === "string" ? new ObjectId(expertId) : expertId;

    console.log("🔐 Checking authorization...");
    console.log("Requesting expert ID:", expertIdObj);
    console.log("File sender ID:", fileDoc.senderId);
    console.log("File receiver ID:", fileDoc.receiverId);

    if (
      !fileDoc.senderId.equals(expertIdObj) &&
      !fileDoc.receiverId.equals(expertIdObj)
    ) {
      console.log("❌ Not authorized to download this file");
      return res.status(403).json({
        message: "Not authorized to download this file",
        success: false,
      });
    }

    // Additional validation: Ensure both participants are still active experts
    const [senderExpert, receiverExpert] = await Promise.all([
      expertCollection.findOne({ _id: fileDoc.senderId }),
      expertCollection.findOne({ _id: fileDoc.receiverId }),
    ]);

    if (!senderExpert || !receiverExpert) {
      console.log("❌ Invalid expert conversation or inactive expert");
      return res.status(403).json({
        message: "Invalid expert conversation or expert account inactive",
        success: false,
      });
    }

    // Check if file exists on disk
    if (!fileDoc.path) {
      console.log("❌ File path not found in database");
      return res.status(404).json({
        message: "File path not found",
        success: false,
      });
    }

    if (!fs.existsSync(fileDoc.path)) {
      console.log("❌ File not found on server at path:", fileDoc.path);
      return res.status(404).json({
        message: "File not found on server",
        success: false,
      });
    }

    console.log("✅ File exists on disk, preparing download...");

    // Determine MIME type
    const mimeType =
      fileDoc.mimeType ||
      mime.lookup(fileDoc.originalName) ||
      "application/octet-stream";
    console.log("🔍 Determined MIME type:", mimeType);

    // Ensure filename has correct extension
    const fileExtension = mime.extension(mimeType) || "";
    const safeFileName = fileDoc.originalName.includes(".")
      ? fileDoc.originalName
      : `${fileDoc.originalName}.${fileExtension}`;

    // Get file stats
    const fileStats = fs.statSync(fileDoc.path);

    // Set headers
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(safeFileName)}"`
    );
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Length", fileStats.size);
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Chat-Type", "expert-to-expert");
    res.setHeader("X-File-Source", "expert-messages");

    console.log("📤 Streaming file to client...");

    // Stream the file
    const fileStream = fs.createReadStream(fileDoc.path);

    fileStream.on("error", (streamError) => {
      console.error("❌ File stream error:", streamError);
      if (!res.headersSent) {
        res.status(500).json({ message: "Error reading file" });
      }
    });

    fileStream.on("end", () => {
      console.log("✅ File download completed successfully");
    });

    fileStream.pipe(res);
  } catch (error) {
    console.error("❌ Error in downloadFileExpert:", error);
    console.error("Error stack:", error.stack);

    if (!res.headersSent) {
      res.status(500).json({
        message: "Failed to download file",
        success: false,
        error:
          process.env.NODE_ENV === "development"
            ? error.message
            : "Internal server error",
      });
    }
  }
};

// Delete file for expert-to-expert chat with real-time updates
export const deleteFileExpert = async (req, res) => {
  try {
    const { fileId } = req.params;
    const deleteType = req.body.deleteType || "soft"; // "soft" or "hard"

    console.log("🗑️ Starting expert file deletion...");
    console.log("File ID:", fileId);
    console.log("Delete type:", deleteType);
    console.log("Requesting expert:", req.expert);

    // Validate file ID
    if (!fileId || !ObjectId.isValid(fileId)) {
      console.log("❌ Invalid file ID");
      return res.status(400).json({
        message: "Invalid file ID",
        success: false,
      });
    }

    const db = getDB();
    const messageCollection = db.collection("expertMessages");
    const expertCollection = db.collection("experts");

    // Find the file/message
    const fileDoc = await messageCollection.findOne({
      _id: new ObjectId(fileId),
      isFile: true,
    });

    if (!fileDoc) {
      console.log("❌ File not found");
      return res.status(404).json({
        message: "File not found",
        success: false,
      });
    }

    // Authorization check - only sender can delete
    const expertId = req.expert ? req.expert._id : null;

    if (!expertId) {
      console.log("❌ No expert ID found in request");
      return res.status(401).json({
        message: "Expert authentication required",
        success: false,
      });
    }

    const expertIdObj =
      typeof expertId === "string" ? new ObjectId(expertId) : expertId;

    // Only sender can delete the file
    if (!fileDoc.senderId.equals(expertIdObj)) {
      console.log("❌ Not authorized to delete this file");
      return res.status(403).json({
        message: "Only the sender can delete this file",
        success: false,
      });
    }

    // Validate expert is still active
    const senderExpert = await expertCollection.findOne({
      _id: expertIdObj,
      status: "active",
    });

    if (!senderExpert) {
      console.log("❌ Expert not found or inactive");
      return res.status(403).json({
        message: "Expert account not found or inactive",
        success: false,
      });
    }

    let deletionResult;
    const now = new Date();

    if (deleteType === "hard") {
      // Hard delete: Remove from database and file system
      console.log("🔥 Performing hard delete...");

      // Delete file from disk first
      if (fileDoc.path && fs.existsSync(fileDoc.path)) {
        try {
          fs.unlinkSync(fileDoc.path);
          console.log("✅ File removed from disk");
        } catch (fsError) {
          console.warn("⚠️ Failed to remove file from disk:", fsError);
          // Continue with database deletion even if file removal fails
        }
      }

      // Remove from database
      deletionResult = await messageCollection.deleteOne({
        _id: new ObjectId(fileId),
      });
    } else {
      // Soft delete: Mark as deleted but keep in database
      console.log("🔄 Performing soft delete...");

      deletionResult = await messageCollection.updateOne(
        { _id: new ObjectId(fileId) },
        {
          $set: {
            status: "deleted",
            deletedAt: now,
            deletedBy: expertIdObj,
          },
        }
      );
    }

    if (
      deletionResult.deletedCount === 0 &&
      deletionResult.modifiedCount === 0
    ) {
      console.log("❌ Failed to delete file");
      return res.status(500).json({
        message: "Failed to delete file",
        success: false,
      });
    }

    console.log("✅ File deleted successfully");

    // Prepare real-time notification data
    const notificationData = {
      messageId: fileId,
      fileId: fileId,
      fileName: fileDoc.originalName,
      deletedBy: {
        _id: senderExpert._id.toString(),
        name: senderExpert.name,
        specialization: senderExpert.specialization,
      },
      deletedAt: now,
      deleteType: deleteType,
      chatType: "expert-to-expert",
    };

    // Real-time notification to both experts using the conversation room
    const roomId = [expertIdObj.toString(), fileDoc.receiverId.toString()].sort().join('-');
    console.log(`Emitting expertFileDeleted and expertMessageDeleted to room: ${roomId}`);
    io.to(roomId).emit("expertFileDeleted", notificationData);
    io.to(roomId).emit("expertMessageDeleted", {
      messageId: fileId,
      senderId: expertIdObj.toString(),
      receiverId: fileDoc.receiverId.toString(),
      isFile: true,
      deleteType: deleteType,
    });

    // Confirmation to sender
    const senderSocketId = getReceiverSocketId(expertIdObj.toString());
    if (senderSocketId) {
      io.to(senderSocketId).emit("expertFileDeleteConfirmation", {
        messageId: fileId,
        status: "deleted",
        deleteType: deleteType,
        timestamp: now,
      });
    }

    // Log deletion activity for audit
    try {
      const deletionLog = {
        fileId: new ObjectId(fileId),
        originalFileName: fileDoc.originalName,
        deletedBy: expertIdObj,
        receiverId: fileDoc.receiverId,
        deletedAt: now,
        deleteType: deleteType,
        fileSize: fileDoc.size,
        ipAddress: req.ip || req.connection.remoteAddress,
      };

      const deletionCollection = db.collection("expertFileDeletions");
      await deletionCollection.insertOne(deletionLog);
    } catch (logError) {
      console.warn("⚠️ Failed to log deletion activity:", logError);
      // Don't fail the deletion if logging fails
    }

    // Send success response
    res.status(200).json({
      message: `File ${
        deleteType === "hard" ? "permanently deleted" : "deleted"
      } successfully`,
      success: true,
      data: {
        messageId: fileId,
        fileName: fileDoc.originalName,
        deleteType: deleteType,
        deletedAt: now,
      },
    });
  } catch (error) {
    console.error("❌ Error in deleteFileExpert:", error);
    console.error("Error stack:", error.stack);

    res.status(500).json({
      message: "Failed to delete file",
      success: false,
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : "Internal server error",
    });
  }
};

export const getExpertFileInfo = async (req, res) => {
  try {
    const { fileId } = req.params;

    // Validate fileId parameter
    if (!fileId) {
      console.error("❌ Missing fileId parameter");
      return res.status(400).json({
        message: "File ID is required",
        error: "MISSING_FILE_ID",
      });
    }

    if (!ObjectId.isValid(fileId)) {
      console.error("❌ Invalid fileId format:", fileId);
      return res.status(400).json({
        message: "Invalid file ID format",
        error: "INVALID_FILE_ID_FORMAT",
      });
    }

    const db = getDB();

    // Use expert_messages collection for expert-to-expert chat
    const expertMessagesCollection = db.collection("expertMessages");

    console.log("🔍 Searching for file with ID:", fileId);

    const fileDoc = await expertMessagesCollection.findOne({
      _id: new ObjectId(fileId),
    });

    if (!fileDoc) {
      console.error("❌ File not found in expert_messages collection:", fileId);
      return res.status(404).json({
        message: "File not found",
        error: "FILE_NOT_FOUND",
      });
    }

    console.log("✅ File found:", {
      id: fileDoc._id,
      senderId: fileDoc.senderId,
      receiverId: fileDoc.receiverId,
      originalName: fileDoc.originalName,
    });

    // Get current expert ID and ensure it's an ObjectId
    const currentExpertId = req.expert._id;
    const currentExpertIdObj =
      typeof currentExpertId === "string"
        ? new ObjectId(currentExpertId)
        : currentExpertId;

    console.log("🔐 Authorization check:", {
      currentExpertId: currentExpertIdObj.toString(),
      fileSenderId: fileDoc.senderId?.toString(),
      fileReceiverId: fileDoc.receiverId?.toString(),
    });

    // Authorization: Only sender or receiver expert can access the file
    const isSender =
      fileDoc.senderId && fileDoc.senderId.equals(currentExpertIdObj);
    const isReceiver =
      fileDoc.receiverId && fileDoc.receiverId.equals(currentExpertIdObj);

    if (!isSender && !isReceiver) {
      console.error("❌ Expert not authorized to access file:", {
        expertId: currentExpertIdObj.toString(),
        senderId: fileDoc.senderId?.toString(),
        receiverId: fileDoc.receiverId?.toString(),
      });
      return res.status(403).json({
        message: "Not authorized to access this file",
        error: "ACCESS_FORBIDDEN",
      });
    }

    console.log("✅ Expert authorized to access file");

    // Prepare response with comprehensive file information
    const fileInfo = {
      id: fileDoc._id,
      originalName: fileDoc.originalName,
      mimeType: fileDoc.mimeType,
      size: fileDoc.size,
      uploadDate: fileDoc.uploadDate,
      senderId: fileDoc.senderId.toString(),
      receiverId: fileDoc.receiverId.toString(),
    };

    console.log("✅ Returning file info successfully");

    res.status(200).json({
      success: true,
      data: fileInfo,
      message: "File information retrieved successfully",
    });
  } catch (error) {
    console.error("❌ Error in getExpertFileInfo:", {
      message: error.message,
      stack: error.stack,
      fileId: req.params?.fileId,
      expertId: req.expert?._id?.toString(),
    });

    // Determine error type for better debugging
    let errorMessage = "Internal Server Error";
    let errorCode = "INTERNAL_ERROR";

    if (error.name === "BSONTypeError" || error.name === "BSONError") {
      errorMessage = "Database operation failed";
      errorCode = "DATABASE_ERROR";
    } else if (
      error.name === "MongoError" ||
      error.name === "MongoServerError"
    ) {
      errorMessage = "Database connection error";
      errorCode = "DATABASE_CONNECTION_ERROR";
    }

    res.status(500).json({
      message: errorMessage,
      error: errorCode,
      ...(process.env.NODE_ENV === "development" && {
        details: error.message,
      }),
    });
  }
};