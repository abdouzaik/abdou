
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

const NovaUltra = { command: ['تعيين_ميلاد'], description: 'تعيين تاريخ الميلاد', elite: 'off', group: false, prv: false, lock: 'off' };

const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
const DAYS_AR   = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];

function parseDate(input) {
    const match = input.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
    if (!match) return { error: '《✧》 صيغة غير صحيحة. استخدم: *DD/MM/YYYY* أو *DD/MM*' };
    const day = parseInt(match[1]), month = parseInt(match[2]);
    const year = match[3] ? parseInt(match[3]) : new Date().getFullYear();
    if (month < 1 || month > 12) return { error: '《✧》 الشهر يجب أن يكون بين 1 و 12.' };
    if (day < 1 || day > 31)     return { error: '《✧》 اليوم يجب أن يكون بين 1 و 31.' };
    if (year > new Date().getFullYear()) return { error: '✦ السنة لا يمكن أن تكون في المستقبل.' };
    const date = new Date(year, month - 1, day);
    if (date.getMonth() !== month - 1) return { error: '《✧》 التاريخ غير صحيح.' };
    return { result: `${DAYS_AR[date.getDay()]}، ${day} ${MONTHS_AR[month-1]} ${year}` };
}

async function execute({ sock, msg, args }) {
    const chatId    = msg.key.remoteJid;
    const senderJid = msg.key.participant || msg.key.remoteJid;
    const { db, user } = getUser(senderJid);
    const input = args.join(' ').trim();
    if (!input) return reply(sock, chatId, '《✧》 أدخل تاريخ ميلادك.\n> مثال: *تعيين_ميلاد 01/01/2000*', msg);
    const { result, error } = parseDate(input);
    if (error) return reply(sock, chatId, error, msg);
    user.birth = result;
    saveUser(db);
    return reply(sock, chatId, `✎ تم تعيين تاريخ ميلادك كـ: *${result}*`, msg);
}
export default { NovaUltra, execute };
