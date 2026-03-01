
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

const NovaUltra = { command: ['تعيين_هواية'], description: 'تعيين الهواية', elite: 'off', group: false, prv: false, lock: 'off' };

const hobbies = [
    '📚 القراءة','✍️ الكتابة','🎤 الغناء','💃 الرقص','🎮 الألعاب',
    '🎨 الرسم','🍳 الطبخ','✈️ السفر','🏊 السباحة','📸 التصوير',
    '🎧 الموسيقى','🏀 الرياضة','🎬 مشاهدة الأفلام','🌿 الزراعة',
    '🧵 الأشغال اليدوية','🎲 ألعاب الطاولة','🏋️‍♂️ الجيم','🚴 ركوب الدراجات',
    '🎯 رمي السهام','🧘‍♂️ التأمل','🛠️ الإصلاح','🎹 العزف',
    '🐶 تربية الحيوانات','🌌 علم الفلك','♟️ الشطرنج','🛍️ التسوق',
    '🏕️ التخييم','🎣 الصيد','📱 التكنولوجيا','🎭 المسرح',
    '✂️ الخياطة','🧁 المخبوزات','📝 التدوين','🚗 السيارات',
    '🧩 الألغاز','🎳 البولينج','🏄 ركوب الأمواج','⛷️ التزلج',
    '🤿 الغوص','🏹 الرماية','🏇 ركوب الخيل','📊 الاستثمار',
    '🔍 البحث','💄 الميكياج','🛌 النوم','🪓 النجارة',
    '🧪 التجارب','🗺️ الجغرافيا','💎 المجوهرات','أخرى 🌟'
];

async function execute({ sock, msg, args }) {
    const chatId    = msg.key.remoteJid;
    const senderJid = msg.key.participant || msg.key.remoteJid;
    const { db, user } = getUser(senderJid);
    const input = args.join(' ').trim();

    if (!input) {
        let lista = '🎯 *اختر هوايتك:*\n\n';
        hobbies.forEach((p, i) => { lista += `${i+1}) ${p}\n`; });
        lista += `\n✐ مثال » *تعيين_هواية 1* أو اكتب اسمها`;
        return reply(sock, chatId, lista, msg);
    }
    let selected = '';
    if (/^\d+$/.test(input)) {
        const idx = parseInt(input) - 1;
        if (idx >= 0 && idx < hobbies.length) selected = hobbies[idx];
        else return reply(sock, chatId, `《✧》 رقم غير صحيح. اختر بين 1 و ${hobbies.length}.`, msg);
    } else {
        const clean = input.replace(/[^\w\s]/g,'').toLowerCase();
        selected = hobbies.find(p => p.replace(/[^\w\s]/g,'').toLowerCase().includes(clean)) || '';
        if (!selected) return reply(sock, chatId, '《✧》 الهواية غير موجودة. اكتب الأمر بدون نص لرؤية القائمة.', msg);
    }
    if (user.pasatiempo === selected) return reply(sock, chatId, `《✧》 هذه هوايتك بالفعل: *${selected}*`, msg);
    user.pasatiempo = selected;
    saveUser(db);
    return reply(sock, chatId, `✐ تم تعيين هوايتك:\n> *${selected}*`, msg);
}
export default { NovaUltra, execute };
