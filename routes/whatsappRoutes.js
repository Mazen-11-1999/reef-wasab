/**
 * WhatsApp Routes
 * Routes لإدارة خدمة WhatsApp
 */

const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../middleware/validation');
const whatsappService = require('../services/whatsappService');

const router = express.Router();

/**
 * تهيئة WhatsApp (للمشرف فقط)
 */
router.post('/initialize', 
    authenticateToken,
    requireAdmin,
    async (req, res, next) => {
        try {
            const result = await whatsappService.initWhatsAppService();
            
            if (result) {
                res.json({
                    success: true,
                    message: 'WhatsApp service initialized successfully'
                });
            } else {
                res.status(400).json({
                    success: false,
                    message: 'Failed to initialize WhatsApp service'
                });
            }
        } catch (error) {
            next(error);
        }
    }
);

/**
 * إرسال رسالة WhatsApp (للمشرف فقط)
 */
router.post('/send-message',
    authenticateToken,
    requireAdmin,
    [
        body('phoneNumber')
            .trim()
            .notEmpty()
            .withMessage('رقم الهاتف مطلوب'),
        body('message')
            .trim()
            .notEmpty()
            .withMessage('الرسالة مطلوبة')
            .isLength({ min: 1, max: 1000 })
            .withMessage('الرسالة يجب أن تكون بين 1 و 1000 حرف')
    ],
    validate,
    async (req, res, next) => {
        try {
            const { phoneNumber, message } = req.body;
            
            const result = await whatsappService.sendWhatsAppMessage(phoneNumber, message);
            
            if (result.success) {
                res.json({
                    success: true,
                    message: 'Message sent successfully'
                });
            } else {
                res.status(400).json({
                    success: false,
                    message: result.message || 'Failed to send message',
                    error: result.error
                });
            }
        } catch (error) {
            next(error);
        }
    }
);

/**
 * التحقق من حالة WhatsApp
 */
router.get('/status',
    authenticateToken,
    requireAdmin,
    async (req, res, next) => {
        try {
            const isReady = whatsappService.isReady();
            
            res.json({
                success: true,
                status: isReady ? 'ready' : 'not_ready',
                message: isReady ? 'WhatsApp is ready to send messages' : 'WhatsApp is not ready'
            });
        } catch (error) {
            next(error);
        }
    }
);

/**
 * إرسال رسالة اختبار
 */
router.post('/test-message',
    authenticateToken,
    requireAdmin,
    async (req, res, next) => {
        try {
            const testMessage = `🍯 *رسالة اختبار من مناحل ريف وصاب* 🍯

هذه رسالة اختبار للتأكد من أن WhatsApp يعمل بشكل صحيح.

الوقت: ${new Date().toLocaleString('ar-SA')}
النظام: Vercel Deployment

✅ كل شيء يعمل بشكل ممتاز!`;

            const result = await whatsappService.sendWhatsAppMessage('967777123456', testMessage);
            
            if (result.success) {
                res.json({
                    success: true,
                    message: 'Test message sent successfully'
                });
            } else {
                res.status(400).json({
                    success: false,
                    message: result.message || 'Failed to send test message',
                    error: result.error
                });
            }
        } catch (error) {
            next(error);
        }
    }
);

module.exports = router;
