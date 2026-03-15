import configImport from '../nova/config.js';
// ══════════════════════════════════════════════════════════════
//  تصفير.js — مسح جميع جلسات نظام.js النشطة
// ══════════════════════════════════════════════════════════════

const NovaUltra = {
    command:     'تصفير',
    description: 'مسح جميع جلسات نظام.js النشطة من الذاكرة',
    elite:       'on',
    group:       false,
    prv:         false,
    lock:        'off',
};

const _norm = jid => jid ? jid.split('@')[0].split(':')[0].replace(/\D/g, '') : '';

async function execute({ sock, msg }) {
    const chatId    = msg.key.remoteJid;
    const senderJid = msg.key.participant || chatId;

    // ── الأونر فقط ──────────────────────────────────────────
    const ownerNum  = (global._botConfig?.owner || configImport?.owner || '213540419314').toString().replace(/\D/g, '');
    const senderNum = _norm(senderJid);
    const isOwner   = msg.key.fromMe || senderNum === ownerNum;

    if (!isOwner) {
        await sock.sendMessage(chatId, { react: { text: '🚫', key: msg.key } }).catch(() => {});
        return;
    }

    const sessions = global.activeSessions;

    if (!sessions || typeof sessions.size === 'undefined') {
        await sock.sendMessage(chatId, {
            text: '⚠️ global.activeSessions غير موجود.',
        }, { quoted: msg });
        return;
    }

    if (sessions.size === 0) {
        await sock.sendMessage(chatId, {
            text: '✅ لا توجد جلسات نشطة.',
        }, { quoted: msg });
        return;
    }

    const count = sessions.size;
    let cleaned = 0;

    for (const [id, session] of sessions) {
        try {
            // 1. إيقاف مؤقت الجلسة
            if (session.timeout)       clearTimeout(session.timeout);

            // 2. إيقاف مؤقت مسح الرياكت
            if (session.reactClearTimer) clearTimeout(session.reactClearTimer);

            // 3. إزالة wrappedListener (المسجّل الفعلي على sock.ev)
            if (session.listener) {
                try { sock.ev.off('messages.upsert', session.listener); } catch {}
            }

            // 4. تشغيل cleanupFn لو موجودة (تزيل listener الأصلي أيضاً)
            if (typeof session.cleanupFn === 'function') {
                try { session.cleanupFn(); } catch {}
            }

            sessions.delete(id);
            cleaned++;
        } catch {
            sessions.delete(id);
            cleaned++;
        }
    }

    // تأكد من تفريغ كامل
    sessions.clear();

    await sock.sendMessage(chatId, { react: { text: '☑️', key: msg.key } }).catch(() => {});
    await sock.sendMessage(chatId, {
        text: `🧹 *تم تنظيف الذاكرة*\n✔️ ممسوح: *${cleaned}* جلسة\n🔄 الذاكرة فارغة الآن.`,
    }, { quoted: msg });
}

export default { NovaUltra, execute };
