
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

const NovaUltra = { command: ['تحذير'], description: 'إعطاء تحذير لعضو', elite: 'off', group: true, prv: false, lock: 'off' };

async function execute({ sock, msg, args }) {
    const chatId = msg.key.remoteJid;
    const senderJid = msg.key.participant || msg.key.remoteJid;
    if (!await isAdmin(sock, chatId, senderJid)) return reply(sock, chatId, '❌ هذا الأمر للمشرفين فقط.', msg);

    const mentioned = getMentioned(msg);
    const quoted    = getQuotedSender(msg);
    const user      = mentioned[0] || quoted;
    if (!user) return reply(sock, chatId, '《✧》 منشن أو رد على رسالة الشخص الذي تريد تحذيره.', msg);

    const rawText = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const reason  = rawText.split(' ').slice(mentioned.length > 0 ? 2 : 1).join(' ').trim() || 'بدون سبب';

    const d = loadF();
    const g = getGroup(d, chatId);
    if (!g.warns[user]) g.warns[user] = [];

    g.warns[user].push({ reason, by: senderJid, time: new Date().toLocaleString('ar-SA') });
    const total = g.warns[user].length;
    const limit = g.warnLimit || 3;
    saveF(d);

    const list = g.warns[user].map((w, i) => `\`#${i+1}\` » ${w.reason}\n> » التاريخ: ${w.time}`).join('\n');
    let text = `✐ تم إضافة تحذير لـ @${user.split('@')[0]}.\n✿ التحذيرات (\`${total}/${limit}\`):\n\n${list}`;

    if (total >= limit) {
        if (await isBotAdmin(sock, chatId)) {
            try {
                await sock.groupParticipantsUpdate(chatId, [user], 'remove');
                g.warns[user] = [];
                saveF(d);
                text += `\n\n> ❖ تم طرد العضو لوصوله الحد الأقصى من التحذيرات.`;
            } catch { text += `\n\n> ❖ وصل العضو الحد الأقصى لكن لم أتمكن من طرده.`; }
        } else {
            text += `\n\n> ❖ وصل العضو الحد الأقصى من التحذيرات.`;
        }
    }

    await sock.sendMessage(chatId, { text, mentions: [user] }, { quoted: msg });
}

export default { NovaUltra, execute };
