/**
 * Story Routes
 * Routes لإدارة الحالات والإعلانات
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const storyController = require('../controllers/storyController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { validate, sanitize } = require('../middleware/validation');
const validators = require('../middleware/validators/storyValidator');
const config = require('../config/env');

const router = express.Router();

// مجلد رفع وسائط الحالات/الإعلانات (صورة أو فيديو من المعرض)
// التحقق من بيئة Vercel
const isVercel = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';

// في Vercel، لا نستخدم مجلد uploads
let storyMediaDir;
if (!isVercel) {
    storyMediaDir = path.join(__dirname, '..', 'uploads', 'stories');
    if (!fs.existsSync(storyMediaDir)) {
        fs.mkdirSync(storyMediaDir, { recursive: true });
    }
}
const storyMediaStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, storyMediaDir),
    filename: (req, file, cb) => {
        const ext = (path.extname(file.originalname) || '').toLowerCase() || '.jpg';
        const safe = /^[a-z0-9.]+$/i.test(ext) ? ext : '.jpg';
        cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + safe);
    }
});
const uploadStoryMedia = multer({
    storage: storyMediaStorage,
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = /^image\/(jpeg|jpg|png|gif|webp)|video\/(mp4|webm|quicktime)$/i;
        if (allowed.test(file.mimetype)) return cb(null, true);
        cb(new Error('فقط صور (JPG, PNG, WebP) أو فيديو (MP4, WebM) مسموحة'));
    }
});

// Public routes
router.get('/stories', storyController.getStories);
router.get('/ads', storyController.getAds);
router.get('/:id', storyController.getStory);

// Protected routes (require authentication)
router.use(authenticateToken);

// Interaction routes
router.post('/:id/like', storyController.likeStory);
router.delete('/:id/like', storyController.unlikeStory);
router.post('/:id/comment', sanitize, validators.addComment, validate, storyController.addComment);
router.delete('/:id/comment/:commentId', storyController.deleteComment);

// Admin routes
router.get('/admin/all', requireAdmin, storyController.getAllStories);
router.post('/admin/upload', requireAdmin, uploadStoryMedia.single('media'), storyController.uploadStoryMedia);
router.post('/admin/create', requireAdmin, sanitize, validators.createStory, validate, storyController.createStory);
router.put('/admin/:id', requireAdmin, sanitize, validators.updateStory, validate, storyController.updateStory);
router.delete('/admin/:id', requireAdmin, storyController.deleteStory);

module.exports = router;

