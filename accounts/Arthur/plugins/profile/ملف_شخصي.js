
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

const NovaUltra = {
    command: ['ملف', 'profile', 'بروفايل'],
    description: 'عرض الملف الشخصي للمستخدم',
    elite: 'off', group: false, prv: false, lock: 'off'
};

async function execute({ sock, msg, args }) {
    const chatId    = msg.key.remoteJid;
    const senderJid = msg.key.participant || msg.key.remoteJid;

    const mentioned = getMentioned(msg);
    const quoted    = getQuotedSender(msg);
    const userId    = mentioned[0] || quoted || senderJid;

    const { db, user } = getUser(userId);
    if (!user.name && userId !== senderJid)
        return reply(sock, chatId, '✎ المستخدم *المذكور* غير مسجل في البوت.', msg);

    // تحديث الاسم عند عرض الملف الخاص
    if (userId === senderJid && msg.pushName) {
        user.name = msg.pushName;
        saveUser(db);
    }

    const name       = user.name || 'مستخدم';
    const birth      = user.birth || 'غير محدد';
    const genero     = user.genre || 'مخفي';
    const pasatiempo = user.pasatiempo || 'غير محدد';
    const pareja     = user.marry ? (db[user.marry]?.name || 'شخص ما') : 'لا أحد';
    const desc       = user.description ? `\n${user.description}` : '';
    const exp        = user.exp || 0;
    const nivel      = user.level || 0;
    const totalCoins = (user.coins || 0) + (user.bank || 0);

    const sorted = Object.entries(db)
        .map(([k, v]) => ({ jid: k, level: v.level || 0 }))
        .sort((a, b) => b.level - a.level);
    const rank = (sorted.findIndex(u => u.jid === userId) + 1) || '؟';

    const { min, xp } = xpRange(nivel);
    const progreso    = exp - min;
    const pct         = xp > 0 ? Math.floor((progreso / xp) * 100) : 0;

    const caption = `「✿」 *ملف شخصي* ◢ ${name} ◤${desc}

♛ تاريخ الميلاد › *${birth}*
⸙ الهواية › *${pasatiempo}*
⚥ الجنس › *${genero}*
♡ متزوج من › *${pareja}*

✿ المستوى › *${nivel}*
❀ الخبرة › *${exp.toLocaleString()}*
➨ التقدم › *${progreso} => ${xp}* _(${pct}%)_
☆ الترتيب › *#${rank}*

⛁ إجمالي العملات › *${totalCoins.toLocaleString()}*
❒ الأوامر المنفذة › *${Number(user.usedcommands || 0).toLocaleString()}*`;

    try {
        const perfil = await sock.profilePictureUrl(userId, 'image').catch(() => null);
        if (perfil) {
            await sock.sendMessage(chatId, { image: { url: perfil }, caption }, { quoted: msg });
        } else {
            await reply(sock, chatId, caption, msg);
        }
    } catch (e) { reply(sock, chatId, caption, msg); }
}

export default { NovaUltra, execute };
