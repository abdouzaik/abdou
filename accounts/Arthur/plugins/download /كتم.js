// ═══ كتم / فك كتم الأعضاء ═══
// يحذف رسائل العضو المكتوم تلقائياً عبر featureHandlers

if (!global.featureHandlers) global.featureHandlers = [];
global.featureHandlers = global.featureHandlers.filter(h => h._src !== 'mute_handler');

// قائمة المكتومين في الذاكرة (تُمسح عند إعادة التشغيل)
const mutedUsers = new Set();

// ─── معالج الرسائل التلقائي ───────────────────────
async function muteHandler(sock, msg, { chatId, isGroup }) {
    if (!isGroup || msg.key.fromMe) return true;

    const senderJid = msg.key.participant || msg.key.remoteJid;
    if (!mutedUsers.has(senderJid)) return true;

    try {
        await sock.sendMessage(chatId, { delete: msg.key });
    } catch (e) {
        console.error('[كتم] خطأ في حذف الرسالة:', e.message);
    }
    return true;
}
muteHandler._src = 'mute_handler';
global.featureHandlers.push(muteHandler);

// ─── مساعدات ──────────────────────────────────────
function reply(sock, chatId, text, msg) {
    return sock.sendMessage(chatId, { text }, { quoted: msg });
}
async function isAdmin(sock, chatId, jid) {
    try {
        const meta = await sock.groupMetadata(chatId);
        const norm = jid.replace(/:\d+/, '');
        return meta.participants.some(p =>
            p.id.replace(/:\d+/, '') === norm &&
            (p.admin === 'admin' || p.admin === 'superadmin')
        );
    } catch { return false; }
}
async function isBotAdmin(sock, chatId) {
    const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
    return isAdmin(sock, chatId, botJid);
}
function getQuotedSender(msg) {
    return msg.message?.extendedTextMessage?.contextInfo?.participant || null;
}

// ─── البلوجن ──────────────────────────────────────
const NovaUltra = {
    command: ['كتم', 'فك_كتم'],
    description: 'كتم أو فك كتم عضو في المجموعة',
    elite: 'off',
    group: true,
    prv: false,
    lock: 'off',
};

async function execute({ sock, msg, args }) {
    const chatId    = msg.key.remoteJid;
    const senderJid = msg.key.participant || msg.key.remoteJid;

    if (!await isBotAdmin(sock, chatId))
        return reply(sock, chatId, '❌ البوت يحتاج صلاحية المشرف لاستخدام هذا الأمر.', msg);
    if (!await isAdmin(sock, chatId, senderJid))
        return reply(sock, chatId, '❌ هذا الأمر للمشرفين فقط.', msg);

    const rawText = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const cmdWord = rawText.trim().split(/\s+/)[0].replace(/^[^\u0600-\u06FFa-zA-Z0-9]/, '');

    const user = getQuotedSender(msg);
    if (!user) return reply(sock, chatId, '❌ رد على رسالة العضو الذي تريد كتمه.', msg);

    if (cmdWord === 'كتم') {
        mutedUsers.add(user);
        await sock.sendMessage(chatId, {
            text: `> ✅ *تم كتم* @${user.split('@')[0]}`,
            mentions: [user]
        }, { quoted: msg });
    } else {
        mutedUsers.delete(user);
        await sock.sendMessage(chatId, {
            text: `> ✅ *تم فك كتم* @${user.split('@')[0]}`,
            mentions: [user]
        }, { quoted: msg });
    }
}

export default { NovaUltra, execute };
