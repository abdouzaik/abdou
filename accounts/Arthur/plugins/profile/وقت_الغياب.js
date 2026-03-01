
import fs from 'fs';
import path from 'path';

const dataDir  = path.join(process.cwd(), 'nova', 'data');
const usersPath = path.join(dataDir, 'users.json');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

function loadDB() {
    try { return JSON.parse(fs.readFileSync(usersPath, 'utf8')); }
    catch { return {}; }
}
function saveDB(d) {
    try { fs.writeFileSync(usersPath, JSON.stringify(d, null, 2), 'utf8'); } catch {}
}
function getUser(jid) {
    const db = loadDB();
    if (!db[jid]) db[jid] = {
        name: '', exp: 0, level: 0, usedcommands: 0,
        genre: '', birth: '', description: '', pasatiempo: '',
        marry: '', coins: 0, bank: 0
    };
    return { db, user: db[jid] };
}
function saveUser(db) { saveDB(db); }

const growth = Math.pow(Math.PI / Math.E, 1.618) * Math.E * 0.75;
function xpRange(level) {
    level = Math.floor(level);
    const mul = 2;
    const min = level === 0 ? 0 : Math.round(Math.pow(level, growth) * mul) + 1;
    const max = Math.round(Math.pow(level + 1, growth) * mul);
    return { min, max, xp: max - min };
}

function reply(sock, chatId, text, msg) {
    return sock.sendMessage(chatId, { text }, { quoted: msg });
}
function react(sock, msg, emoji) {
    return sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } });
}
function getMentioned(msg) {
    return msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
}
function getQuotedSender(msg) {
    return msg.message?.extendedTextMessage?.contextInfo?.participant || null;
}

// ═══ معالج الغياب التلقائي ═══
// يعمل على كل رسالة تلقائياً عبر featureHandlers

if (!global.featureHandlers) global.featureHandlers = [];
global.featureHandlers = global.featureHandlers.filter(h => h._src !== 'وقت_الغياب');

function formatTime(ms) {
    if (!ms || isNaN(ms)) return 'غير معروف';
    const h   = Math.floor(ms / 3600000);
    const min = Math.floor((ms % 3600000) / 60000);
    const s   = Math.floor((ms % 60000) / 1000);
    const parts = [];
    if (h)   parts.push(`${h} ساعة`);
    if (min) parts.push(`${min} دقيقة`);
    if (s || (!h && !min)) parts.push(`${s} ثانية`);
    return parts.join(' ');
}

async function afkHandler(sock, msg, { chatId }) {
    if (msg.key.fromMe) return true;

    const senderJid = msg.key.participant || msg.key.remoteJid;
    const { db, user } = getUser(senderJid);

    // تحديث الاسم
    if (!user.name && msg.pushName) { user.name = msg.pushName; saveUser(db); }

    // رجوع من الغياب
    if (typeof user.afk === 'number' && user.afk > 0) {
        const ms = Date.now() - user.afk;
        const coins = Math.floor(ms / 60000) * 8;
        user.coins = (user.coins || 0) + coins;
        user.afk   = -1;
        const reason = user.afkReason || 'بدون سبب';
        user.afkReason = '';
        saveUser(db);
        await sock.sendMessage(chatId, {
            text: `ꕥ *${user.name || 'مستخدم'}* عدت من الغياب.\n> ○ السبب » *${reason}*\n> ○ مدة الغياب » *${formatTime(ms)}*\n> ○ المكافأة » *${coins} عملة*`
        }, { quoted: msg });
    }

    // تنبيه إذا تم ذكر شخص غائب
    const mentioned = getMentioned(msg);
    const quoted    = getQuotedSender(msg);
    const jids      = [...new Set([...mentioned, quoted].filter(j => j && j !== 'status@broadcast'))];

    for (const jid of jids) {
        const target = getUser(jid).user;
        if (typeof target.afk !== 'number' || target.afk <= 0) continue;
        const ms = Date.now() - target.afk;
        await sock.sendMessage(chatId, {
            text: `ꕥ المستخدم *${target.name || 'مستخدم'}* غائب حالياً.\n> ○ السبب » *${target.afkReason || 'بدون سبب'}*\n> ○ مدة الغياب » *${formatTime(ms)}*`
        }, { quoted: msg });
    }

    return true;
}
afkHandler._src = 'وقت_الغياب';
global.featureHandlers.push(afkHandler);

const NovaUltra = { command: [], description: 'معالج الغياب التلقائي', elite: 'off', group: false, prv: false, lock: 'off' };
async function execute() {}
export default { NovaUltra, execute };
