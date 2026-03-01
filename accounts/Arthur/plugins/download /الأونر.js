import fs from 'fs';
import path from 'path';

// ─── قاعدة بيانات الحظر ───────────────────────────
const dataDir  = path.join(process.cwd(), 'nova', 'data');
const banPath  = path.join(dataDir, 'banned.json');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

function loadBans() {
    try { return JSON.parse(fs.readFileSync(banPath, 'utf8')); }
    catch { return { users: {}, chats: {} }; }
}
function saveBans(d) {
    try { fs.writeFileSync(banPath, JSON.stringify(d, null, 2), 'utf8'); } catch {}
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

// دالة التحقق من ملكية البوت
function isOwner(sock, jid) {
    const ownerJid = (global.owner?.[0]?.[0] || sock.user.id.split(':')[0]) + '@s.whatsapp.net';
    return jid.replace(/:\d+@/, '@') === ownerJid.replace(/:\d+@/, '@');
}

const NovaUltra = {
    command: ['حظر', 'فك_حظر', 'بلوك', 'فك_بلوك', 'قائمة_المحظورين', 'قائمة_البلوك'],
    description: 'أوامر الأونر لإدارة الحظر',
    elite: 'off',
    group: false,
    prv: false,
    lock: 'off',
};

async function execute({ sock, msg, args }) {
    const chatId    = msg.key.remoteJid;
    const senderJid = msg.key.participant || msg.key.remoteJid;

    // فقط للأونر
    if (!isOwner(sock, senderJid)) return;

    const rawText = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const cmdWord = rawText.trim().split(/\s+/)[0].replace(/^[^\u0600-\u06FFa-zA-Z0-9]/, '');

    const mentioned = getMentioned(msg);
    const quoted    = getQuotedSender(msg);
    const who       = mentioned[0] || quoted || (args[0] ? args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null);

    const bans = loadBans();

    // ─── حظر ─────────────────────────────────────
    if (cmdWord === 'حظر') {
        if (!who) return reply(sock, chatId, '❀ منشن أو رد على رسالة الشخص الذي تريد حظره.', msg);
        if (who === sock.user.id.split(':')[0] + '@s.whatsapp.net') return reply(sock, chatId, 'ꕥ لا يمكن حظر البوت.', msg);
        if (isOwner(sock, who)) return reply(sock, chatId, 'ꕥ لا يمكن حظر الأونر.', msg);
        if (bans.users[who]?.banned) return reply(sock, chatId, `ꕥ @${who.split('@')[0]} محظور بالفعل.`, msg);

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
        if (!who) return reply(sock, chatId, '❀ منشن أو رد على رسالة الشخص الذي تريد فك حظره.', msg);
        if (!bans.users[who]?.banned) return reply(sock, chatId, `ꕥ @${who.split('@')[0]} غير محظور.`, msg);
        await react(sock, msg, '🕒');
        bans.users[who].banned  = false;
        bans.users[who].reason  = '';
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
        } catch (e) { await react(sock, msg, '❌'); reply(sock, chatId, `❌ خطأ: ${e.message}`, msg); }
    }

    // ─── فك البلوك ───────────────────────────────
    else if (cmdWord === 'فك_بلوك') {
        if (!who) return reply(sock, chatId, '❀ منشن أو رد على رسالة الشخص الذي تريد فك بلوكه.', msg);
        await react(sock, msg, '🕒');
        try {
            await sock.updateBlockStatus(who, 'unblock');
            await react(sock, msg, '✔️');
            await sock.sendMessage(chatId, { text: `❀ تم فك بلوك @${who.split('@')[0]}.`, mentions: [who] }, { quoted: msg });
        } catch (e) { await react(sock, msg, '❌'); reply(sock, chatId, `❌ خطأ: ${e.message}`, msg); }
    }

    // ─── قائمة المحظورين ─────────────────────────
    else if (cmdWord === 'قائمة_المحظورين') {
        await react(sock, msg, '🕒');
        const bannedUsers = Object.entries(bans.users).filter(([, d]) => d.banned);
        if (!bannedUsers.length) { await react(sock, msg, '✔️'); return reply(sock, chatId, '✎ لا يوجد مستخدمون محظورون.', msg); }
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
        } catch (e) { await react(sock, msg, '❌'); reply(sock, chatId, `❌ خطأ: ${e.message}`, msg); }
    }
}

export default { NovaUltra, execute };
