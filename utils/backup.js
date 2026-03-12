/**
 * Backup Utility
 * نظام النسخ الاحتياطي لقاعدة البيانات والملفات
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const config = require('../config/env');
const logger = require('./logger');

const execAsync = promisify(exec);

// مجلد النسخ الاحتياطي
// التحقق من بيئة Vercel
const isVercel = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';

// في Vercel، لا نستخدم مجلد backups
let BACKUP_DIR, DB_BACKUP_DIR, FILES_BACKUP_DIR;
if (!isVercel) {
    BACKUP_DIR = path.join(__dirname, '..', 'backups');
    DB_BACKUP_DIR = path.join(BACKUP_DIR, 'database');
    FILES_BACKUP_DIR = path.join(BACKUP_DIR, 'files');

    // إنشاء المجلدات إذا لم تكن موجودة
    if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
    if (!fs.existsSync(DB_BACKUP_DIR)) {
        fs.mkdirSync(DB_BACKUP_DIR, { recursive: true });
    }
    if (!fs.existsSync(FILES_BACKUP_DIR)) {
        fs.mkdirSync(FILES_BACKUP_DIR, { recursive: true });
    }
}

/**
 * النسخ الاحتياطي لقاعدة البيانات MongoDB
 */
const backupDatabase = async () => {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupName = `mongodb-backup-${timestamp}`;
        const backupPath = path.join(DB_BACKUP_DIR, backupName);

        // استخراج معلومات الاتصال من URI
        const uri = config.mongodbUri;
        const dbName = uri.split('/').pop().split('?')[0];

        // بناء أمر mongodump
        let mongodumpCmd = `mongodump --db ${dbName} --out "${backupPath}"`;

        // إذا كان URI يحتوي على معلومات الاتصال
        if (uri.includes('@')) {
            const match = uri.match(/mongodb:\/\/([^:]+):([^@]+)@([^\/]+)\/(.+)/);
            if (match) {
                const [, username, password, host, database] = match;
                mongodumpCmd = `mongodump --host ${host} --username ${username} --password ${password} --db ${database} --out "${backupPath}" --authenticationDatabase admin`;
            }
        } else if (uri.includes('localhost') || uri.includes('127.0.0.1')) {
            // اتصال محلي
            mongodumpCmd = `mongodump --db ${dbName} --out "${backupPath}"`;
        }

        logger.info(`Starting database backup: ${backupName}`);

        const { stdout, stderr } = await execAsync(mongodumpCmd);

        if (stderr && !stderr.includes('writing')) {
            throw new Error(stderr);
        }

        // ضغط النسخة الاحتياطية
        const zipPath = `${backupPath}.tar.gz`;
        await execAsync(`tar -czf "${zipPath}" -C "${DB_BACKUP_DIR}" "${backupName}"`);

        // حذف المجلد غير المضغوط
        fs.rmSync(backupPath, { recursive: true, force: true });

        const stats = fs.statSync(zipPath);
        const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

        logger.info(`✅ Database backup completed: ${backupName}.tar.gz (${sizeMB} MB)`);

        // حذف النسخ القديمة (الاحتفاظ بآخر 10 نسخ)
        await cleanupOldBackups(DB_BACKUP_DIR, 10);

        return {
            success: true,
            filename: `${backupName}.tar.gz`,
            path: zipPath,
            size: stats.size,
            sizeMB: parseFloat(sizeMB),
            timestamp: new Date()
        };
    } catch (error) {
        logger.error('❌ Database backup failed:', error);
        throw error;
    }
};

/**
 * النسخ الاحتياطي للملفات المهمة
 */
const backupFiles = async () => {
    try {
        // التحقق من بيئة Vercel
        if (isVercel) {
            logger.info('Backup files not available in Vercel environment');
            return { success: false, message: 'Backup not available in production' };
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupName = `files-backup-${timestamp}`;
        const backupPath = path.join(FILES_BACKUP_DIR, backupName);

        fs.mkdirSync(backupPath, { recursive: true });

        // الملفات والمجلدات المهمة للنسخ
        const importantPaths = [
            { src: 'uploads', dest: 'uploads' },
            { src: 'logs', dest: 'logs' },
            { src: '.env', dest: '.env' },
            { src: 'config', dest: 'config' }
        ];

        logger.info(`Starting files backup: ${backupName}`);

        for (const item of importantPaths) {
            const srcPath = path.join(__dirname, '..', item.src);
            const destPath = path.join(backupPath, item.dest);

            if (fs.existsSync(srcPath)) {
                if (fs.statSync(srcPath).isDirectory()) {
                    // نسخ مجلد
                    await execAsync(`xcopy /E /I /Y "${srcPath}" "${destPath}"`);
                } else {
                    // نسخ ملف
                    fs.copyFileSync(srcPath, destPath);
                }
                logger.info(`✅ Backed up: ${item.src}`);
            }
        }

        // ضغط النسخة الاحتياطية
        const zipPath = `${backupPath}.tar.gz`;
        await execAsync(`tar -czf "${zipPath}" -C "${FILES_BACKUP_DIR}" "${backupName}"`);

        // حذف المجلد غير المضغوط
        fs.rmSync(backupPath, { recursive: true, force: true });

        const stats = fs.statSync(zipPath);
        const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

        logger.info(`✅ Files backup completed: ${backupName}.tar.gz (${sizeMB} MB)`);

        // حذف النسخ القديمة (الاحتفاظ بآخر 5 نسخ)
        await cleanupOldBackups(FILES_BACKUP_DIR, 5);

        return {
            success: true,
            filename: `${backupName}.tar.gz`,
            path: zipPath,
            size: stats.size,
            sizeMB: parseFloat(sizeMB),
            timestamp: new Date()
        };
    } catch (error) {
        logger.error('❌ Files backup failed:', error);
        throw error;
    }
};

/**
 * النسخ الاحتياطي الكامل (قاعدة البيانات + الملفات)
 */
const backupAll = async () => {
    try {
        logger.info('🔄 Starting full backup...');

        const dbBackup = await backupDatabase();
        const filesBackup = await backupFiles();

        logger.info('✅ Full backup completed successfully');

        return {
            success: true,
            database: dbBackup,
            files: filesBackup,
            timestamp: new Date()
        };
    } catch (error) {
        logger.error('❌ Full backup failed:', error);
        throw error;
    }
};

/**
 * حذف النسخ القديمة
 */
const cleanupOldBackups = async (backupDir, keepCount = 10) => {
    try {
        const files = fs.readdirSync(backupDir)
            .filter(file => file.endsWith('.tar.gz'))
            .map(file => ({
                name: file,
                path: path.join(backupDir, file),
                time: fs.statSync(path.join(backupDir, file)).mtime.getTime()
            }))
            .sort((a, b) => b.time - a.time); // الأحدث أولاً

        // حذف النسخ الزائدة
        if (files.length > keepCount) {
            const toDelete = files.slice(keepCount);
            for (const file of toDelete) {
                fs.unlinkSync(file.path);
                logger.info(`🗑️  Deleted old backup: ${file.name}`);
            }
        }
    } catch (error) {
        logger.error('Error cleaning up old backups:', error);
    }
};

/**
 * قائمة النسخ الاحتياطية
 */
const listBackups = (type = 'all') => {
    try {
        const backups = {
            database: [],
            files: []
        };

        if (type === 'all' || type === 'database') {
            const dbFiles = fs.readdirSync(DB_BACKUP_DIR)
                .filter(file => file.endsWith('.tar.gz'))
                .map(file => {
                    const filePath = path.join(DB_BACKUP_DIR, file);
                    const stats = fs.statSync(filePath);
                    return {
                        name: file,
                        path: filePath,
                        size: stats.size,
                        sizeMB: (stats.size / (1024 * 1024)).toFixed(2),
                        created: stats.birthtime,
                        modified: stats.mtime
                    };
                })
                .sort((a, b) => b.modified - a.modified);

            backups.database = dbFiles;
        }

        if (type === 'all' || type === 'files') {
            const fileBackups = fs.readdirSync(FILES_BACKUP_DIR)
                .filter(file => file.endsWith('.tar.gz'))
                .map(file => {
                    const filePath = path.join(FILES_BACKUP_DIR, file);
                    const stats = fs.statSync(filePath);
                    return {
                        name: file,
                        path: filePath,
                        size: stats.size,
                        sizeMB: (stats.size / (1024 * 1024)).toFixed(2),
                        created: stats.birthtime,
                        modified: stats.mtime
                    };
                })
                .sort((a, b) => b.modified - a.modified);

            backups.files = fileBackups;
        }

        return backups;
    } catch (error) {
        logger.error('Error listing backups:', error);
        return { database: [], files: [] };
    }
};

/**
 * استعادة قاعدة البيانات من نسخة احتياطية
 */
const restoreDatabase = async (backupFilename) => {
    try {
        const backupPath = path.join(DB_BACKUP_DIR, backupFilename);

        if (!fs.existsSync(backupPath)) {
            throw new Error(`Backup file not found: ${backupFilename}`);
        }

        logger.info(`Starting database restore from: ${backupFilename}`);

        // فك الضغط
        const extractPath = backupPath.replace('.tar.gz', '');
        await execAsync(`tar -xzf "${backupPath}" -C "${DB_BACKUP_DIR}"`);

        // استخراج اسم قاعدة البيانات من المجلد المستخرج
        const extractedDirs = fs.readdirSync(DB_BACKUP_DIR)
            .filter(dir => dir.startsWith('mongodb-backup-') && !dir.endsWith('.tar.gz'));

        if (extractedDirs.length === 0) {
            throw new Error('No database directory found in backup');
        }

        const dbDir = path.join(DB_BACKUP_DIR, extractedDirs[0]);
        const dbName = fs.readdirSync(dbDir)[0];
        const dbPath = path.join(dbDir, dbName);

        // استعادة قاعدة البيانات
        const uri = config.mongodbUri;
        let mongorestoreCmd = `mongorestore --db ${dbName} "${dbPath}" --drop`;

        if (uri.includes('@')) {
            const match = uri.match(/mongodb:\/\/([^:]+):([^@]+)@([^\/]+)\/(.+)/);
            if (match) {
                const [, username, password, host, database] = match;
                mongorestoreCmd = `mongorestore --host ${host} --username ${username} --password ${password} --db ${database} "${dbPath}" --drop --authenticationDatabase admin`;
            }
        }

        const { stdout, stderr } = await execAsync(mongorestoreCmd);

        if (stderr && !stderr.includes('restoring')) {
            throw new Error(stderr);
        }

        // حذف المجلد المستخرج
        fs.rmSync(dbDir, { recursive: true, force: true });

        logger.info(`✅ Database restored successfully from: ${backupFilename}`);

        return {
            success: true,
            message: 'Database restored successfully',
            timestamp: new Date()
        };
    } catch (error) {
        logger.error('❌ Database restore failed:', error);
        throw error;
    }
};

/**
 * الحصول على إحصائيات النسخ الاحتياطية
 */
const getBackupStats = () => {
    try {
        const dbBackups = listBackups('database');
        const fileBackups = listBackups('files');

        const totalDbSize = dbBackups.database.reduce((sum, b) => sum + b.size, 0);
        const totalFilesSize = fileBackups.files.reduce((sum, b) => sum + b.size, 0);

        return {
            database: {
                count: dbBackups.database.length,
                totalSize: totalDbSize,
                totalSizeMB: (totalDbSize / (1024 * 1024)).toFixed(2),
                latest: dbBackups.database[0] || null
            },
            files: {
                count: fileBackups.files.length,
                totalSize: totalFilesSize,
                totalSizeMB: (totalFilesSize / (1024 * 1024)).toFixed(2),
                latest: fileBackups.files[0] || null
            },
            totalSizeMB: ((totalDbSize + totalFilesSize) / (1024 * 1024)).toFixed(2)
        };
    } catch (error) {
        logger.error('Error getting backup stats:', error);
        return null;
    }
};

module.exports = {
    backupDatabase,
    backupFiles,
    backupAll,
    restoreDatabase,
    listBackups,
    getBackupStats,
    cleanupOldBackups,
    BACKUP_DIR,
    DB_BACKUP_DIR,
    FILES_BACKUP_DIR
};




















