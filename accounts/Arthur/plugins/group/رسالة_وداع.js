
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

const NovaUltra = { command: ['وداع'], description: 'تعيين رسالة الوداع', elite: 'off', group: true, prv: false, lock: 'off' };

async function execute({ sock, msg, args }) {
    const chatId = msg.key.remoteJid;
    const senderJid = msg.key.participant || msg.key.remoteJid;
    if (!await isAdmin(sock, chatId, senderJid)) return reply(sock, chatId, '❌ هذا الأمر للمشرفين فقط.', msg);

    const rawText = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const value   = rawText.split(' ').slice(1).join(' ').trim();

    if (!value) return reply(sock, chatId,
        'ꕥ أرسل رسالة الوداع بعد الأمر.\n> يمكنك استخدام {user} و {group} كمتغيرات.\n\n✐ مثال:\nوداع وداعاً {user}، سنفتقدك في {group}!', msg);

    const d = loadF();
    const g = getGroup(d, chatId);
    g.goodbye = value;
    saveF(d);
    await reply(sock, chatId, 'ꕥ تم تعيين رسالة الوداع بنجاح.', msg);
}

export default { NovaUltra, execute };
