/**
 * Order Routes
 * Routes لإدارة الطلبات
 */

const express = require('express');
const orderController = require('../controllers/orderController');
const preOrderController = require('../controllers/preOrderController');
const { authenticateToken, authenticateTokenOptional, requireAdmin } = require('../middleware/auth');
const { body, param, query } = require('express-validator');
const { validate } = require('../middleware/validation');
const validators = require('../middleware/validators');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const config = require('../config/env');

const router = express.Router();

// File upload for shipping receipt
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // التحقق من بيئة Vercel
        const isVercel = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';

        // في Vercel، لا نستخدم مجلد uploads
        if (isVercel) {
            return cb(new Error('File upload not available in production'));
        }

        const uploadDir = 'uploads/receipts';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'receipt-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const uploadReceipt = multer({
    storage: storage,
    limits: { fileSize: config.maxFileSize },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);

        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('فقط ملفات الصور مسموحة!'));
        }
    }
});

// Validation
const updateStatusValidation = [
    param('id').isMongoId().withMessage('معرف الطلب غير صحيح'),
    body('status')
        .notEmpty()
        .withMessage('الحالة مطلوبة')
        .isIn(['pending', 'processing', 'paid', 'ready_to_ship', 'shipped', 'delivered', 'completed', 'cancelled'])
        .withMessage('الحالة غير صحيحة')
];

// Public routes (optional auth لربط الطلب بالمستخدم إذا كان مسجلاً)
router.post('/',
    authenticateTokenOptional,
    validators.order.createOrder,
    validate,
    orderController.createOrder
);

// الطلبات المسبقة (Public)
router.post('/preorder',
    validators.order.createOrder,
    body('harvestSeason').optional().isString().trim(),
    body('expectedDeliveryDate').optional().isISO8601().withMessage('تاريخ التوصيل المتوقع غير صحيح'),
    validate,
    preOrderController.createPreOrder
);

router.get('/track/:orderId',
    param('orderId').notEmpty().withMessage('رقم الطلب مطلوب'),
    validate,
    orderController.getOrderByOrderId
);

// Protected routes (require authentication)
router.use(authenticateToken);

router.get('/',
    validators.order.getOrders,
    validate,
    orderController.getOrders
);

router.get('/:id',
    param('id').isMongoId().withMessage('معرف الطلب غير صحيح'),
    validate,
    orderController.getOrder
);

router.put('/:id',
    requireAdmin,
    param('id').isMongoId().withMessage('معرف الطلب غير صحيح'),
    validate,
    orderController.updateOrder
);

router.put('/:id/status',
    requireAdmin,
    updateStatusValidation,
    validate,
    orderController.updateOrderStatus
);

router.post('/:id/shipping-receipt',
    requireAdmin,
    param('id').isMongoId().withMessage('معرف الطلب غير صحيح'),
    uploadReceipt.single('receipt'),
    orderController.uploadShippingReceipt
);

router.post('/:id/payment',
    requireAdmin,
    param('id').isMongoId().withMessage('معرف الطلب غير صحيح'),
    body('amount').isFloat({ min: 0 }).withMessage('المبلغ يجب أن يكون رقم موجب'),
    body('method').optional().isIn(['cash', 'bank_transfer', 'card', 'other']).withMessage('طريقة الدفع غير صحيحة'),
    body('notes').optional().isString().trim(),
    validate,
    orderController.addPayment
);

// الطلبات المسبقة (Protected)
router.get('/preorders',
    authenticateToken,
    query('harvestSeason').optional().isString().trim(),
    query('isHarvested').optional().isBoolean(),
    validate,
    preOrderController.getPreOrders
);

router.put('/preorders/:id/harvested',
    requireAdmin,
    param('id').isMongoId().withMessage('معرف الطلب غير صحيح'),
    validate,
    preOrderController.markAsHarvested
);

// التوصيل الجماعي (Protected)
router.post('/group-delivery',
    requireAdmin,
    body('country').notEmpty().withMessage('الدولة مطلوبة'),
    body('region').notEmpty().withMessage('المنطقة مطلوبة'),
    body('deliveryDate').isISO8601().withMessage('تاريخ التوصيل غير صحيح'),
    body('route.from').optional().isString().trim(),
    body('route.to').optional().isString().trim(),
    body('orderIds').optional().isArray(),
    validate,
    preOrderController.createGroupDelivery
);

router.get('/group-delivery',
    authenticateToken,
    query('country').optional().isString().trim(),
    query('region').optional().isString().trim(),
    query('status').optional().isIn(['pending', 'scheduled', 'in_transit', 'delivered', 'cancelled']),
    validate,
    preOrderController.getGroupDeliveriesByRegion
);

router.get('/group-delivery/:id',
    authenticateToken,
    param('id').isMongoId().withMessage('معرف التوصيل الجماعي غير صحيح'),
    validate,
    preOrderController.getGroupDelivery
);

router.put('/group-delivery/:id/status',
    requireAdmin,
    param('id').isMongoId().withMessage('معرف التوصيل الجماعي غير صحيح'),
    body('status').isIn(['pending', 'scheduled', 'in_transit', 'delivered', 'cancelled']).withMessage('الحالة غير صحيحة'),
    body('notes').optional().isString().trim(),
    validate,
    preOrderController.updateGroupDeliveryStatus
);

router.post('/group-delivery/:id/orders',
    requireAdmin,
    param('id').isMongoId().withMessage('معرف التوصيل الجماعي غير صحيح'),
    body('orderId').isMongoId().withMessage('معرف الطلب غير صحيح'),
    validate,
    preOrderController.addOrderToGroup
);

router.delete('/group-delivery/:id/orders',
    requireAdmin,
    param('id').isMongoId().withMessage('معرف التوصيل الجماعي غير صحيح'),
    body('orderId').isMongoId().withMessage('معرف الطلب غير صحيح'),
    validate,
    preOrderController.removeOrderFromGroup
);

module.exports = router;

