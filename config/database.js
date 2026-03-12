/**
 * Database Configuration
 * إعدادات اتصال قاعدة البيانات MongoDB
 */

const mongoose = require('mongoose');
const config = require('./env');

// تحسينات الاتصال (تدعم عدداً كبيراً من المستخدمين)
const connectionOptions = {
    maxPoolSize: 2, // تقليل حجم التجمع للبيئة Serverless
    serverSelectionTimeoutMS: 10000, // 10 ثوانٍ للاتصال (مثلاً Atlas)
    socketTimeoutMS: 60000, // 60 ثانية قبل إغلاق المقبس الخامل
    family: 4,
    bufferCommands: false
};

// معالجة الأخطاء
mongoose.connection.on('error', (err) => {
    console.error('❌ خطأ في اتصال MongoDB:', err);
});

mongoose.connection.on('disconnected', () => {
    console.warn('⚠️  تم قطع الاتصال من MongoDB');
});

mongoose.connection.on('connected', () => {
    console.log('✅ تم الاتصال بنجاح إلى MongoDB');
    console.log(`📊 قاعدة البيانات: ${mongoose.connection.name}`);
});

// معالجة إغلاق التطبيق
process.on('SIGINT', async () => {
    await mongoose.connection.close();
    console.log('🔌 تم إغلاق اتصال MongoDB بسبب إغلاق التطبيق');
    process.exit(0);
});

/**
 * الاتصال بقاعدة البيانات
 */
const connectDB = async () => {
    try {
        console.log('🔄 محاولة الاتصال بـ MongoDB...');
        console.log('⏱️  مهلة الاتصال: 15 ثانية...');

        // محاولة تحميل databaseOptimization بشكل آمن
        let dbOptimization;
        try {
            dbOptimization = require('./databaseOptimization');
        } catch (optError) {
            console.warn('⚠️  databaseOptimization غير متاح:', optError.message);
            dbOptimization = {
                optimizeConnection: () => ({}),
                createIndexes: async () => { }
            };
        }

        const optimizedOptions = { ...connectionOptions, ...dbOptimization.optimizeConnection() };

        // إزالة bufferMaxEntries إذا كان موجوداً (غير مدعوم في MongoDB الحديث)
        delete optimizedOptions.bufferMaxEntries;

        // ضبط timeout حسب البيئة (تطوير / إنتاج)
        if (config.nodeEnv === 'development') {
            optimizedOptions.serverSelectionTimeoutMS = 20000;
            optimizedOptions.connectTimeoutMS = 20000;
        } else {
            optimizedOptions.serverSelectionTimeoutMS = 15000; // إنتاج: 15 ثانية
            optimizedOptions.connectTimeoutMS = 15000;
        }

        console.log('📡 بدء الاتصال بـ MongoDB...');

        // في بيئة التطوير، استخدم الاتصال العادي بدون Promise.race إضافي
        if (config.nodeEnv === 'development') {
            await mongoose.connect(config.mongodbUri, optimizedOptions);
            // انتظار قصير للتحقق من حالة الاتصال
            await new Promise(resolve => setTimeout(resolve, 100));

            // التحقق من حالة الاتصال قبل طباعة الرسالة
            if (mongoose.connection.readyState === 1) {
                console.log('✅ اتصال MongoDB ناجح');
            } else {
                throw new Error('الاتصال فشل - readyState: ' + mongoose.connection.readyState);
            }
        } else {
            // في الإنتاج، استخدم الاتصال العادي
            await mongoose.connect(config.mongodbUri, optimizedOptions);
            if (mongoose.connection.readyState === 1) {
                console.log('✅ اتصال MongoDB ناجح');
            } else {
                throw new Error('الاتصال فشل - readyState: ' + mongoose.connection.readyState);
            }
        }

        // إنشاء Indexes بعد الاتصال (فقط إذا كان الاتصال ناجح)
        if (mongoose.connection.readyState === 1 && config.nodeEnv !== 'test') {
            setTimeout(async () => {
                try {
                    await dbOptimization.createIndexes();
                } catch (indexError) {
                    console.warn('⚠️  تحذير: فشل في إنشاء Indexes:', indexError.message);
                }
            }, 2000); // انتظار 2 ثانية لضمان اكتمال الاتصال
        }

        // إرجاع الاتصال فقط إذا كان متصلاً
        if (mongoose.connection.readyState === 1) {
            return mongoose.connection;
        } else {
            return null;
        }
    } catch (error) {
        // في بيئة التطوير، لا نوقف الخادم إذا فشل الاتصال
        if (config.nodeEnv === 'development') {
            console.warn('⚠️  فشل الاتصال بقاعدة البيانات:', error.message);
            console.warn('⚠️  الخادم سيعمل بدون قاعدة بيانات (للتطوير فقط)');
            console.warn('⚠️  بعض الميزات قد لا تعمل بشكل صحيح');
            console.warn('💡 تأكد من تشغيل MongoDB على: mongodb://localhost:27017/manahl-badr');
            console.warn('💡 أو استخدم MongoDB Atlas أو Docker');
            // في بيئة التطوير، نعيد null بدلاً من رمي الخطأ
            return null;
        }

        // في الإنتاج، نوقف الخادم
        console.error('❌ فشل الاتصال بقاعدة البيانات:', error.message);
        console.error('❌ لا يمكن تشغيل الخادم بدون قاعدة البيانات في بيئة الإنتاج');
        process.exit(1);
    }
};

module.exports = { connectDB, mongoose };
