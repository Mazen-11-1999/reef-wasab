/**
 * Site Settings Routes
 * مسارات إعدادات الموقع (اسم المتجر، الشعار، روابط التواصل، إلخ)
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const siteSettingsController = require('../controllers/siteSettingsController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const config = require('../config/env');

const router = express.Router();

// رفع الشعار — نفس إعدادات الـ upload في server.js (صور فقط)
// التحقق من بيئة Vercel
const isVercel = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';

const logoStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        // في Vercel، لا نستخدم مجلد uploads
        if (isVercel) {
            return cb(new Error('File upload not available in production'));
        }

        const uploadDir = 'uploads';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'logo-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const uploadLogo = multer({
    storage: logoStorage,
    limits: { fileSize: config.maxFileSize || 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (mimetype && extname) return cb(null, true);
        cb(new Error('فقط ملفات الصور مسموحة للشعار!'));
    }
});

// تخزين صور معرض قصتنا (حتى 6)
// التحقق من بيئة Vercel
let storyGalleryDir;
if (!isVercel) {
    storyGalleryDir = path.join(__dirname, '..', 'uploads', 'story-gallery');
    if (!fs.existsSync(storyGalleryDir)) {
        fs.mkdirSync(storyGalleryDir, { recursive: true });
    }
}
const storyGalleryStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, storyGalleryDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const uploadStoryGallery = multer({
    storage: storyGalleryStorage,
    limits: { fileSize: config.maxFileSize || 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (mimetype && extname) return cb(null, true);
        cb(new Error('فقط ملفات الصور مسموحة!'));
    }
});

// عرض عام — بدون مصادقة (للصفحة الرئيسية والزوار)
router.get('/public', siteSettingsController.getPublic);

// إدارة من لوحة التحكم — تتطلب مصادقة مشرف
router.get('/', authenticateToken, requireAdmin, siteSettingsController.get);
router.put('/', authenticateToken, requireAdmin, siteSettingsController.update);
router.post('/logo', authenticateToken, requireAdmin, uploadLogo.single('logo'), siteSettingsController.uploadLogo);
router.post('/story-gallery', authenticateToken, requireAdmin, uploadStoryGallery.array('images', 6), siteSettingsController.uploadStoryGallery);
router.post('/reset', authenticateToken, requireAdmin, siteSettingsController.reset);

module.exports = router;
