/**
 * WhatsApp Service
 * خدمة إرسال الرسائل عبر واتساب
 */

const config = require('../config/env');
const logger = require('../utils/logger');

let whatsappClient = null;
let isReady = false;

/**
 * تهيئة WhatsApp Service
 */
const initWhatsAppService = async () => {
    try {
        // في Vercel، نستخدم memory storage بدلاً من ملفات
        const isVercel = process.env.VERCEL === '1';

        if (isVercel) {
            console.log('📱 Using memory storage for WhatsApp in Vercel');
            // استخدام memory storage بدلاً من ملفات
            global.whatsappSession = global.whatsappSession || {};
        }

        const { Client, LocalAuth } = require('whatsapp-web.js');
        const qrcode = require('qrcode-terminal');

        // في Vercel، نستخدم memory storage
        const authStrategy = isVercel ?
            new LocalAuth({
                clientId: 'vercel-whatsapp',
                dataPath: './whatsapp-session-memory'
            }) :
            new LocalAuth({
                clientId: 'manahl-whatsapp',
                dataPath: './whatsapp-session'
            });

        whatsappClient = new Client({
            authStrategy: authStrategy,
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--single-process',
                    '--disable-gpu'
                ]
            }
        });

        // QR Code generation
        whatsappClient.on('qr', (qr) => {
            logger.info('📱 WhatsApp QR Code generated. Scan with your phone:');
            qrcode.generate(qr, { small: true });
            console.log('\n📱 امسح رمز QR أعلاه بواسطة واتساب على هاتفك');
        });

        // Ready event
        whatsappClient.on('ready', () => {
            isReady = true;
            logger.info('✅ WhatsApp client is ready!');
            console.log('✅ واتساب جاهز للإرسال!');
        });

        // Authentication failure
        whatsappClient.on('auth_failure', (msg) => {
            logger.error('❌ WhatsApp authentication failed:', msg);
            isReady = false;
        });

        // Disconnected
        whatsappClient.on('disconnected', (reason) => {
            logger.warn('⚠️  WhatsApp disconnected:', reason);
            isReady = false;
        });

        // Initialize
        if (isVercel) {
            // في Vercel، نحاول الاتصال بدون إنشاء مجلدات
            try {
                await whatsappClient.initialize();
                console.log('✅ WhatsApp initialized successfully in Vercel');
            } catch (initError) {
                console.log('⚠️  WhatsApp initialization failed in Vercel, but service continues');
                console.log('📱 WhatsApp will work with limited functionality');
                return false;
            }
        } else {
            await whatsappClient.initialize();
        }

        return true;
    } catch (error) {
        logger.error('❌ Failed to initialize WhatsApp service:', error);
        logger.warn('⚠️  WhatsApp notifications will be disabled');
        return false;
    }
};

/**
 * إرسال رسالة واتساب
 */
const sendWhatsAppMessage = async (phoneNumber, message) => {
    if (!whatsappClient || !isReady) {
        logger.warn('WhatsApp client not ready, skipping message');
        return { success: false, message: 'WhatsApp client not ready' };
    }

    try {
        // تنظيف رقم الهاتف (إزالة + ومسافات)
        const cleanPhone = phoneNumber.replace(/[\s\+]/g, '');

        // إضافة @c.us للرقم
        const chatId = cleanPhone.includes('@') ? cleanPhone : `${cleanPhone}@c.us`;

        await whatsappClient.sendMessage(chatId, message);

        logger.info(`✅ WhatsApp message sent to ${phoneNumber}`);

        return {
            success: true,
            message: 'Message sent successfully'
        };
    } catch (error) {
        logger.error('❌ Failed to send WhatsApp message:', error);
        return {
            success: false,
            error: error.message
        };
    }
};

/**
 * إرسال رسالة تأكيد الطلب
 */
const sendOrderConfirmationWhatsApp = async (order, customer) => {
    const message = `🍯 *تأكيد طلبك من مناحل ريف وصاب* 🍯

📋 *رقم الطلب:* ${order.orderId}
📅 *التاريخ:* ${new Date(order.createdAt).toLocaleString('ar-SA')}
💰 *المبلغ:* ${order.total.toLocaleString()} ريال
💳 *طريقة الدفع:* ${getPaymentMethodText(order.paymentMethod)}

📍 *معلومات التوصيل:*
🏙️ ${order.customer.city}
📍 ${order.customer.address}

📦 *الحالة:* قيد المعالجة

يمكنك تتبع طلبك من خلال:
${config.frontendUrl}/order-tracking.html?orderId=${order.orderId}

شكراً لثقتك بنا! 🙏`;

    return await sendWhatsAppMessage(customer.phone, message);
};

/**
 * إرسال رسالة تحديث حالة الطلب
 */
const sendOrderStatusUpdateWhatsApp = async (order, customer, newStatus) => {
    const statusMessages = {
        'processing': '⏳ قيد المعالجة',
        'paid': '💳 تم الدفع',
        'ready_to_ship': '📦 جاهز للشحن',
        'shipped': '🚚 تم الشحن',
        'delivered': '✅ تم التوصيل',
        'completed': '🎉 مكتمل'
    };

    const message = `📦 *تحديث حالة طلبك*

📋 *رقم الطلب:* ${order.orderId}
${statusMessages[newStatus] || newStatus}

تتبع طلبك:
${config.frontendUrl}/order-tracking.html?orderId=${order.orderId}`;

    return await sendWhatsAppMessage(customer.phone, message);
};

/**
 * إرسال رسالة سند الشحن
 */
const sendShippingReceiptWhatsApp = async (order, customer, receiptUrl) => {
    const message = `🚚 *تم شحن طلبك!*

📋 *رقم الطلب:* ${order.orderId}

📸 *سند الشحن:*
${receiptUrl}

يمكنك استخدام هذا السند لتتبع شحنتك.

تتبع طلبك:
${config.frontendUrl}/order-tracking.html?orderId=${order.orderId}`;

    return await sendWhatsAppMessage(customer.phone, message);
};

// Helper function
const getPaymentMethodText = (method) => {
    const methods = {
        'full': 'دفع كامل (تحويل رقمي/كريمي)',
        'half': 'دفع نصفي (عربون والباقي عند الاستلام)',
        'delivery': 'دفع عند الاستلام',
        'cash_on_delivery': 'دفع عند الاستلام'
    };
    return methods[method] || method;
};

// Initialize on load (with environment check)
const shouldInitWhatsApp = config.enableWhatsApp && (config.nodeEnv === 'production' || process.env.ENABLE_WHATSAPP === 'true');

if (shouldInitWhatsApp) {
    initWhatsAppService().catch(err => {
        logger.warn('WhatsApp initialization failed, continuing without it:', err.message);
    });
} else {
    console.log('📱 WhatsApp service is disabled (ENABLE_WHATSAPP=false)');
}

module.exports = {
    initWhatsAppService,
    sendWhatsAppMessage,
    sendOrderConfirmationWhatsApp,
    sendOrderStatusUpdateWhatsApp,
    sendShippingReceiptWhatsApp,
    isReady: () => isReady
};



















