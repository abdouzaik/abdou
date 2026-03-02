import fs   from 'fs';
import path from 'path';

// ─── قاعدة بيانات الحظر ───────────────────────────
const dataDir = path.join(process.cwd(), 'nova', 'data');
const banPath = path.join(dataDir, 'banned.json');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

function loadBans() {
    try { return JSON.parse(fs.readFileSync(banPath, 'utf8')); }
    catch { return { users: {}, chats: {} }; }
}
function saveBans(d) {
    try { fs.writeFileSync(banPath, JSON.stringify(d, null, 2), 'utf8'); } catch {}
}

// ─── helpers ──────────────────────────────────────
const reply  = (sock, chatId, text, msg) => sock.sendMessage(chatId, { text }, { quoted: msg });
const react  = (sock, msg, emoji)        => sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } });

function getMentioned(msg) {
    return msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
}
function getQuotedSender(msg) {
    return msg.message?.extendedTextMessage?.contextInfo?.participant || null;
}

// ─── NovaUltra ────────────────────────────────────
export const NovaUltra = {
    command: ['حظر', 'فك_حظر', 'بلوك', 'فك_بلوك', 'قائمة_المحظورين', 'قائمة_البلوك'],
    description: 'أوامر الأونر لإدارة الحظر',
    elite: 'off',
    group: false,
    prv: false,
    lock: 'off',
};

// ─── execute ──────────────────────────────────────
export async function execute({ sock, msg, args, BIDS, sender }) {
    const chatId = msg.key.remoteJid;

    // ✅ sender.pn من messages.js مباشرة — لا نحسبه من جديد
    const senderPn = sender?.pn;

    // ✅ isOwner — messages.js يمرر BIDS.pn = رقم البوت، الأونر من الكونفيج
    // نستخدم msg.key.fromMe كبديل موثوق للأونر لو أرسل من نفس الرقم
    const ownerNum = (global.configOwner || '').toString().replace(/\D/g, '');
    const ownerJid = ownerNum ? ownerNum + '@s.whatsapp.net' : BIDS?.pn;
    const isOwnerSender = msg.key.fromMe || senderPn === ownerJid;

    if (!isOwnerSender) return;

    // ✅ الأمر — نستخرجه من نص الرسالة لأن args لا يحتوي عليه
    const rawText  = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const { prefix } = (global.liveConfig || {});
    const pfx = prefix || '.';
    const cmdWord  = rawText.trim().slice(pfx.length).split(/\s+/)[0];

    // ✅ تحديد الشخص المستهدف
    const mentioned = getMentioned(msg);
    const quoted    = getQuotedSender(msg);
    const argPhone  = args[0] ? args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null;
    const who       = mentioned[0] || quoted || argPhone;

    const bans = loadBans();

    // ─── حظر ─────────────────────────────────────
    if (cmdWord === 'حظر') {
        if (!who)                      return reply(sock, chatId, '❀ منشن أو رد على رسالة الشخص الذي تريد حظره.', msg);
        if (who === BIDS?.pn)          return reply(sock, chatId, 'ꕥ لا يمكن حظر البوت.', msg);
        if (who === ownerJid)          return reply(sock, chatId, 'ꕥ لا يمكن حظر الأونر.', msg);
        if (bans.users[who]?.banned)   return reply(sock, chatId, `ꕥ @${who.split('@')[0]} محظور بالفعل.`, msg);

        const reason = args.slice(mentioned.length > 0 ? 1 : 0).join(' ') || 'بدون سبب';
        await react(sock, msg, '🕒');
        bans.users[who] = { banned: true, reason };
        saveBans(bans);
        await react(sock, msg, '✔️');
        await sock.sendMessage(chatId, {
            text: `❀ تم حظر @${who.split('@')[0]}.\n> السبب: ${reason}`,
            mentions: [who]
        }, { quoted: msg });
    }

    // ─── فك الحظر ────────────────────────────────
    else if (cmdWord === 'فك_حظر') {
        if (!who)                    return reply(sock, chatId, '❀ منشن أو رد على رسالة الشخص الذي تريد فك حظره.', msg);
        if (!bans.users[who]?.banned) return reply(sock, chatId, `ꕥ @${who.split('@')[0]} غير محظور.`, msg);
        await react(sock, msg, '🕒');
        bans.users[who].banned = false;
        bans.users[who].reason = '';
        saveBans(bans);
        await react(sock, msg, '✔️');
        await sock.sendMessage(chatId, {
            text: `❀ تم فك حظر @${who.split('@')[0]}.`,
            mentions: [who]
        }, { quoted: msg });
    }

    // ─── بلوك ────────────────────────────────────
    else if (cmdWord === 'بلوك') {
        if (!who) return reply(sock, chatId, '❀ منشن أو رد على رسالة الشخص الذي تريد بلوكه.', msg);
        await react(sock, msg, '🕒');
        try {
            await sock.updateBlockStatus(who, 'block');
            await react(sock, msg, '✔️');
            await sock.sendMessage(chatId, { text: `❀ تم بلوك @${who.split('@')[0]}.`, mentions: [who] }, { quoted: msg });
        } catch (e) {
            await react(sock, msg, '❌');
            reply(sock, chatId, `❌ خطأ: ${e.message}`, msg);
        }
    }

    // ─── فك البلوك ───────────────────────────────
    else if (cmdWord === 'فك_بلوك') {
        if (!who) return reply(sock, chatId, '❀ منشن أو رد على رسالة الشخص الذي تريد فك بلوكه.', msg);
        await react(sock, msg, '🕒');
        try {
            await sock.updateBlockStatus(who, 'unblock');
            await react(sock, msg, '✔️');
            await sock.sendMessage(chatId, { text: `❀ تم فك بلوك @${who.split('@')[0]}.`, mentions: [who] }, { quoted: msg });
        } catch (e) {
            await react(sock, msg, '❌');
            reply(sock, chatId, `❌ خطأ: ${e.message}`, msg);
        }
    }

    // ─── قائمة المحظورين ─────────────────────────
    else if (cmdWord === 'قائمة_المحظورين') {
        await react(sock, msg, '🕒');
        const bannedUsers = Object.entries(bans.users).filter(([, d]) => d.banned);
        if (!bannedUsers.length) {
            await react(sock, msg, '✔️');
            return reply(sock, chatId, '✎ لا يوجد مستخدمون محظورون.', msg);
        }
        const list = bannedUsers.map(([jid, d]) => `• @${jid.split('@')[0]} — ${d.reason || 'بدون سبب'}`).join('\n');
        await react(sock, msg, '✔️');
        await sock.sendMessage(chatId, {
            text: `✦ *المحظورون* — (${bannedUsers.length})\n\n${list}`,
            mentions: bannedUsers.map(([jid]) => jid)
        }, { quoted: msg });
    }

    // ─── قائمة البلوك ────────────────────────────
    else if (cmdWord === 'قائمة_البلوك') {
        await react(sock, msg, '🕒');
        try {
            const blocklist = await sock.fetchBlocklist();
            const list = blocklist.map(jid => `• @${jid.split('@')[0]}`).join('\n') || 'لا يوجد';
            await react(sock, msg, '✔️');
            await sock.sendMessage(chatId, {
                text: `≡ *قائمة المبلوكين* — (${blocklist.length})\n\n${list}`,
                mentions: blocklist
            }, { quoted: msg });
        } catch (e) {
            await react(sock, msg, '❌');
            reply(sock, chatId, `❌ خطأ: ${e.message}`, msg);
        }
    }
}

export default { NovaUltra, execute };
