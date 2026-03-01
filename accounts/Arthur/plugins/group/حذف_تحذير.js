
import fs from 'fs';
import path from 'path';

const dataDir  = path.join(process.cwd(), 'nova', 'data');
const featPath = path.join(dataDir, 'features.json');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

function loadF() {
    try { return JSON.parse(fs.readFileSync(featPath, 'utf8')); }
    catch { return { groups: {}, antiPrivate: false }; }
}
function saveF(d) {
    try { fs.writeFileSync(featPath, JSON.stringify(d, null, 2), 'utf8'); } catch {}
}
function getGroup(d, gid) {
    if (!d.groups) d.groups = {};
    if (!d.groups[gid]) d.groups[gid] = { warns: {}, warnLimit: 3, welcome: '', goodbye: '' };
    return d.groups[gid];
}

function getMentioned(msg) {
    return msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
}
function getQuotedSender(msg) {
    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    return ctx?.participant || ctx?.remoteJid || null;
}
async function isAdmin(sock, chatId, jid) {
    try {
        const meta = await sock.groupMetadata(chatId);
        const norm = jid.replace(/:\d+/, '');
        return meta.participants.some(p => p.id.replace(/:\d+/, '') === norm && (p.admin === 'admin' || p.admin === 'superadmin'));
    } catch { return false; }
}
async function isBotAdmin(sock, chatId) {
    try {
        const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
        return await isAdmin(sock, chatId, botJid);
    } catch { return false; }
}
function reply(sock, chatId, text, msg) {
    return sock.sendMessage(chatId, { text }, { quoted: msg });
}
function react(sock, msg, emoji) {
    return sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } });
}

const NovaUltra = { command: ['حذف_تحذير'], description: 'حذف تحذير أو كل تحذيرات عضو', elite: 'off', group: true, prv: false, lock: 'off' };

async function execute({ sock, msg, args }) {
    const chatId = msg.key.remoteJid;
    const senderJid = msg.key.participant || msg.key.remoteJid;
    if (!await isAdmin(sock, chatId, senderJid)) return reply(sock, chatId, '❌ هذا الأمر للمشرفين فقط.', msg);

    const mentioned = getMentioned(msg);
    const quoted    = getQuotedSender(msg);
    const user      = mentioned[0] || quoted;
    if (!user) return reply(sock, chatId, '《✧》 منشن أو رد على رسالة الشخص المراد حذف تحذيره.', msg);

    const d     = loadF();
    const g     = getGroup(d, chatId);
    const warns = g.warns[user] || [];
    if (warns.length === 0) return sock.sendMessage(chatId, { text: `《✧》 @${user.split('@')[0]} لا يوجد عنده تحذيرات.`, mentions: [user] }, { quoted: msg });

    const rawIndex = mentioned.length > 0 ? args[1] : args[0];

    if (!rawIndex || rawIndex === 'الكل') {
        g.warns[user] = [];
        saveF(d);
        return sock.sendMessage(chatId, { text: `✐ تم حذف جميع تحذيرات @${user.split('@')[0]}.`, mentions: [user] }, { quoted: msg });
    }

    const idx = parseInt(rawIndex) - 1;
    if (isNaN(idx) || idx < 0 || idx >= warns.length) return reply(sock, chatId, `ꕥ الرقم غير صحيح. اختر بين 1 و ${warns.length}.`, msg);

    g.warns[user].splice(idx, 1);
    saveF(d);
    await sock.sendMessage(chatId, { text: `ꕥ تم حذف التحذير #${idx+1} من @${user.split('@')[0]}.`, mentions: [user] }, { quoted: msg });
}

export default { NovaUltra, execute };
