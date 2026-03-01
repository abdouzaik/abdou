
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

const NovaUltra = { command: ['زواج', 'marry'], description: 'إرسال طلب زواج', elite: 'off', group: false, prv: false, lock: 'off' };

const proposals = {};

async function execute({ sock, msg, args }) {
    const chatId   = msg.key.remoteJid;
    const proposer = msg.key.participant || msg.key.remoteJid;

    const mentioned = getMentioned(msg);
    const quoted    = getQuotedSender(msg);
    const proposee  = mentioned[0] || quoted || null;

    if (!proposee) return reply(sock, chatId, '《✧》 منشن المستخدم الذي تريد التقدم له بطلب زواج.', msg);
    if (proposer === proposee) return reply(sock, chatId, '《✧》 لا يمكنك التقدم بطلب زواج لنفسك.', msg);

    const { db, user: proposerUser } = getUser(proposer);
    const proposeeUser = getUser(proposee).user;

    if (proposerUser.marry) return reply(sock, chatId, `《✧》 أنت متزوج بالفعل من *${db[proposerUser.marry]?.name || 'شخص ما'}*.`, msg);
    if (proposeeUser.marry) return reply(sock, chatId, `《✧》 *${proposeeUser.name || proposee.split('@')[0]}* متزوج بالفعل.`, msg);

    if (proposals[proposee] === proposer) {
        delete proposals[proposee];
        proposerUser.marry = proposee;
        proposeeUser.marry = proposer;
        saveUser(db);
        return reply(sock, chatId,
            `✎ مبروك، *${proposerUser.name || proposer.split('@')[0]}* و *${proposeeUser.name || proposee.split('@')[0]}* أصبحا متزوجين 💍`, msg);
    }

    proposals[proposer] = proposee;
    setTimeout(() => { delete proposals[proposer]; }, 120000);

    return sock.sendMessage(chatId, {
        text: `✎ @${proposee.split('@')[0]}، المستخدم @${proposer.split('@')[0]} أرسل لك طلب زواج.\n\n⚘ *للقبول اكتب:*\n> ❀ *زواج @${proposer.split('@')[0]}*\n> ❀ ينتهي الطلب خلال دقيقتين.`,
        mentions: [proposer, proposee]
    }, { quoted: msg });
}
export default { NovaUltra, execute };
