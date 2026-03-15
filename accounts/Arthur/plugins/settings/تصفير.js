// ══════════════════════════════════════════════════════════════
//  تصفير.js — مسح جميع جلسات نظام.js النشطة (نسخة متوافقة مع نظام 4-1)
// ══════════════════════════════════════════════════════════════

const normalizeJid = jid => 
    jid ? jid.split('@')[0].split(':')[0].replace(/\D/g, '') : '';

const NovaUltra = {
    command:     'تصفير',
    description: 'مسح جميع جلسات نظام.js النشطة من الذاكرة',
    elite:       'on', // متاح للنخبة/المطور فقط
    group:       false,
    prv:         false,
    lock:        'off',
};

async function execute({ sock, msg, sender }) {
    const chatId    = msg.key.remoteJid;
    const senderJid = msg.key.participant || chatId;

    // ── فحص الصلاحية: المطور فقط ──────────────────────
    const ownerNum  = normalizeJid(global._botConfig?.owner || '');
    const senderNum = normalizeJid(senderJid);
    const isOwner   = msg.key.fromMe || (ownerNum && senderNum === ownerNum);

    if (!isOwner) {
        await sock.sendMessage(chatId, { react: { text: '🚫', key: msg.key } }).catch(() => {});
        return;
    }

    // ── جلب الجلسات من global.activeSessions ───────────
    const sessions = global.activeSessions;

    if (!sessions || typeof sessions.size === 'undefined') {
        await sock.sendMessage(chatId, {
            text: '⚠️ لم يتم العثور على حاوية الجلسات في الذاكرة (global.activeSessions).',
        }, { quoted: msg });
        return;
    }

    const count = sessions.size;

    if (count === 0) {
        await sock.sendMessage(chatId, {
            text: '✅ لا توجد جلسات نشطة حالياً لتصفيرها.',
        }, { quoted: msg });
        return;
    }

    // ── تنظيف الذاكرة ──────────────────────────────────
    let cleaned = 0;
    for (const [id, session] of sessions) {
        try {
            // إيقاف مؤقت الجلسة لمنع التنفيذ اللاحق
            if (session.timeout) clearTimeout(session.timeout);

            // إزالة الـ listener الخاص بـ messages.upsert
            if (session.listener) sock.ev.off('messages.upsert', session.listener);

            // تشغيل دالة التنظيف الإضافية إن وجدت
            if (typeof session.cleanupFn === 'function') session.cleanupFn();

            sessions.delete(id);
            cleaned++;
        } catch (e) {
            sessions.delete(id);
            cleaned++;
        }
    }

    // ── تأكيد النجاح ──────────────────────────────────
    await sock.sendMessage(chatId, { react: { text: '☑️', key: msg.key } }).catch(() => {});

    await sock.sendMessage(chatId, {
        text: `🧹 *تم تنظيف الذاكرة بنجاح*\n\n✔️ الجلسات الممسوحة: *${cleaned}*\n🔄 الحالة: الذاكرة فارغة الآن.`,
    }, { quoted: msg });
}

export default { NovaUltra, execute };
