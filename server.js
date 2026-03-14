/**
 * Main Server File
 * ملف الخادم الرئيسي - مناحل ريف وصاب
 * 
 * هذا الملف يحتوي على إعدادات الخادم الأساسية
 * تم إعادة هيكلته بالكامل لتحسين الأمان والأداء
 */

// Authentication middleware (must be defined at the very top)
const { authenticateToken } = require('./middleware/auth');
const { validate, sanitize } = require('./middleware/validation');
const validators = require('./middleware/validators');

// Load environment variables
const config = require('./config/env');
const { connectDB } = require('./config/database');
const mongoose = require('mongoose');

// Core dependencies
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');

// Security middleware
const security = require('./middleware/security');

// Logging
const logger = require('./utils/logger');
const requestLogger = require('./middleware/requestLogger');

// Error handling
const globalErrorHandler = require('./middleware/errorHandler');
const AppError = require('./utils/appError');

// Initialize Express app
const app = express();

// Trust proxy (for rate limiting behind reverse proxy)
app.set('trust proxy', 1);

// ============================================
// MIDDLEWARE
// ============================================

// إخفاء هوية الخادم عن المستخدم
app.disable('x-powered-by');

// منع الوصول إلى مسارات حساسة (مثل .env أو ملفات خارج frontend)
app.use((req, res, next) => {
    const p = (req.path || '').toLowerCase();
    if (p.includes('.env') || p.includes('..') || /\/\.\w+/.test(p)) {
        return res.status(404).json({ success: false, message: 'Not Found' });
    }
    next();
});

// Security middleware
app.use(security.helmet);
app.use(security.mongoSanitize);
app.use(security.xssClean);
app.use(security.sanitizeResponse);

// Compression
app.use(compression());

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS
app.use(cors(security.corsOptions));

// Request logging
app.use(requestLogger);

// Morgan logging (complementary to requestLogger)
if (config.nodeEnv === 'development') {
    app.use(morgan('dev'));
} else {
    // التحقق من بيئة Vercel
    const isVercel = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';

    // في Vercel، لا نستخدم ملفات السجلات
    if (!isVercel) {
        const logsDir = path.join(__dirname, 'logs');
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }
        const accessLogStream = fs.createWriteStream(
            path.join(logsDir, 'access.log'),
            { flags: 'a' }
        );
        app.use(morgan('combined', { stream: accessLogStream }));
    }
}

// Rate limiting
app.use('/api/', security.generalLimiter);
app.use('/api/admin', security.adminLimiter);

// منع تنفيذ طلبات API التي تحتاج قاعدة البيانات قبل اكتمال الاتصال (تجنب 500)
app.use('/api/', (req, res, next) => {
    if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({
            success: false,
            message: 'قاعدة البيانات غير متصلة. يرجى التحقق من الاتصال أو المحاولة لاحقاً.'
        });
    }
    next();
});

// Ensure uploads directory exists for logos and product images
// التحقق من بيئة Vercel
const isVercel = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';

// في Vercel، لا نستخدم مجلد uploads
if (!isVercel) {
    const uploadsDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
    }
}

// Static files
app.use('/uploads', express.static('uploads'));
app.use(express.static(path.join(__dirname, 'frontend'))); // Serve static files from frontend directory
// Removed dangerous express.static('.') that exposed all project files

// ============================================
// ROUTES
// ============================================

// Health check
app.get('/health', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'Server is running',
        timestamp: new Date().toISOString()
    });
});

// Serve index.html for root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// لوحة تحكم المالك: إعادة توجيه /admin و /admin/ إلى صفحة الدخول
app.get('/admin', (req, res) => {
    res.redirect('/admin/login.html');
});
app.get('/admin/', (req, res) => {
    res.redirect('/admin/login.html');
});

// Serve pages routes correctly (must be before API routes to avoid conflicts)
app.get('/pages/:page', (req, res) => {
    const page = req.params.page;
    const pagePath = path.join(__dirname, 'frontend', 'pages', page);

    // Security: Only allow HTML files
    if (!page.endsWith('.html')) {
        return res.status(400).json({ success: false, message: 'Invalid page format' });
    }

    // Check if file exists
    if (fs.existsSync(pagePath)) {
        res.sendFile(pagePath);
    } else {
        // Fallback to index.html if page not found
        res.status(404).sendFile(path.join(__dirname, 'frontend', 'index.html'));
    }
});

// Admin Password-Only Login Route (قبل API routes)
app.post('/api/admin/login', async (req, res) => {
    try {
        const { password } = req.body;

        if (!password) {
            return res.status(400).json({ success: false, message: 'كلمة المرور مطلوبة' });
        }

        // البحث عن admin user
        const User = require('./models/User');
        const admin = await User.findOne({ role: 'admin' }).select('+password');

        if (!admin) {
            return res.status(401).json({ success: false, message: 'حساب المشرف غير موجود' });
        }

        // التحقق من كلمة المرور
        const isPasswordValid = await admin.comparePassword(password);

        if (!isPasswordValid) {
            return res.status(401).json({ success: false, message: 'كلمة المرور غير صحيحة' });
        }

        // التحقق من أن المستخدم نشط
        if (!admin.isActive) {
            return res.status(403).json({ success: false, message: 'تم تعطيل حسابك' });
        }

        // تحديث آخر تسجيل دخول
        admin.lastLogin = new Date();
        await admin.save({ validateBeforeSave: false });

        // إنشاء Token
        const token = admin.generateAuthToken();

        res.status(200).json({
            success: true,
            token,
            message: 'تم تسجيل الدخول بنجاح'
        });
    } catch (error) {
        console.error('Admin login error:', error);
        res.status(500).json({ success: false, message: 'حدث خطأ في تسجيل الدخول' });
    }
});

// Admin Change Password Route
app.put('/api/admin/change-password', authenticateToken, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ success: false, message: 'كلمة المرور الحالية والجديدة مطلوبة' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ success: false, message: 'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل' });
        }

        // البحث عن admin user
        const User = require('./models/User');
        const admin = await User.findOne({ role: 'admin' }).select('+password');

        if (!admin) {
            return res.status(401).json({ success: false, message: 'حساب المشرف غير موجود' });
        }

        // التحقق من كلمة المرور الحالية
        const isPasswordValid = await admin.comparePassword(currentPassword);

        if (!isPasswordValid) {
            return res.status(401).json({ success: false, message: 'كلمة المرور الحالية غير صحيحة' });
        }

        // تحديث كلمة المرور
        admin.password = newPassword;
        await admin.save();

        // إنشاء Token جديد
        const token = admin.generateAuthToken();

        res.status(200).json({
            success: true,
            token,
            message: 'تم تغيير كلمة المرور بنجاح'
        });
    } catch (error) {
        console.error('Admin change password error:', error);
        res.status(500).json({ success: false, message: 'حدث خطأ في تغيير كلمة المرور' });
    }
});

// API Routes
// Note: Rate limiting يجب أن يكون قبل الـ routes
app.use('/api/auth/register', security.registerLimiter); // Rate limiting للتسجيل
app.use('/api/auth', security.authLimiter, require('./routes/authRoutes'));

// New API Routes
app.use('/api/customers', require('./routes/customerRoutes'));
app.use('/api/cart', require('./routes/cartRoutes'));
app.use('/api/reviews', require('./routes/reviewRoutes'));
app.use('/api/analytics', require('./routes/analyticsRoutes'));
app.use('/api/backup', require('./routes/backupRoutes'));
app.use('/api/orders', require('./routes/orderRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));
app.use('/api/stories', require('./routes/storyRoutes'));
app.use('/api/webauthn', require('./routes/webauthnRoutes'));
app.use('/api/health-info', require('./routes/healthInfoRoutes'));
app.use('/api/site-banner', require('./routes/siteBannerRoutes'));
app.use('/api/site-settings', require('./routes/siteSettingsRoutes'));
app.use('/api/map', require('./routes/mapRoutes'));
app.use('/api/whatsapp', require('./routes/whatsappRoutes'));

// ============================================
// OLD ROUTES (للتوافق مع الكود الحالي)
// ============================================

// Import old models temporarily (mongoose already required at top)
// Import models from separate files
const Product = require('./models/Product');
const Order = require('./models/Order');
const Contest = require('./models/Contest');
const ContestSettings = require('./models/ContestSettings');
const DidYouKnow = require('./models/DidYouKnow');
const Story = require('./models/Story');
const Category = require('./models/Category');

// File upload configuration
const multer = require('multer');
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // التحقق من بيئة Vercel
        const isVercel = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';

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
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
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

// Upload configuration for stories (images and videos)
const storyStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        // التحقق من بيئة Vercel
        const isVercel = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';

        // في Vercel، لا نستخدم مجلد uploads
        if (isVercel) {
            return cb(new Error('File upload not available in production'));
        }

        const uploadDir = 'uploads/stories';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'story-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const uploadStory = multer({
    storage: storyStorage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB for videos
    fileFilter: (req, file, cb) => {
        const allowedImageTypes = /jpeg|jpg|png|gif|webp/;
        const allowedVideoTypes = /mp4|webm|ogg|mov/;
        const extname = path.extname(file.originalname).toLowerCase();
        const isImage = allowedImageTypes.test(extname) && file.mimetype.startsWith('image/');
        const isVideo = allowedVideoTypes.test(extname) && file.mimetype.startsWith('video/');

        if (isImage || isVideo) {
            return cb(null, true);
        } else {
            cb(new Error('فقط ملفات الصور والفيديو مسموحة! (صور: jpg, png, gif, webp | فيديو: mp4, webm, mov)'));
        }
    }
});

// Cache middleware
const { cacheResponse, invalidateCache } = require('./middleware/cache');

// Old routes (temporary - will be moved to separate route files)
// Products routes with validation
app.get('/api/products',
    cacheResponse(300, 'products:'), // Cache لمدة 5 دقائق 
    validators.product.searchProducts,
    validate,
    async (req, res, next) => {
        try {
            const { search, category, minPrice, maxPrice, featured, page = 1, limit = 20, sort } = req.query;

            // حد أقصى للمنتجات في استجابة واحدة (لتحمل عدد كبير من المستخدمين)
            const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

            // التحقق من اتصال قاعدة البيانات
            const db = require('./config/database');
            if (!db.mongoose.connection.readyState || db.mongoose.connection.readyState !== 1) {
                // إرجاع بيانات وهمية إذا لم تتصل قاعدة البيانات
                return res.json({
                    success: true,
                    products: [],
                    pagination: {
                        currentPage: parseInt(page),
                        totalPages: 0,
                        totalProducts: 0,
                        hasNext: false,
                        hasPrev: false
                    }
                });
            }
            const pageNum = Math.max(1, parseInt(page, 10) || 1);
            const skip = (pageNum - 1) * limitNum;

            // بناء query (إخفاء المسودات والمنتجات غير النشطة عن الزوار)
            let query = { $and: [{ status: { $ne: 'draft' } }, { isActive: { $ne: false } }] };

            if (search) {
                query.$or = [
                    { name: { $regex: search, $options: 'i' } },
                    { description: { $regex: search, $options: 'i' } }
                ];
            }

            if (category) query.category = category;
            if (featured !== undefined) query.featured = featured === 'true';
            if (minPrice || maxPrice) {
                query.price = {};
                if (minPrice) query.price.$gte = parseFloat(minPrice);
                if (maxPrice) query.price.$lte = parseFloat(maxPrice);
            }

            // بناء sort
            let sortOption = { createdAt: -1 };
            if (sort) {
                const [field, order] = sort.split('-');
                sortOption = { [field]: order === 'asc' ? 1 : -1 };
            }

            const products = await Product.find(query)
                .sort(sortOption)
                .skip(skip)
                .limit(limitNum);

            const total = await Product.countDocuments(query);

            res.json({
                success: true,
                data: products,
                products: products,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total,
                    pages: Math.ceil(total / limitNum)
                }
            });
        } catch (error) {
            next(error);
        }
    }
);

// جلب منتج واحد بالمعرف (للصفحة العامة - تفاصيل المنتج)
app.get('/api/products/:id',
    cacheResponse(300, 'product:'),
    validators.product.getProduct,
    validate,
    async (req, res, next) => {
        try {
            const product = await Product.findById(req.params.id);
            if (!product) {
                return next(new AppError('المنتج غير موجود', 404));
            }
            // عدم عرض المسودات أو المنتجات غير النشطة للزوار
            if (product.status === 'draft' || product.isActive === false) {
                return next(new AppError('المنتج غير موجود', 404));
            }
            res.json({ success: true, data: product, product });
        } catch (error) {
            next(error);
        }
    }
);

app.post('/api/products',
    authenticateToken,
    sanitize,
    validators.product.createProduct,
    validate,
    upload.single('image'),
    invalidateCache('products:*'), // حذف Cache عند إنشاء منتج جديد
    async (req, res, next) => {
        try {
            const productData = {
                ...req.body,
                image: req.file ? `/uploads/${req.file.filename}` : null
            };

            const product = new Product(productData);
            await product.save();

            res.status(201).json({ success: true, product });
        } catch (error) {
            next(error);
        }
    }
);

app.put('/api/products/:id',
    authenticateToken,
    sanitize,
    validators.product.updateProduct,
    validate,
    upload.single('image'),
    invalidateCache('products:*'),
    invalidateCache('product:*'), // حذف كاش المنتج الواحد
    async (req, res, next) => {
        try {
            const productData = { ...req.body };
            if (req.file) {
                productData.image = `/uploads/${req.file.filename}`;
            }

            const product = await Product.findByIdAndUpdate(
                req.params.id,
                productData,
                { new: true, runValidators: true }
            );

            if (!product) {
                return next(new AppError('المنتج غير موجود', 404));
            }

            res.json({ success: true, product });
        } catch (error) {
            next(error);
        }
    }
);

app.delete('/api/products/:id',
    authenticateToken,
    validators.product.deleteProduct,
    validate,
    invalidateCache('products:*'),
    invalidateCache('product:*'),
    async (req, res, next) => {
        try {
            const product = await Product.findByIdAndDelete(req.params.id);

            if (!product) {
                return next(new AppError('المنتج غير موجود', 404));
            }

            res.json({ success: true, message: 'تم حذف المنتج بنجاح' });
        } catch (error) {
            next(error);
        }
    }
);

// ============================================
// CATEGORIES API - إدارة الفئات
// ============================================

// جلب جميع الفئات (متاح للجميع)
app.get('/api/categories',
    cacheResponse(300, 'categories:'),
    async (req, res, next) => {
        try {
            const { status } = req.query;
            let query = {};
            if (status) query.status = status;

            const categories = await Category.find(query).sort({ order: 1, createdAt: -1 });

            // تحديث عدد المنتجات لكل فئة
            for (let cat of categories) {
                cat.productsCount = await Product.countDocuments({
                    category: cat.slug,
                    status: { $ne: 'draft' }
                });
            }

            res.json({ success: true, data: categories, categories });
        } catch (error) {
            next(error);
        }
    }
);

// جلب فئة واحدة
app.get('/api/categories/:id', async (req, res, next) => {
    try {
        const category = await Category.findById(req.params.id);
        if (!category) {
            return next(new AppError('الفئة غير موجودة', 404));
        }
        category.productsCount = await Product.countDocuments({
            category: category.slug,
            status: { $ne: 'draft' }
        });
        res.json({ success: true, data: category, category });
    } catch (error) {
        next(error);
    }
});

// إنشاء فئة جديدة (للمالك فقط)
app.post('/api/categories',
    authenticateToken,
    upload.single('image'),
    invalidateCache('categories:*'),
    async (req, res, next) => {
        try {
            const categoryData = { ...req.body };
            if (req.file) {
                categoryData.image = `/uploads/${req.file.filename}`;
            }

            const category = new Category(categoryData);
            await category.save();

            res.status(201).json({ success: true, category });
        } catch (error) {
            if (error.code === 11000) {
                return next(new AppError('فئة بهذا الاسم موجودة بالفعل', 400));
            }
            next(error);
        }
    }
);

// تعديل فئة (للمالك فقط)
app.put('/api/categories/:id',
    authenticateToken,
    upload.single('image'),
    invalidateCache('categories:*'),
    async (req, res, next) => {
        try {
            const categoryData = { ...req.body };
            if (req.file) {
                categoryData.image = `/uploads/${req.file.filename}`;
            }

            const category = await Category.findByIdAndUpdate(
                req.params.id,
                categoryData,
                { new: true, runValidators: true }
            );

            if (!category) {
                return next(new AppError('الفئة غير موجودة', 404));
            }

            res.json({ success: true, category });
        } catch (error) {
            if (error.code === 11000) {
                return next(new AppError('فئة بهذا الاسم موجودة بالفعل', 400));
            }
            next(error);
        }
    }
);

// حذف فئة (للمالك فقط)
app.delete('/api/categories/:id',
    authenticateToken,
    invalidateCache('categories:*'),
    async (req, res, next) => {
        try {
            const category = await Category.findByIdAndDelete(req.params.id);
            if (!category) {
                return next(new AppError('الفئة غير موجودة', 404));
            }
            res.json({ success: true, message: 'تم حذف الفئة بنجاح' });
        } catch (error) {
            next(error);
        }
    }
);

// ============================================

// ============================================
// إعدادات المسابقات (للمالك فقط)
// ============================================
app.get('/api/contest-settings',
    authenticateToken,
    async (req, res, next) => {
        try {
            const settings = await ContestSettings.get();
            res.json({ success: true, settings });
        } catch (error) {
            next(error);
        }
    }
);

app.put('/api/contest-settings',
    authenticateToken,
    async (req, res, next) => {
        try {
            const { autoDraw, winnerNotifications, autoPublish, verifyParticipants, fullActivityLog, maintenanceMode } = req.body;
            const updates = {};
            if (typeof autoDraw === 'boolean') updates.autoDraw = autoDraw;
            if (typeof winnerNotifications === 'boolean') updates.winnerNotifications = winnerNotifications;
            if (typeof autoPublish === 'boolean') updates.autoPublish = autoPublish;
            if (typeof verifyParticipants === 'boolean') updates.verifyParticipants = verifyParticipants;
            if (typeof fullActivityLog === 'boolean') updates.fullActivityLog = fullActivityLog;
            if (typeof maintenanceMode === 'boolean') updates.maintenanceMode = maintenanceMode;
            const settings = await ContestSettings.updateSettings(updates);
            res.json({ success: true, settings });
        } catch (error) {
            next(error);
        }
    }
);

// تشغيل السحب التلقائي لجميع المسابقات المنتهية والتي لم يُجرَ لها سحب بعد
app.post('/api/contests/run-auto-draw',
    authenticateToken,
    async (req, res, next) => {
        try {
            const settings = await ContestSettings.get();
            if (!settings.autoDraw) {
                return res.status(400).json({
                    success: false,
                    message: 'السحب التلقائي معطل. فعّله من الإعدادات المتقدمة أولاً.'
                });
            }
            const now = new Date();
            const contests = await Contest.find({
                status: 'active',
                endDate: { $lt: now }
            });
            const results = [];
            for (const contest of contests) {
                if ((contest.winners && contest.winners.length > 0)) continue;
                const eligible = (contest.participants || []).filter(p => p.isEligible);
                if (eligible.length === 0) {
                    results.push({ contestId: contest._id, name: contest.name, drawn: false, reason: 'لا يوجد مشاركون مؤهلون' });
                    continue;
                }
                try {
                    const count = Math.min(contest.winnersCount || 1, eligible.length);
                    await contest.drawWinner(count);
                    const newWinners = contest.winners.slice(-count);
                    newWinners.forEach(w => {
                        w.announced = !!settings.autoPublish;
                    });
                    await contest.save();

                    if (settings.winnerNotifications && newWinners.length > 0) {
                        try {
                            const notificationService = require('./services/notificationService');
                            await notificationService.notifyContestWinners(contest.name, contest.prize || 'جائزة', newWinners);
                        } catch (e) {
                            console.warn('Auto-draw winner notifications:', e.message);
                        }
                    }

                    results.push({
                        contestId: contest._id,
                        name: contest.name,
                        drawn: true,
                        winnersCount: count,
                        winners: newWinners.map(w => w.name)
                    });
                } catch (err) {
                    results.push({ contestId: contest._id, name: contest.name, drawn: false, reason: err.message });
                }
            }
            res.json({
                success: true,
                message: results.some(r => r.drawn) ? 'تم تنفيذ السحب التلقائي للمسابقات المنتهية' : (results.length ? 'لا توجد مسابقات منتهية تحتاج سحباً' : 'تم التحقق، لا توجد مسابقات جديدة للسحب'),
                results
            });
        } catch (error) {
            next(error);
        }
    }
);

// قائمة المسابقات (عامة - للزوار وصفحة المسابقات)
app.get('/api/contests',
    async (req, res, next) => {
        try {
            const contests = await Contest.find().sort({ createdAt: -1 });
            res.json({ success: true, contests });
        } catch (error) {
            next(error);
        }
    }
);

app.post('/api/contests',
    authenticateToken,
    sanitize,
    validators.contest.createContest,
    validate,
    async (req, res, next) => {
        try {
            const contest = new Contest(req.body);
            await contest.save();

            res.status(201).json({ success: true, contest });
        } catch (error) {
            next(error);
        }
    }
);

app.put('/api/contests/:id',
    authenticateToken,
    sanitize,
    validators.contest.updateContest,
    validate,
    async (req, res, next) => {
        try {
            const contest = await Contest.findByIdAndUpdate(
                req.params.id,
                req.body,
                { new: true, runValidators: true }
            );

            if (!contest) {
                return next(new AppError('المسابقة غير موجودة', 404));
            }

            res.json({ success: true, contest });
        } catch (error) {
            next(error);
        }
    }
);

app.delete('/api/contests/:id',
    authenticateToken,
    async (req, res, next) => {
        try {
            const contest = await Contest.findByIdAndDelete(req.params.id);

            if (!contest) {
                return next(new AppError('المسابقة غير موجودة', 404));
            }

            res.json({ success: true, message: 'تم حذف المسابقة بنجاح' });
        } catch (error) {
            next(error);
        }
    }
);

// المشاركة في مسابقة
app.post('/api/contests/:id/participate',
    sanitize,
    async (req, res, next) => {
        try {
            const contest = await Contest.findById(req.params.id);
            if (!contest) {
                return next(new AppError('المسابقة غير موجودة', 404));
            }

            const { name, phone, answers, requirementsStatus, isEligible } = req.body;

            // إضافة المشارك
            await contest.addParticipant({
                name,
                phone,
                answers: answers || [],
                requirementsStatus: requirementsStatus || {
                    followSocial: { verified: false, verificationProof: [] },
                    shareWhatsApp: { verified: false, sharesCount: 0, sharesProof: [] },
                    answerQuestions: { verified: false, correctAnswers: 0 }
                },
                isEligible: isEligible !== undefined ? isEligible : false
            });

            // إذا كان مؤهلاً مباشرة (إضافة يدوية من المالك)، لا نحتاج للتحقق
            let eligibility = { eligible: isEligible || false, reasons: [] };

            if (!isEligible) {
                // التحقق من الأهلية فقط إذا لم يكن مؤهلاً مباشرة
                const participantIndex = contest.participants.length - 1;
                eligibility = contest.checkParticipantEligibility(participantIndex);
            }

            await contest.save();

            res.status(200).json({
                success: true,
                message: eligibility.eligible ? 'تمت المشاركة بنجاح! أنت مؤهل للسحب.' : 'تمت المشاركة، لكن يجب إكمال جميع الشروط',
                eligible: eligibility.eligible,
                reasons: eligibility.reasons || []
            });
        } catch (error) {
            next(error);
        }
    }
);

// التحقق من متابعة الحسابات
app.post('/api/contests/:id/verify-follow',
    sanitize,
    async (req, res, next) => {
        try {
            const contest = await Contest.findById(req.params.id);
            if (!contest) {
                return next(new AppError('المسابقة غير موجودة', 404));
            }

            const { phone, platform, screenshot } = req.body;

            // البحث عن المشارك
            const participant = contest.participants.find(p => p.phone === phone);
            if (!participant) {
                return next(new AppError('لم يتم العثور على مشاركتك', 404));
            }

            // إضافة دليل المتابعة
            if (!participant.requirementsStatus.followSocial.verificationProof) {
                participant.requirementsStatus.followSocial.verificationProof = [];
            }

            participant.requirementsStatus.followSocial.verificationProof.push({
                platform,
                screenshot,
                verifiedAt: new Date()
            });

            // التحقق من الأهلية
            const participantIndex = contest.participants.indexOf(participant);
            const eligibility = contest.checkParticipantEligibility(participantIndex);
            await contest.save();

            res.status(200).json({
                success: true,
                message: 'تم التحقق من المتابعة',
                eligible: eligibility.eligible,
                reasons: eligibility.reasons || []
            });
        } catch (error) {
            next(error);
        }
    }
);

// التحقق من المشاركة على واتساب
app.post('/api/contests/:id/verify-share',
    sanitize,
    async (req, res, next) => {
        try {
            const contest = await Contest.findById(req.params.id);
            if (!contest) {
                return next(new AppError('المسابقة غير موجودة', 404));
            }

            const { phone, screenshot } = req.body;

            // البحث عن المشارك
            const participant = contest.participants.find(p => p.phone === phone);
            if (!participant) {
                return next(new AppError('لم يتم العثور على مشاركتك', 404));
            }

            // زيادة عدد المشاركات
            participant.requirementsStatus.shareWhatsApp.sharesCount =
                (participant.requirementsStatus.shareWhatsApp.sharesCount || 0) + 1;

            if (!participant.requirementsStatus.shareWhatsApp.sharesProof) {
                participant.requirementsStatus.shareWhatsApp.sharesProof = [];
            }

            participant.requirementsStatus.shareWhatsApp.sharesProof.push({
                screenshot,
                sharedAt: new Date()
            });

            // التحقق من الأهلية
            const participantIndex = contest.participants.indexOf(participant);
            const eligibility = contest.checkParticipantEligibility(participantIndex);
            await contest.save();

            res.status(200).json({
                success: true,
                message: 'تم التحقق من المشاركة',
                sharesCount: participant.requirementsStatus.shareWhatsApp.sharesCount,
                eligible: eligibility.eligible,
                reasons: eligibility.reasons || []
            });
        } catch (error) {
            next(error);
        }
    }
);

// عمل سحب عشوائي
app.post('/api/contests/:id/draw',
    authenticateToken,
    async (req, res, next) => {
        try {
            const contest = await Contest.findById(req.params.id);
            if (!contest) {
                return next(new AppError('المسابقة غير موجودة', 404));
            }

            const count = Math.min(parseInt(req.body.count, 10) || contest.winnersCount || 1, 50) || 1;
            const announcementMessage = req.body.announcementMessage;

            // عمل السحب
            await contest.drawWinner(count);

            // قراءة إعدادات المسابقات لتطبيق "نشر النتائج تلقائياً" و "إشعارات الفائزين"
            const contestSettings = await ContestSettings.get();
            const newWinners = contest.winners.slice(-count);

            newWinners.forEach(winner => {
                winner.announced = !!contestSettings.autoPublish;
                if (announcementMessage) {
                    winner.announcementMessage = announcementMessage;
                }
            });
            await contest.save();

            // إذا كان "إشعارات الفائزين" مفعّلاً — إرسال إشعار واتساب للفائزين
            let notificationResult = { sent: 0 };
            if (contestSettings.winnerNotifications && newWinners.length > 0) {
                try {
                    const notificationService = require('./services/notificationService');
                    notificationResult = await notificationService.notifyContestWinners(
                        contest.name,
                        contest.prize || 'جائزة',
                        newWinners
                    );
                } catch (notifErr) {
                    console.warn('Contest winner notifications:', notifErr.message);
                }
            }

            res.status(200).json({
                success: true,
                message: 'تم السحب بنجاح',
                winners: contest.winners.slice(-count),
                winnersNotified: notificationResult.sent || 0
            });
        } catch (error) {
            next(error);
        }
    }
);

// الحصول على الفائزين المعلن عنهم
app.get('/api/contests/winners',
    async (req, res, next) => {
        try {
            // جلب جميع الفائزين (من المسابقات المكتملة)
            const contests = await Contest.find({
                'winners.0': { $exists: true }
            }).sort({ drawDate: -1 }).limit(20);

            const winners = [];
            contests.forEach(contest => {
                contest.winners.forEach(winner => {
                    winners.push({
                        contestName: contest.name,
                        contest: { name: contest.name, prize: contest.prize },
                        ...winner.toObject()
                    });
                });
            });

            res.status(200).json({
                success: true,
                winners
            });
        } catch (error) {
            next(error);
        }
    }
);

// الحصول على مسابقة واحدة بالـ ID (عام - للزوار ولوحة التحكم)
app.get('/api/contests/:id',
    async (req, res, next) => {
        try {
            const contest = await Contest.findById(req.params.id);
            if (!contest) {
                return next(new AppError('المسابقة غير موجودة', 404));
            }
            res.json({ success: true, contest });
        } catch (error) {
            next(error);
        }
    }
);

app.get('/api/did-you-know',
    cacheResponse(600, 'did-you-know:'), // Cache لمدة 10 دقائق
    async (req, res, next) => {
        try {
            const items = await DidYouKnow.find({ active: true }).sort({ createdAt: -1 });
            res.json({ success: true, items });
        } catch (error) {
            next(error);
        }
    });

app.post('/api/did-you-know',
    authenticateToken,
    sanitize,
    validators.didYouKnow.createDidYouKnow,
    validate,
    invalidateCache('did-you-know:*'),
    async (req, res, next) => {
        try {
            const item = new DidYouKnow(req.body);
            await item.save();

            res.status(201).json({ success: true, item });
        } catch (error) {
            next(error);
        }
    }
);

app.put('/api/did-you-know/:id',
    authenticateToken,
    sanitize,
    validators.didYouKnow.updateDidYouKnow,
    validate,
    invalidateCache('did-you-know:*'),
    async (req, res, next) => {
        try {
            const item = await DidYouKnow.findByIdAndUpdate(
                req.params.id,
                req.body,
                { new: true, runValidators: true }
            );

            if (!item) {
                return res.status(404).json({ success: false, message: 'العنصر غير موجود' });
            }

            res.json({ success: true, item });
        } catch (error) {
            next(error);
        }
    }
);

app.delete('/api/did-you-know/:id',
    authenticateToken,
    invalidateCache('did-you-know:*'),
    async (req, res, next) => {
        try {
            const item = await DidYouKnow.findByIdAndDelete(req.params.id);

            if (!item) {
                return res.status(404).json({ success: false, message: 'العنصر غير موجود' });
            }

            res.json({ success: true, message: 'تم حذف العنصر بنجاح' });
        } catch (error) {
            next(error);
        }
    }
);

app.get('/api/stats', authenticateToken, async (req, res, next) => {
    try {
        const totalProducts = await Product.countDocuments();
        const totalOrders = await Order.countDocuments();
        const totalContests = await Contest.countDocuments();

        const monthlyRevenue = await Order.aggregate([
            {
                $match: {
                    createdAt: {
                        $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
                    }
                }
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: '$total' }
                }
            }
        ]);

        res.json({
            totalProducts,
            totalOrders,
            totalContests,
            monthlyRevenue: monthlyRevenue[0]?.total || 0
        });
    } catch (error) {
        next(error);
    }
});

app.post('/api/upload', authenticateToken, upload.single('file'), (req, res, next) => {
    try {
        res.json({
            success: true,
            filename: req.file.filename,
            path: `/uploads/${req.file.filename}`
        });
    } catch (error) {
        next(error);
    }
});

// Upload route for stories (images and videos)
app.post('/api/upload/story', authenticateToken, uploadStory.single('media'), (req, res, next) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'لم يتم رفع أي ملف'
            });
        }

        const isVideo = req.file.mimetype.startsWith('video/');
        const baseUrl = req.protocol + '://' + req.get('host');
        const fileUrl = baseUrl + '/uploads/stories/' + req.file.filename;

        res.json({
            success: true,
            filename: req.file.filename,
            path: `/uploads/stories/${req.file.filename}`,
            url: fileUrl,
            type: isVideo ? 'video' : 'image',
            size: req.file.size,
            mimetype: req.file.mimetype
        });
    } catch (error) {
        next(error);
    }
});

// Upload route for prize images
app.post('/api/upload/prize', authenticateToken, upload.single('image'), (req, res, next) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'لم يتم رفع أي ملف'
            });
        }

        const baseUrl = req.protocol + '://' + req.get('host');
        const fileUrl = baseUrl + '/uploads/' + req.file.filename;

        res.json({
            success: true,
            filename: req.file.filename,
            path: `/uploads/${req.file.filename}`,
            url: fileUrl
        });
    } catch (error) {
        next(error);
    }
});

// ============================================
// FRONTEND ROUTES (مسارات الصفحات - / معرّف أعلى)
// ============================================

// Serve admin and pages as files
app.get('/admin/*', (req, res) => {
    const filePath = path.join(__dirname, 'frontend', req.path);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        res.sendFile(filePath);
    } else {
        res.sendFile(path.join(__dirname, 'frontend', 'admin', 'dashboard.html'));
    }
});

app.get('/pages/*', (req, res) => {
    const filePath = path.join(__dirname, 'frontend', req.path);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        res.sendFile(filePath);
    } else {
        res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
    }
});

// ============================================
// ERROR HANDLING
// ============================================

// Handle 404 - Route not found (must be last)
app.all('*', (req, res, next) => {
    // If it's an API route, return JSON error
    if (req.path.startsWith('/api/')) {
        return next(new AppError(`لا يمكن العثور على ${req.originalUrl} على هذا الخادم`, 404));
    }
    // Otherwise, serve index.html for SPA routing
    res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// Global error handler
app.use(globalErrorHandler);

// ============================================
// INITIALIZE DATA
// ============================================

const initializeData = async () => {
    try {
        // التحقق من حالة الاتصال أولاً
        const mongoose = require('mongoose');
        if (mongoose.connection.readyState !== 1) {
            console.warn('⚠️  قاعدة البيانات غير متصلة - تم تخطي تهيئة البيانات');
            return;
        }

        // Initialize admin user
        const initializeAdmin = require('./utils/initializeAdmin');
        await initializeAdmin();

        // لا نضيف منتجات افتراضية - المستخدم سيضيفها من لوحة التحكم
        // const productCount = await Product.countDocuments();
        // if (productCount === 0) {
        //     // تم إزالة المنتجات الافتراضية - المستخدم سيضيفها من لوحة التحكم
        // }

        // Check if default "Did You Know" items exist
        try {
            const didYouKnowCount = await DidYouKnow.countDocuments();
            if (didYouKnowCount === 0) {
                const defaultItems = [
                    {
                        text: 'أن ملعقة واحدة من عسل "ريف وصاب" على الريق تمد جسمك بالطاقة الطبيعية طوال اليوم وتساعد في تنظيف الجهاز الهضمي بشكل فعال.'
                    },
                    {
                        text: 'أن عسل السدر الأصلي يحتوي على مضادات أكسدة تفوق أي نوع آخر من العسل، مما يجعله أفضل حماية لخلايا الجسم.'
                    },
                    {
                        text: 'أن النحل يطير مسافة تعادل 3 مرات حول الأرض لإنتاج 1 كيلوجرام من العسل الطبيعي.'
                    }
                ];

                await DidYouKnow.insertMany(defaultItems);
                console.log('✅ تم إضافة عناصر "هل تعلم؟" الافتراضية');
            }
        } catch (didYouKnowError) {
            console.warn('⚠️  تحذير: فشل في تهيئة "هل تعلم؟":', didYouKnowError.message);
        }

    } catch (error) {
        console.error('❌ خطأ في تهيئة البيانات:', error.message);
        console.error('Stack:', error.stack?.substring(0, 200));
    }
};

// ============================================
// START SERVER
// ============================================

const startServer = async () => {
    try {
        console.log('🔄 محاولة الاتصال بقاعدة البيانات...');

        // Connect to database
        let dbConnection = null;
        try {
            console.log('📡 استدعاء connectDB()...');
            // إضافة timeout للاتصال (20 ثانية لـ Atlas أو الشبكات البطيئة)
            const connectPromise = connectDB();
            const overallTimeout = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Timeout: استغرق الاتصال أكثر من 20 ثانية')), 20000)
            );

            dbConnection = await Promise.race([connectPromise, overallTimeout]);
            console.log('📡 connectDB() اكتمل');
            if (dbConnection) {
                console.log('✅ تم الاتصال بقاعدة البيانات بنجاح');
            } else {
                console.log('⚠️  connectDB() عاد بـ null - السيرفر سيعمل بدون قاعدة بيانات');
            }
        } catch (dbError) {
            console.warn('⚠️  تحذير: فشل الاتصال بقاعدة البيانات:', dbError.message);
            console.warn('⚠️  الخادم سيعمل بدون قاعدة البيانات (للتطوير فقط)');
            if (dbError.stack && config.nodeEnv === 'development') {
                console.warn('Stack:', dbError.stack.substring(0, 200) + '...');
            }
            dbConnection = null; // تأكد من أن dbConnection = null
        }

        console.log('✅ اكتملت محاولة الاتصال بقاعدة البيانات');

        // Initialize data only if database is connected
        if (dbConnection) {
            try {
                console.log('🔄 بدء تهيئة البيانات...');
                await initializeData();
                console.log('✅ تم تهيئة البيانات بنجاح');
            } catch (initError) {
                console.warn('⚠️  تحذير: فشل في تهيئة البيانات:', initError.message);
                console.warn('Stack:', initError.stack);
            }
        } else {
            console.warn('⚠️  تم تخطي تهيئة البيانات - قاعدة البيانات غير متصلة');
        }

        console.log('✅ جميع الخطوات السابقة اكتملت بنجاح');

        // Initialize backup scheduler (optional - requires node-cron)
        if (config.nodeEnv === 'production' && dbConnection) {
            try {
                console.log('🔄 تهيئة جدولة النسخ الاحتياطي...');
                const cron = require('node-cron');
                const { scheduleBackups } = require('./scripts/backup-schedule');
                scheduleBackups();
                console.log('✅ تم تهيئة جدولة النسخ الاحتياطي');
            } catch (error) {
                console.warn('⚠️  جدولة النسخ الاحتياطي غير متاحة:', error.message);
                logger.warn('Backup scheduler not available (node-cron may not be installed):', error.message);
            }
        }

        // Start server - تأكد من الوصول إلى هنا
        console.log('🔍 الوصول إلى بدء تشغيل الخادم...');
        console.log(`🚀 بدء تشغيل الخادم على المنفذ ${config.port}...`);
        console.log(`📁 مجلد frontend: ${path.join(__dirname, 'frontend')}`);
        console.log(`📄 index.html موجود: ${fs.existsSync(path.join(__dirname, 'frontend', 'index.html'))}`);
        console.log(`🌐 المنفذ: ${config.port}`);

        const server = app.listen(config.port, () => {
            logger.info('Server started successfully', {
                port: config.port,
                environment: config.nodeEnv,
                timestamp: new Date().toISOString()
            });

            console.log('\n🚀 ============================================');
            console.log(`✅ الخادم يعمل على المنفذ ${config.port}`);
            console.log(`🌐 الصفحة الرئيسية: http://localhost:${config.port}`);
            console.log(`📡 API متاح على http://localhost:${config.port}/api`);
            console.log(`🌍 البيئة: ${config.nodeEnv}`);
            if (!dbConnection) {
                console.log(`⚠️  قاعدة البيانات: غير متصلة (وضع التطوير)`);
            } else {
                console.log(`📊 قاعدة البيانات: متصلة`);
            }
            console.log(`📝 السجلات: logs/`);
            console.log('============================================\n');
        });

        // معالجة أخطاء الخادم
        server.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                console.error(`❌ المنفذ ${config.port} مستخدم بالفعل!`);
                console.error('💡 جرب تغيير المنفذ في ملف .env أو أوقف الخادم الآخر');
            } else {
                console.error('❌ خطأ في الخادم:', error);
            }
        });
    } catch (error) {
        console.error('❌ فشل في بدء الخادم:', error);
        console.error('Stack trace:', error.stack);
        // في بيئة التطوير، لا نوقف الخادم
        if (config.nodeEnv === 'development') {
            console.warn('⚠️  محاولة تشغيل الخادم بدون قاعدة البيانات...');
            app.listen(config.port, () => {
                console.log(`\n✅ الخادم يعمل على المنفذ ${config.port} (بدون قاعدة بيانات)`);
                console.log(`🌐 الصفحة الرئيسية: http://localhost:${config.port}\n`);
            });
        } else {
            process.exit(1);
        }
    }
};

// Start the server
console.log('🔍 بدء تشغيل الخادم...');
console.log('📁 المسار الحالي:', __dirname);
console.log('📄 ملف index.html:', path.join(__dirname, 'frontend', 'index.html'));
console.log('✅ Express app initialized');
console.log('🔄 استدعاء startServer()...');
console.log('⏱️  سيتم محاولة الاتصال بقاعدة البيانات...');
console.log('📝 سيتم تشغيل السيرفر حتى لو فشل الاتصال (وضع التطوير)');

try {
    startServer().then(() => {
        console.log('✅ startServer() اكتمل بنجاح');
    }).catch((error) => {
        console.error('❌ خطأ غير متوقع في startServer:', error);
        console.error('Message:', error.message);
        if (error.stack) {
            console.error('Stack:', error.stack.substring(0, 300));
        }
        // في بيئة التطوير، حاول تشغيل الخادم بدون قاعدة بيانات
        if (config.nodeEnv === 'development') {
            console.log('🔄 محاولة تشغيل الخادم بدون قاعدة بيانات...');
            try {
                app.listen(config.port, '0.0.0.0', () => {
                    console.log(`\n✅ الخادم يعمل على المنفذ ${config.port} (بدون قاعدة بيانات)`);
                    console.log(`🌐 الصفحة الرئيسية: http://localhost:${config.port}\n`);
                });
            } catch (listenError) {
                console.error('❌ فشل في تشغيل الخادم:', listenError.message);
                if (listenError.stack) {
                    console.error('Stack:', listenError.stack.substring(0, 300));
                }
            }
        } else {
            process.exit(1);
        }
    });
} catch (syncError) {
    console.error('❌ خطأ متزامن في استدعاء startServer:', syncError.message);
    if (syncError.stack) {
        console.error('Stack:', syncError.stack.substring(0, 300));
    }
    // في التطوير، حاول تشغيل الخادم
    if (config.nodeEnv === 'development') {
        console.log('🔄 محاولة تشغيل الخادم بدون قاعدة بيانات...');
        app.listen(config.port, '0.0.0.0', () => {
            console.log(`\n✅ الخادم يعمل على المنفذ ${config.port} (بدون قاعدة بيانات)`);
            console.log(`🌐 الصفحة الرئيسية: http://localhost:${config.port}\n`);
        });
    }
}

// Graceful shutdown
process.on('SIGINT', async () => {
    logger.info('SIGINT received, shutting down gracefully');
    console.log('\n🛑 إغلاق الخادم...');
    const mongoose = require('mongoose');
    await mongoose.connection.close();
    logger.info('Database connection closed');
    console.log('✅ تم إغلاق الاتصال بقاعدة البيانات');
    process.exit(0);
});

process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down gracefully');
    console.log('\n🛑 إغلاق الخادم...');
    const mongoose = require('mongoose');
    await mongoose.connection.close();
    logger.info('Database connection closed');
    console.log('✅ تم إغلاق الاتصال بقاعدة البيانات');
    process.exit(0);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
    logger.error('UNHANDLED REJECTION!', err);
    console.error('⚠️  UNHANDLED REJECTION:', err.message);
    console.error('Stack:', err.stack);

    // في بيئة التطوير، لا نوقف الخادم
    if (config.nodeEnv === 'development') {
        console.warn('⚠️  الخادم يستمر في العمل (وضع التطوير)');
        return;
    }

    // في الإنتاج، نوقف الخادم
    console.error('❌ إيقاف الخادم بسبب خطأ غير معالج');
    process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    logger.error('UNCAUGHT EXCEPTION!', err);
    console.error('⚠️  UNCAUGHT EXCEPTION:', err.message);
    console.error('Stack:', err.stack);

    // في بيئة التطوير، لا نوقف الخادم
    if (config.nodeEnv === 'development') {
        console.warn('⚠️  الخادم يستمر في العمل (وضع التطوير)');
        return;
    }

    // في الإنتاج، نوقف الخادم
    console.error('❌ إيقاف الخادم بسبب خطأ غير معالج');
    process.exit(1);
});

module.exports = app;

