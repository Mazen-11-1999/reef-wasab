/**
 * Customer Routes
 * Routes لإدارة العملاء
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const customerController = require('../controllers/customerController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// رفع صورة الملف الشخصي (avatars)
// التحقق من بيئة Vercel
const isVercel = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';

// في Vercel، لا نستخدم مجلد uploads
let avatarDir;
if (!isVercel) {
    avatarDir = path.join(process.cwd(), 'uploads', 'avatars');
    if (!fs.existsSync(avatarDir)) fs.mkdirSync(avatarDir, { recursive: true });
}
const avatarStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, avatarDir),
    filename: (req, file, cb) => {
        const ext = (path.extname(file.originalname) || '').toLowerCase() || '.jpg';
        const safe = /^\.(jpe?g|png|gif|webp)$/.test(ext) ? ext : '.jpg';
        cb(null, 'avatar-' + Date.now() + '-' + Math.round(Math.random() * 1e9) + safe);
    }
});
const uploadAvatar = multer({
    storage: avatarStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ok = /image\/(jpeg|jpg|png|gif|webp)/.test(file.mimetype);
        cb(null, ok);
    }
});

// Protected routes (require authentication)
router.use(authenticateToken);

// Customer profile routes
router.get('/profile', customerController.getProfile);
router.put('/profile', customerController.updateProfile);
router.post('/profile/avatar', uploadAvatar.single('avatar'), customerController.uploadAvatar);
router.get('/wishlist', customerController.getWishlist);
router.post('/wishlist', customerController.addToWishlist);
router.delete('/wishlist/:productId', customerController.removeFromWishlist);
router.get('/stats', customerController.getStats);

// Admin routes
router.get('/all', requireAdmin, customerController.getAllCustomers);
router.put('/:customerId/vip', requireAdmin, customerController.updateVipStatus);
router.put('/:customerId/badge', requireAdmin, customerController.updateBadge);

module.exports = router;












