/**
 * Logger Configuration
 * نظام التسجيل (Logging) باستخدام Winston
 */

const winston = require('winston');
const path = require('path');
const fs = require('fs');
const config = require('../config/env');

// التحقق من بيئة Vercel
const isVercel = process.env.VERCEL === '1';

// في Vercel، لا نستخدم ملفات السجلات أبداً
if (isVercel) {
    // لا ننشئ أي مجلدات في Vercel
    console.log('📝 Vercel environment detected - using console logging only');
}

// تنسيق السجلات
const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
);

// تنسيق للسجلات في Console (للتطوير)
const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
        let msg = `${timestamp} [${level}]: ${message}`;
        if (Object.keys(meta).length > 0) {
            msg += ` ${JSON.stringify(meta)}`;
        }
        return msg;
    })
);

// إنشاء transports للـ logger
const transports = [];

// في Vercel، نستخدم Console فقط
if (isVercel) {
    transports.push(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
        )
    }));
} else {
    // في بيئة التطوير، أضف Console transport
    if (config.nodeEnv !== 'production') {
        transports.push(new winston.transports.Console({
            format: consoleFormat
        }));
    }

    // في بيئة الإنتاج المحلية، أضف ملفات السجلات
    if (config.nodeEnv === 'production') {
        // إنشاء مجلد logs فقط في البيئة المحلية
        let logsDir = path.join(__dirname, '..', 'logs');
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }

        // كتابة الأخطاء في ملف منفصل
        transports.push(new winston.transports.File({
            filename: path.join(logsDir, 'error.log'),
            level: 'error',
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        }));

        // كتابة جميع السجلات في ملف
        transports.push(new winston.transports.File({
            filename: path.join(logsDir, 'combined.log'),
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        }));
    }
}

// إنشاء Logger
const logger = winston.createLogger({
    level: config.nodeEnv === 'production' ? 'info' : 'debug',
    format: logFormat,
    defaultMeta: { service: 'manahl-badr-api' },
    transports: transports,
});

// معالجة الاستثناءات غير المعالجة (فقط في البيئة المحلية)
if (!isVercel) {
    // إنشاء مجلد logs فقط في البيئة المحلية
    let logsDir = path.join(__dirname, '..', 'logs');
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }

    logger.exceptions = new winston.transports.File({
        filename: path.join(logsDir, 'exceptions.log'),
    });

    logger.rejections = new winston.transports.File({
        filename: path.join(logsDir, 'rejections.log'),
    });
}

// دوال مساعدة
if (!isVercel) {
    logger.info('✅ Logger initialized');
} else {
    logger.info('✅ Logger initialized (Vercel - Console only)');
}

module.exports = logger;














