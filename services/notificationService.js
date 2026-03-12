/**
 * Notification Service
 * خدمة الإشعارات الشاملة (In-App + Email + WhatsApp)
 */

const Notification = require('../models/Notification');
const emailService = require('./emailService');
const whatsappService = require('./whatsappService');
const logger = require('../utils/logger');

/**
 * إرسال إشعار شامل (In-App + Email + WhatsApp)
 */
const sendNotification = async (userId, customerId, orderId, type, title, message, data = {}) => {
    try {
        // 1. إنشاء إشعار داخل التطبيق
        const notification = await Notification.createNotification(
            userId,
            type,
            title,
            message,
            { ...data, customer: customerId, order: orderId }
        );

        // 2. إرسال Email (إذا كان متوفر)
        if (data.customerEmail) {
            try {
                await emailService.sendEmail(
                    data.customerEmail,
                    title,
                    message
                );
            } catch (error) {
                logger.warn('Failed to send email notification:', error.message);
            }
        }

        // 3. إرسال WhatsApp (إذا كان متوفر)
        if (data.customerPhone && whatsappService.isReady()) {
            try {
                await whatsappService.sendWhatsAppMessage(
                    data.customerPhone,
                    `${title}\n\n${message}`
                );
            } catch (error) {
                logger.warn('Failed to send WhatsApp notification:', error.message);
            }
        }

        return {
            success: true,
            notification: notification
        };
    } catch (error) {
        logger.error('Failed to send notification:', error);
        return {
            success: false,
            error: error.message
        };
    }
};

/**
 * إشعار تأكيد الطلب
 */
const notifyOrderCreated = async (order, customer, user) => {
    const title = `طلب جديد #${order.orderId}`;
    const message = `تم استلام طلبك بنجاح. سيتم معالجته قريباً.`;

    // إشعار للمشرف
    await Notification.createNotification(
        user._id,
        'order_created',
        title,
        `طلب جديد من ${customer.name} - ${order.orderId}`,
        { order: order._id, customer: customer._id }
    );

    // إشعار للعميل (إذا كان لديه حساب)
    if (customer.user) {
        await sendNotification(
            customer.user,
            customer._id,
            order._id,
            'order_created',
            title,
            message,
            {
                customerEmail: customer.email,
                customerPhone: customer.phone
            }
        );
    }

    // إرسال Email و WhatsApp للعميل
    if (customer.email) {
        await emailService.sendOrderConfirmation(order, customer);
    }

    if (customer.phone && whatsappService.isReady()) {
        await whatsappService.sendOrderConfirmationWhatsApp(order, customer);
    }
};

/**
 * إشعار تحديث حالة الطلب
 */
const notifyOrderStatusChanged = async (order, customer, user, newStatus) => {
    const statusMessages = {
        'processing': 'قيد المعالجة',
        'paid': 'تم الدفع',
        'ready_to_ship': 'جاهز للشحن',
        'shipped': 'تم الشحن',
        'delivered': 'تم التوصيل',
        'completed': 'مكتمل'
    };

    const title = `تحديث حالة الطلب #${order.orderId}`;
    const message = `تم تحديث حالة طلبك إلى: ${statusMessages[newStatus] || newStatus}`;

    // إشعار للعميل
    if (customer.user) {
        await sendNotification(
            customer.user,
            customer._id,
            order._id,
            'order_status_changed',
            title,
            message,
            {
                customerEmail: customer.email,
                customerPhone: customer.phone,
                status: newStatus
            }
        );
    }

    // إرسال Email و WhatsApp
    if (customer.email) {
        await emailService.sendOrderStatusUpdate(order, customer, newStatus);
    }

    if (customer.phone && whatsappService.isReady()) {
        await whatsappService.sendOrderStatusUpdateWhatsApp(order, customer, newStatus);
    }
};

/**
 * إشعار رفع سند الشحن
 */
const notifyShippingReceiptUploaded = async (order, customer, user, receiptUrl) => {
    const title = `تم شحن طلبك #${order.orderId}`;
    const message = `تم رفع سند الشحن. يمكنك تتبع طلبك الآن.`;

    // إشعار للعميل
    if (customer.user) {
        await sendNotification(
            customer.user,
            customer._id,
            order._id,
            'shipping_receipt_uploaded',
            title,
            message,
            {
                customerEmail: customer.email,
                customerPhone: customer.phone,
                receiptUrl: receiptUrl
            }
        );
    }

    // إرسال Email و WhatsApp
    if (customer.email) {
        await emailService.sendShippingReceipt(order, customer, receiptUrl);
    }

    if (customer.phone && whatsappService.isReady()) {
        await whatsappService.sendShippingReceiptWhatsApp(order, customer, receiptUrl);
    }
};

/**
 * الحصول على إشعارات المستخدم
 */
const getUserNotifications = async (userId, limit = 20, unreadOnly = false) => {
    const query = { user: userId };
    if (unreadOnly) {
        query.read = false;
    }

    return await Notification.find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate('order', 'orderId total')
        .populate('customer', 'profile email');
};

/**
 * قراءة إشعار
 */
const markAsRead = async (notificationId, userId) => {
    return await Notification.findOneAndUpdate(
        { _id: notificationId, user: userId },
        { read: true, readAt: new Date() },
        { new: true }
    );
};

/**
 * قراءة جميع الإشعارات
 */
const markAllAsRead = async (userId) => {
    return await Notification.markAllAsRead(userId);
};

/**
 * الحصول على عدد الإشعارات غير المقروءة
 */
const getUnreadCount = async (userId) => {
    return await Notification.getUnreadCount(userId);
};

/**
 * حفظ اشتراك Push Notification (مجاني تماماً)
 */
const saveSubscription = async (userId, subscription) => {
    try {
        let PushSubscription;
        try {
            PushSubscription = require('../models/PushSubscription');
        } catch (e) {
            // Model غير موجود - استخدام fallback
            logger.warn('PushSubscription model not found, using file fallback');
            PushSubscription = null;
        }

        if (PushSubscription) {
            // التحقق من وجود اشتراك سابق
            const existing = await PushSubscription.findOne({
                userId: userId,
                'subscription.endpoint': subscription.endpoint
            });

            if (existing) {
                // تحديث الاشتراك الموجود
                existing.subscription = subscription;
                existing.updatedAt = new Date();
                return await existing.save();
            } else {
                // إنشاء اشتراك جديد
                return await PushSubscription.create({
                    userId: userId,
                    subscription: subscription
                });
            }
        }
    } catch (error) {
        logger.error('Error saving push subscription:', error);
        // في حالة عدم وجود Model أو فشل الاتصال بقاعدة البيانات، نحفظ في ملف JSON
        const fs = require('fs');
        const path = require('path');
        const subscriptionsFile = path.join(__dirname, '../data/push-subscriptions.json');

        let subscriptions = {};
        try {
            if (fs.existsSync(subscriptionsFile)) {
                subscriptions = JSON.parse(fs.readFileSync(subscriptionsFile, 'utf8'));
            }
        } catch (e) {
            subscriptions = {};
        }

        const userIdStr = userId.toString();
        if (!subscriptions[userIdStr]) {
            subscriptions[userIdStr] = [];
        }

        // إزالة اشتراك سابق بنفس الـ endpoint
        subscriptions[userIdStr] = subscriptions[userIdStr].filter(
            sub => sub.subscription && sub.subscription.endpoint !== subscription.endpoint
        );

        // إضافة الاشتراك الجديد
        subscriptions[userIdStr].push({
            subscription: subscription,
            createdAt: new Date().toISOString()
        });

        // إنشاء المجلد إذا لم يكن موجوداً
        // التحقق من بيئة Vercel
        const isVercel = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';

        if (!isVercel) {
            const dataDir = path.dirname(subscriptionsFile);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }
        }

        fs.writeFileSync(subscriptionsFile, JSON.stringify(subscriptions, null, 2));
        logger.info('Push subscription saved to file (fallback)');
        return { success: true };
    }
};

/**
 * إزالة اشتراك Push Notification
 */
const removeSubscription = async (userId, subscription) => {
    try {
        let PushSubscription;
        try {
            PushSubscription = require('../models/PushSubscription');
        } catch (e) {
            // Model غير موجود - استخدام fallback
            logger.warn('PushSubscription model not found, using file fallback');
            PushSubscription = null;
        }

        if (PushSubscription) {
            return await PushSubscription.findOneAndDelete({
                userId: userId,
                'subscription.endpoint': subscription.endpoint
            });
        }
    } catch (error) {
        logger.error('Error removing push subscription:', error);
        // في حالة عدم وجود Model أو فشل الاتصال، نحذف من ملف JSON
        const fs = require('fs');
        const path = require('path');
        const subscriptionsFile = path.join(__dirname, '../data/push-subscriptions.json');

        if (fs.existsSync(subscriptionsFile)) {
            let subscriptions = JSON.parse(fs.readFileSync(subscriptionsFile, 'utf8'));
            const userIdStr = userId.toString();

            if (subscriptions[userIdStr]) {
                subscriptions[userIdStr] = subscriptions[userIdStr].filter(
                    sub => sub.subscription && sub.subscription.endpoint !== subscription.endpoint
                );

                if (subscriptions[userIdStr].length === 0) {
                    delete subscriptions[userIdStr];
                }

                fs.writeFileSync(subscriptionsFile, JSON.stringify(subscriptions, null, 2));
                logger.info('Push subscription removed from file (fallback)');
            }
        }
        return { success: true };
    }
};

/**
 * إرسال إشعار جماعي لجميع المستخدمين أو فئة معينة
 */
const sendBulkNotification = async (title, message, options = {}) => {
    const {
        audience = 'all', // all, vip, agents, new, active, inactive
        type = 'system_announcement',
        priority = 'normal'
    } = options;

    try {
        const Customer = require('../models/Customer');
        const User = require('../models/User');
        const webpush = require('web-push');
        const config = require('../config/env');
        const PushSubscription = require('../models/PushSubscription');

        // بناء query للعملاء حسب الجمهور
        let customerQuery = {};
        let customerIds = null;

        switch (audience) {
            case 'vip':
                customerQuery.isVIP = true;
                break;
            case 'agents':
                customerQuery.role = 'agent';
                break;
            case 'new':
                // عملاء جدد (آخر 30 يوم)
                const thirtyDaysAgo = new Date();
                thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
                customerQuery.createdAt = { $gte: thirtyDaysAgo };
                break;
            case 'active':
                // عملاء نشطين (لديهم طلبات في آخر 90 يوم)
                const Order = require('../models/Order');
                const ninetyDaysAgo = new Date();
                ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

                const activeOrders = await Order.find({
                    createdAt: { $gte: ninetyDaysAgo },
                    'customer.phone': { $exists: true, $ne: null }
                }).distinct('customer.phone');

                if (activeOrders.length > 0) {
                    customerQuery.phone = { $in: activeOrders };
                } else {
                    customerQuery.phone = { $exists: false }; // لا يوجد عملاء نشطين
                }
                break;
            case 'inactive':
                // عملاء غير نشطين (لا يوجد لديهم طلبات في آخر سنة)
                const Order2 = require('../models/Order');
                const oneYearAgo = new Date();
                oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

                const recentOrders = await Order2.find({
                    createdAt: { $gte: oneYearAgo },
                    'customer.phone': { $exists: true, $ne: null }
                }).distinct('customer.phone');

                if (recentOrders.length > 0) {
                    customerQuery.phone = { $nin: recentOrders };
                }
                // إذا لم يكن هناك طلبات حديثة، جميع العملاء غير نشطين
                break;
        }

        // الحصول على العملاء
        const customers = await Customer.find(customerQuery).populate('user');

        let sentCount = 0;
        let failedCount = 0;
        const results = [];

        // إرسال إشعار لكل عميل
        for (const customer of customers) {
            try {
                // إنشاء إشعار داخل التطبيق إذا كان لديه حساب
                if (customer.user) {
                    await Notification.createNotification(
                        customer.user._id,
                        type,
                        title,
                        message,
                        { customer: customer._id, bulkNotification: true }
                    );
                }

                // إرسال Push Notification
                if (customer.user) {
                    try {
                        let PushSubscription;
                        try {
                            PushSubscription = require('../models/PushSubscription');
                        } catch (e) {
                            // Model غير موجود - تخطي Push Notifications
                            logger.warn('PushSubscription model not found, skipping push notifications');
                        }

                        if (PushSubscription) {
                            const subscriptions = await PushSubscription.find({ userId: customer.user._id });

                            // إعداد VAPID
                            if (config.vapidPublicKey && config.vapidPrivateKey) {
                                webpush.setVapidDetails(
                                    config.vapidEmail || 'mailto:admin@example.com',
                                    config.vapidPublicKey,
                                    config.vapidPrivateKey
                                );

                                // إرسال لكل اشتراك
                                for (const subscription of subscriptions) {
                                    try {
                                        await webpush.sendNotification(
                                            subscription.subscription,
                                            JSON.stringify({
                                                title: title,
                                                body: message,
                                                icon: '/assets/manahel.jpg',
                                                badge: '/assets/manahel.jpg',
                                                data: {
                                                    url: '/',
                                                    type: type
                                                }
                                            })
                                        );
                                    } catch (error) {
                                        logger.warn(`Failed to send push to ${customer.user._id}:`, error.message);
                                    }
                                }
                            }
                        }
                    } catch (error) {
                        logger.warn(`Failed to get subscriptions for ${customer.user._id}:`, error.message);
                    }
                }

                // إرسال Email
                if (customer.email) {
                    try {
                        await emailService.sendEmail(
                            customer.email,
                            title,
                            message
                        );
                    } catch (error) {
                        logger.warn(`Failed to send email to ${customer.email}:`, error.message);
                    }
                }

                // إرسال WhatsApp
                if (customer.phone && whatsappService.isReady()) {
                    try {
                        await whatsappService.sendWhatsAppMessage(
                            customer.phone,
                            `${title}\n\n${message}`
                        );
                    } catch (error) {
                        logger.warn(`Failed to send WhatsApp to ${customer.phone}:`, error.message);
                    }
                }

                sentCount++;
                results.push({
                    customerId: customer._id,
                    success: true
                });
            } catch (error) {
                failedCount++;
                results.push({
                    customerId: customer._id,
                    success: false,
                    error: error.message
                });
                logger.error(`Failed to send notification to customer ${customer._id}:`, error);
            }
        }

        return {
            success: true,
            total: customers.length,
            sent: sentCount,
            failed: failedCount,
            results: results
        };
    } catch (error) {
        logger.error('Failed to send bulk notification:', error);
        return {
            success: false,
            error: error.message
        };
    }
};

/**
 * إشعار الفائزين في المسابقة (عند تفعيل "إشعارات الفائزين" من إدارة المسابقات)
 * يرسل واتساب لكل فائز له رقم هاتف إن كان واتساب مفعّلاً
 */
async function notifyContestWinners(contestName, prizeName, winners) {
    if (!winners || !Array.isArray(winners) || winners.length === 0) return { sent: 0 };
    const whatsappService = require('./whatsappService');
    let sent = 0;
    const title = `🎉 مبروك! فزت في مسابقة ${contestName || 'مناحل ريف وصاب'}`;
    const message = `مرحباً، نُسعد بإعلامك أنك من الفائزين في المسابقة. الجائزة: ${prizeName || 'جائزة'}.\nسيتم التواصل معك قريباً للتنسيق. مناحل ريف وصاب 🍯`;
    for (const w of winners) {
        const phone = w.phone || (w.customer && w.customer.phone);
        if (!phone) continue;
        try {
            if (whatsappService.isReady && typeof whatsappService.isReady === 'function' && whatsappService.isReady()) {
                const result = await whatsappService.sendWhatsAppMessage(phone, `${title}\n\n${message}`);
                if (result && result.success) sent++;
            }
        } catch (e) {
            logger.warn('Contest winner WhatsApp send failed:', e.message);
        }
    }
    return { sent };
}

module.exports = {
    sendNotification,
    notifyOrderCreated,
    notifyOrderStatusChanged,
    notifyShippingReceiptUploaded,
    getUserNotifications,
    markAsRead,
    markAllAsRead,
    getUnreadCount,
    saveSubscription,
    removeSubscription,
    sendBulkNotification,
    notifyContestWinners
};










