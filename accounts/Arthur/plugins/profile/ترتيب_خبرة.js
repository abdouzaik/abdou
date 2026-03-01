
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
    command: ['ترتيب', 'lboard'],
    description: 'ترتيب المستخدمين بالخبرة',
    elite: 'off', group: false, prv: false, lock: 'off'
};

async function execute({ sock, msg, args }) {
    const chatId = msg.key.remoteJid;
    const db = loadDB();

    const users = Object.entries(db)
        .filter(([_, d]) => (d.exp || 0) >= 1)
        .map(([_, d]) => {
            const exp   = d.exp || 0;
            const level = d.level || 0;
            const { min, xp } = xpRange(level);
            const progreso = exp - min;
            const pct = xp > 0 ? Math.floor((progreso / xp) * 100) : 0;
            return { name: d.name || 'مستخدم', exp, level, progreso, xp, pct };
        })
        .sort((a, b) => b.exp - a.exp);

    if (!users.length) return reply(sock, chatId, 'ꕥ لا يوجد مستخدمون مسجلون بخبرة بعد.', msg);

    const page      = parseInt(args[0]) || 1;
    const pageSize  = 10;
    const total     = Math.ceil(users.length / pageSize);

    if (page < 1 || page > total)
        return reply(sock, chatId, `《✧》 الصفحة *${page}* غير موجودة. يوجد *${total}* صفحات.`, msg);

    const start = (page - 1) * pageSize;
    let text = `*✩ ترتيب المستخدمين بالخبرة ✩*\n\n`;
    text += users.slice(start, start + pageSize).map(({ name, exp, level, progreso, xp, pct }, i) =>
        `✩ ${start + i + 1} › *${name}*\n     XP → *${exp.toLocaleString()}*  LVL → *${level}*\n     ➨ التقدم → *${progreso} => ${xp}* _(${pct}%)_`
    ).join('\n\n');
    text += `\n\n> ⌦ صفحة *${page}* من *${total}*`;
    if (page < total) text += `\n> للصفحة التالية › *ترتيب ${page + 1}*`;

    await sock.sendMessage(chatId, { text }, { quoted: msg });
}

export default { NovaUltra, execute };
