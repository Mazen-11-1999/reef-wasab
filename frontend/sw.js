/**
 * Service Worker for Push Notifications
 * يعمل حتى بدون إنترنت
 */

const CACHE_NAME = 'manahl-badr-v1';
const NOTIFICATION_CACHE = 'notifications-v1';

// تثبيت Service Worker
self.addEventListener('install', (event) => {
    console.log('[Service Worker] Installing...');
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[Service Worker] Caching app shell');
            return cache.addAll([
                '/',
                '/index.html',
                '/pages/notifications.html'
            ]);
        })
    );
    self.skipWaiting();
});

// تفعيل Service Worker
self.addEventListener('activate', (event) => {
    console.log('[Service Worker] Activating...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME && cacheName !== NOTIFICATION_CACHE) {
                        console.log('[Service Worker] Removing old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    return self.clients.claim();
});

// استقبال Push Notifications
self.addEventListener('push', (event) => {
    console.log('[Service Worker] Push notification received');

    let notificationData = {
        title: 'مناحل ريف وصاب',
        body: 'لديك إشعار جديد',
        icon: '/assets/manahel.jpg',
        badge: '/assets/manahel.jpg',
        tag: 'notification',
        requireInteraction: false,
        data: {}
    };

    // إذا كانت البيانات موجودة في الحدث
    if (event.data) {
        try {
            const data = event.data.json();
            notificationData = {
                title: data.title || notificationData.title,
                body: data.message || data.body || notificationData.body,
                icon: data.icon || notificationData.icon,
                badge: data.badge || notificationData.badge,
                tag: data.tag || notificationData.tag,
                requireInteraction: data.requireInteraction || false,
                data: data.data || {},
                actions: data.actions || []
            };
        } catch (e) {
            notificationData.body = event.data.text();
        }
    }

    // حفظ الإشعار في IndexedDB للعمل بدون إنترنت
    event.waitUntil(
        saveNotificationToCache(notificationData).then(() => {
            return self.registration.showNotification(notificationData.title, {
                body: notificationData.body,
                icon: notificationData.icon,
                badge: notificationData.badge,
                tag: notificationData.tag,
                requireInteraction: notificationData.requireInteraction,
                data: notificationData.data,
                actions: notificationData.actions,
                vibrate: [200, 100, 200],
                timestamp: Date.now()
            });
        })
    );
});

// النقر على الإشعار
self.addEventListener('notificationclick', (event) => {
    console.log('[Service Worker] Notification clicked');

    event.notification.close();

    const notificationData = event.notification.data;
    const urlToOpen = notificationData.url || '/pages/notifications.html';

    event.waitUntil(
        clients.matchAll({
            type: 'window',
            includeUncontrolled: true
        }).then((clientList) => {
            // إذا كان التطبيق مفتوحاً، انتقل إلى الصفحة
            for (let i = 0; i < clientList.length; i++) {
                const client = clientList[i];
                if (client.url === urlToOpen && 'focus' in client) {
                    return client.focus();
                }
            }
            // إذا لم يكن مفتوحاً، افتح نافذة جديدة
            if (clients.openWindow) {
                return clients.openWindow(urlToOpen);
            }
        })
    );
});

// معالجة الإجراءات (Actions) في الإشعار
self.addEventListener('notificationclose', (event) => {
    console.log('[Service Worker] Notification closed');
});

// حفظ الإشعار في IndexedDB
async function saveNotificationToCache(notificationData) {
    try {
        const db = await openNotificationDB();
        const transaction = db.transaction(['notifications'], 'readwrite');
        const store = transaction.objectStore('notifications');

        await store.add({
            ...notificationData,
            id: Date.now(),
            timestamp: Date.now(),
            read: false
        });

        console.log('[Service Worker] Notification saved to cache');
    } catch (error) {
        console.error('[Service Worker] Error saving notification:', error);
    }
}

// فتح IndexedDB
function openNotificationDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('NotificationsDB', 1);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('notifications')) {
                const store = db.createObjectStore('notifications', { keyPath: 'id', autoIncrement: true });
                store.createIndex('timestamp', 'timestamp', { unique: false });
                store.createIndex('read', 'read', { unique: false });
            }
        };
    });
}

// معالجة الطلبات (للعمل بدون إنترنت)
self.addEventListener('fetch', (event) => {
    // فقط للصفحات المهمة
    if (event.request.url.includes('/api/notifications')) {
        event.respondWith(
            fetch(event.request).catch(() => {
                // إذا فشل الاتصال، استخدم البيانات المحفوظة
                return caches.match(event.request).then((response) => {
                    if (response) {
                        return response;
                    }
                    // إرجاع إشعارات محفوظة من IndexedDB
                    return getCachedNotifications();
                });
            })
        );
    }
});

// الحصول على الإشعارات المحفوظة
async function getCachedNotifications() {
    try {
        const db = await openNotificationDB();
        const transaction = db.transaction(['notifications'], 'readonly');
        const store = transaction.objectStore('notifications');
        const index = store.index('timestamp');
        const request = index.getAll();

        return new Promise((resolve) => {
            request.onsuccess = () => {
                const notifications = request.result.reverse(); // الأحدث أولاً
                resolve(new Response(JSON.stringify({
                    success: true,
                    notifications: notifications
                }), {
                    headers: { 'Content-Type': 'application/json' }
                }));
            };
            request.onerror = () => {
                resolve(new Response(JSON.stringify({
                    success: true,
                    notifications: []
                }), {
                    headers: { 'Content-Type': 'application/json' }
                }));
            };
        });
    } catch (error) {
        console.error('[Service Worker] Error getting cached notifications:', error);
        return new Response(JSON.stringify({
            success: true,
            notifications: []
        }), {
            headers: { 'Content-Type': 'application/json' }
        });
    }
}










