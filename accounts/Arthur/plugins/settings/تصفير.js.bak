// ══════════════════════════════════════════════════════════════
//  تصفير.js — مسح جميع جلسات نظام.js النشطة
//  يعمل كأمر مستقل خارج نظام القوائم
// ══════════════════════════════════════════════════════════════

// normalizeJid — نفس messages.js بالضبط
const normalizeJid = jid =>
    jid ? jid.split('@')[0].split(':')[0].replace(/\D/g, '') : '';

const NovaUltra = {
    command:     'تصفير',
    description: 'مسح جميع جلسات نظام.js النشطة من الذاكرة',
    elite:       'on',
    group:       false,
    prv:         false,
    lock:        'off',
};

async function execute({ sock, msg, sender, BIDS }) {
    const chatId    = msg.key.remoteJid;
    const senderJid = sender?.pn || msg.key.participant || chatId;

    // ── فحص الصلاحية: مالك البوت فقط ──────────────────────
    const ownerNum  = normalizeJid(global._botConfig?.owner || '');
    const senderNum = normalizeJid(senderJid);
    const isOwner   = msg.key.fromMe || (ownerNum && senderNum === ownerNum);

    if (!isOwner) {
        await sock.sendMessage(chatId, {
            react: { text: '🚫', key: msg.key },
        }).catch(() => {});
        return;
    }

    // ── جلب activeSessions من global ──────────────────────
    // نظام.js يخزّنها في const activeSessions = new Map()
    // ليست global مباشرة — نصل إليها عبر الـ module scope
    // الحل: نظام.js يُصدّر Map reference عبر global._activeSessions
    const sessions = global._activeSessions;

    if (!sessions || typeof sessions.size === 'undefined') {
        await sock.sendMessage(chatId, {
            text: '⚠️ ما وجدت جلسات — تأكد أن نظام.js يُصدّر:\n`global._activeSessions = activeSessions;`',
        }, { quoted: msg });
        return;
    }

    const count = sessions.size;

    if (count === 0) {
        await sock.sendMessage(chatId, {
            text: '✅ لا توجد جلسات نشطة حالياً.',
        }, { quoted: msg });
        return;
    }

    // ── تنظيف جميع الجلسات ──────────────────────────────
    let cleaned = 0;
    for (const [id, session] of sessions) {
        try {
            // إيقاف المؤقت
            if (session.timeout) clearTimeout(session.timeout);

            // تشغيل دالة cleanup لإزالة listener
            if (typeof session.cleanupFn === 'function') session.cleanupFn();
            else if (typeof session.cleanup === 'function') session.cleanup();

            sessions.delete(id);
            cleaned++;
        } catch (e) {
            // تجاهل الأخطاء الفردية وكمّل
            sessions.delete(id);
            cleaned++;
        }
    }

    // ── تأكيد ──────────────────────────────────────────
    await sock.sendMessage(chatId, {
        react: { text: '✔️', key: msg.key },
    }).catch(() => {});

    await sock.sendMessage(chatId, {
        text: `🧹 *تم تنظيف الذاكرة*\n\n✔️ جلسات مُسحت: *${cleaned}/${count}*\n✔️ الجلسات النشطة الآن: *${sessions.size}*`,
    }, { quoted: msg });
}

export default { NovaUltra, execute };
