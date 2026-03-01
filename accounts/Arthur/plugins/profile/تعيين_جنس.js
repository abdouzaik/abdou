
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

const NovaUltra = { command: ['تعيين_جنس'], description: 'تعيين الجنس', elite: 'off', group: false, prv: false, lock: 'off' };

const genresList = ['ذكر','أنثى','فيمبوي','متحول جنسياً','مثلي','مثلية','ثنائي الجنس','مزدوج الميول','لاجنسي'];

async function execute({ sock, msg, args }) {
    const chatId    = msg.key.remoteJid;
    const senderJid = msg.key.participant || msg.key.remoteJid;
    const { db, user } = getUser(senderJid);
    const input = args.join(' ').toLowerCase().trim();

    if (!input) {
        return reply(sock, chatId,
            `《✧》 اختر جنساً:\n\n${genresList.map((g,i)=>`${i+1}. ${g}`).join('\n')}\n\n✐ مثال » *تعيين_جنس ذكر* أو *تعيين_جنس 1*`, msg);
    }
    let genre = null;
    if (/^\d+$/.test(input)) {
        const idx = parseInt(input) - 1;
        if (idx >= 0 && idx < genresList.length) genre = genresList[idx];
    } else { genre = genresList.find(g => g.toLowerCase() === input) || null; }

    if (!genre) return reply(sock, chatId, `《✧》 جنس غير صحيح.\n\n${genresList.map((g,i)=>`${i+1}. ${g}`).join('\n')}`, msg);

    user.genre = genre;
    saveUser(db);
    return reply(sock, chatId, `✎ تم تعيين جنسك كـ: *${genre}*`, msg);
}
export default { NovaUltra, execute };
