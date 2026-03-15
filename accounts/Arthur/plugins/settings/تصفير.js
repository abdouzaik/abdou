// ══════════════════════════════════════════════════════════════
//  تصفير.js — مسح كل جلسات نظام.js + قفل messages.js
//  يعمل كبلاجن مستقل: .تصفير
// ══════════════════════════════════════════════════════════════

export const NovaUltra = {
    command:     'تصفير',
    description: 'مسح كل جلسات النظام النشطة',
    elite:       'on',
    group:       false,
    prv:         false,
    lock:        'off',
};

export async function execute({ sock, msg }) {
    const chatId    = msg.key.remoteJid;
    const ownerNum  = (global._botConfig?.owner || '213540419314').replace(/\D/g, '');
    const senderNum = (msg.key.participant || chatId).split('@')[0].split(':')[0];
    const isOwner   = msg.key.fromMe || senderNum === ownerNum;
    if (!isOwner) {
        await sock.sendMessage(chatId, { react: { text: '🚫', key: msg.key } }).catch(() => {});
        return;
    }

    let sessCleared = 0;
    let lockCleared = 0;

    // ── 1. مسح جلسات نظام.js (global.activeSessions) ────────────
    const sessions = global.activeSessions;
    if (sessions instanceof Map && sessions.size > 0) {
        for (const [id, sess] of sessions) {
            try {
                // cleanupFn تزيل الـ listener + تؤقت مباشرة
                if (typeof sess.cleanupFn === 'function') {
                    sess.cleanupFn();
                } else {
                    if (sess.listener)        sock.ev.off('messages.upsert', sess.listener);
                    if (sess.timeout)         clearTimeout(sess.timeout);
                    if (sess.reactClearTimer) clearTimeout(sess.reactClearTimer);
                    sessions.delete(id);
                }
                sessCleared++;
            } catch {
                sessions.delete(id);
                sessCleared++;
            }
        }
        sessions.clear(); // تأكيد تفريغ كامل
    }

    // ── 2. مسح قفل الأوامر (activeListeners في messages.js) ──────
    const sockObj = global._sockGlobal || sock;
    const locks   = sockObj?.activeListeners;
    if (locks instanceof Map && locks.size > 0) {
        for (const [, cleanFn] of locks) {
            try { if (typeof cleanFn === 'function') cleanFn(); } catch {}
            lockCleared++;
        }
        locks.clear();
    }

    // ── إجابة ──────────────────────────────────────────────────
    await sock.sendMessage(chatId, { react: { text: '☑️', key: msg.key } }).catch(() => {});
    await sock.sendMessage(chatId, {
        text: `🧹 *تم تنظيف الذاكرة*\n\n✔️ جلسات نظام: *${sessCleared}*\n✔️ قفل أوامر: *${lockCleared}*\n\n🔄 الذاكرة فارغة الآن.`,
    }, { quoted: msg });
}

export default { NovaUltra, execute };
