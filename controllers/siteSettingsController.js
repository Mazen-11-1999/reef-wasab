/**
 * Site Settings Controller
 * التحكم في إعدادات الموقع (اسم المتجر، الشعار، الروابط، إلخ)
 */

const SiteSettings = require('../models/SiteSettings');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');

async function getOrCreateSettings() {
    let settings = await SiteSettings.findOne();
    if (!settings) {
        settings = await SiteSettings.create({
            storeName: 'مناحل ريف وصاب',
            storeNameEn: 'Reef Wasab Apiaries',
            description: 'أجود أنواع العسل اليمني الأصيل من جبال وصاب الشاهقة',
            address: 'صنعاء - اليمن'
        });
    }
    return settings;
}

/**
 * الحصول على الإعدادات للعرض العام (بدون مصادقة) - للصفحة الرئيسية والزوار
 */
exports.getPublic = catchAsync(async (req, res, next) => {
    // التحقق من اتصال قاعدة البيانات
    const db = require('../config/database');
    if (!db.mongoose.connection.readyState || db.mongoose.connection.readyState !== 1) {
        // إرجاع بيانات وهمية إذا لم تتصل قاعدة البيانات
        return res.status(200).json({
            success: true,
            settings: {
                storeName: 'مناحل ريف وصاب',
                storeNameEn: 'Reef Wasab Apiaries',
                description: 'أجود أنواع العسل اليمني الأصيل من جبال وصاب الشاهقة',
                address: 'صنعاء - اليمن',
                phone: '+967 771 885 223',
                email: 'info@reef-wasab.com',
                socialMedia: {
                    facebook: 'https://facebook.com/reef-wasab',
                    instagram: 'https://instagram.com/reef-wasab',
                    twitter: 'https://twitter.com/reef-wasab'
                },
                logo: '/assets/manahel.jpg',
                storyGallery: []
            }
        });
    }

    const settings = await getOrCreateSettings();
    res.status(200).json({
        success: true,
        settings: {
            storeName: settings.storeName,
            storeNameEn: settings.storeNameEn,
            logoUrl: settings.logoUrl,
            description: settings.description,
            address: settings.address,
            phone: settings.phone,
            whatsappPhone: settings.whatsappPhone,
            email: settings.email,
            tiktok: settings.tiktok,
            snapchat: settings.snapchat,
            facebook: settings.facebook,
            instagram: settings.instagram,
            whatsapp: settings.whatsapp,
            maintenanceMode: settings.maintenanceMode,
            showPrices: settings.showPrices,
            allowOrders: settings.allowOrders,
            allowReviews: settings.allowReviews,
            storyGallery: (settings.storyGallery && Array.isArray(settings.storyGallery)) ? settings.storyGallery : [],
            paymentMethods: (settings.paymentMethods && Array.isArray(settings.paymentMethods)) ? settings.paymentMethods : []
        }
    });
});

/**
 * الحصول على الإعدادات كاملة (للوحة التحكم - يتطلب مصادقة)
 */
exports.get = catchAsync(async (req, res, next) => {
    const settings = await getOrCreateSettings();
    res.status(200).json({
        success: true,
        settings: settings.toObject()
    });
});

/**
 * تحديث الإعدادات (للمشرف فقط)
 */
exports.update = catchAsync(async (req, res, next) => {
    const settings = await getOrCreateSettings();
    const allowed = [
        'storeName', 'storeNameEn', 'logoUrl', 'description', 'address',
        'phone', 'whatsappPhone', 'email',
        'tiktok', 'snapchat', 'facebook', 'instagram', 'whatsapp',
        'maintenanceMode', 'showPrices', 'allowOrders', 'allowReviews', 'emailNotifications'
    ];
    if (req.body.storyGallery !== undefined && Array.isArray(req.body.storyGallery)) {
        settings.storyGallery = req.body.storyGallery.slice(0, 6).map(item => ({
            url: (item && item.url) ? String(item.url).trim() : '',
            caption: (item && item.caption) ? String(item.caption).trim() : ''
        }));
    }
    if (req.body.paymentMethods !== undefined && Array.isArray(req.body.paymentMethods)) {
        settings.paymentMethods = req.body.paymentMethods.map(item => ({
            type: ['bank', 'hawala', 'phone', 'card', 'other'].includes(item.type) ? item.type : 'bank',
            label: (item && item.label) ? String(item.label).trim() : '',
            bankName: (item && item.bankName) ? String(item.bankName).trim() : '',
            accountHolder: (item && item.accountHolder) ? String(item.accountHolder).trim() : '',
            accountNumber: (item && item.accountNumber) ? String(item.accountNumber).trim() : '',
            iban: (item && item.iban) ? String(item.iban).trim() : '',
            hawalaOfficeName: (item && item.hawalaOfficeName) ? String(item.hawalaOfficeName).trim() : '',
            recipientName: (item && item.recipientName) ? String(item.recipientName).trim() : '',
            recipientPhone: (item && item.recipientPhone) ? String(item.recipientPhone).trim() : '',
            branchOrAgent: (item && item.branchOrAgent) ? String(item.branchOrAgent).trim() : '',
            phoneNumber: (item && item.phoneNumber) ? String(item.phoneNumber).trim() : '',
            cardNumber: (item && item.cardNumber) ? String(item.cardNumber).trim() : '',
            holderName: (item && item.holderName) ? String(item.holderName).trim() : '',
            note: (item && item.note) ? String(item.note).trim() : ''
        }));
    }
    allowed.forEach(field => {
        if (req.body[field] !== undefined) {
            if (typeof settings[field] === 'boolean') {
                settings[field] = req.body[field] === true || req.body[field] === 'true';
            } else {
                settings[field] = req.body[field] != null ? String(req.body[field]).trim() : '';
            }
        }
    });
    await settings.save();
    res.status(200).json({
        success: true,
        message: 'تم حفظ الإعدادات بنجاح',
        settings: settings.toObject()
    });
});

/**
 * رفع شعار الموقع (للمشرف فقط) - يحفظ الملف ويحدّث logoUrl
 */
exports.uploadLogo = catchAsync(async (req, res, next) => {
    if (!req.file || !req.file.filename) {
        return next(new AppError('لم يتم رفع ملف الشعار', 400));
    }
    const logoUrl = '/uploads/' + req.file.filename;
    const settings = await getOrCreateSettings();
    settings.logoUrl = logoUrl;
    await settings.save();
    res.status(200).json({
        success: true,
        message: 'تم رفع الشعار بنجاح',
        logoUrl
    });
});

/** القيم الافتراضية للإعدادات */
const DEFAULT_SETTINGS = {
    storeName: 'مناحل ريف وصاب',
    storeNameEn: 'Reef Wasab Apiaries',
    logoUrl: '',
    description: 'أجود أنواع العسل اليمني الأصيل من جبال وصاب الشاهقة',
    address: 'صنعاء - اليمن',
    phone: '',
    whatsappPhone: '',
    email: '',
    tiktok: '',
    snapchat: '',
    facebook: '',
    instagram: '',
    whatsapp: '',
    maintenanceMode: false,
    showPrices: true,
    allowOrders: true,
    allowReviews: true,
    emailNotifications: false
};

/**
 * رفع صور معرض قصتنا (حتى 6 صور) - للمشرف فقط
 * يتوقع FormData مع الحقول: image0, image1, ... image5 أو images[]
 */
exports.uploadStoryGallery = catchAsync(async (req, res, next) => {
    const files = req.files || [];
    if (files.length === 0) {
        return next(new AppError('لم يتم رفع أي صورة', 400));
    }
    const gallery = files.slice(0, 6).map((file, i) => ({
        url: file.filename ? '/uploads/story-gallery/' + file.filename : '',
        caption: (req.body && req.body['caption' + i]) ? String(req.body['caption' + i]).trim() : ''
    }));
    const settings = await getOrCreateSettings();
    settings.storyGallery = gallery;
    await settings.save();
    res.status(200).json({
        success: true,
        message: 'تم حفظ صور المعرض بنجاح',
        storyGallery: settings.storyGallery
    });
});

/**
 * استعادة الإعدادات إلى القيم الافتراضية (للمشرف فقط)
 */
exports.reset = catchAsync(async (req, res, next) => {
    const settings = await getOrCreateSettings();
    Object.keys(DEFAULT_SETTINGS).forEach(key => {
        settings[key] = DEFAULT_SETTINGS[key];
    });
    await settings.save();
    res.status(200).json({
        success: true,
        message: 'تم استعادة الإعدادات الافتراضية',
        settings: settings.toObject()
    });
});
