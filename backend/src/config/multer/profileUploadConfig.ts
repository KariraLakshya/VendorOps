import multer from "multer";

/**
 * Multer config for candidate profile uploads. The spec restricts vendor
 * profile uploads to PDF and PPTX only (unlike the general-purpose
 * attachment uploader).
 */
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
] as const;

const FILE_SIZE_LIMIT = 25 * 1024 * 1024; // 25MB per profile document
const MAX_FILES_PER_REQUEST = 20;

const fileFilter: multer.Options["fileFilter"] = (_req, file, cb) => {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype as any)) {
    cb(null, true);
  } else {
    cb(new Error("Invalid file type. Only PDF and PPTX profiles are allowed."));
  }
};

export const profileUploadConfig = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: FILE_SIZE_LIMIT, files: MAX_FILES_PER_REQUEST },
  fileFilter,
});
