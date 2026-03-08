import { downloadMediaMessage } from '@whiskeysockets/baileys';

const reply = (sock, chatId, text, msg) =>
    sock.sendMessage(chatId, { text }, { quoted: msg });
const react = (sock, msg, e) =>
    sock.sendMessage(msg.key.remoteJid, { react: { text: e, key: msg.key } });

export default {
    NovaUltra: {
        command: ['صورة_قروب', 'setgpphoto', 'gpphoto'],
        description: 'تغيير صورة المجموعة',
        elite: 'off', group: true, prv: false, lock: 'off'
    },
    execute: async ({ sock, msg, sender }) => {
        const chatId = msg.key.remoteJid;

        // ── حساب الصلاحيات ──────────────────────────────────
        let isAdmin = false, isBotAdmin = false;
        try {
            const meta   = await sock.groupMetadata(chatId);
            const admins = meta.participants
                .filter(p => p.admin)
                .map(p => p.id.split('@')[0].split(':')[0]);
            const senderNum = (sender?.pn || '').split('@')[0].split(':')[0].replace(/\D/g,'');
            const botNum    = sock.user.id.split(':')[0];
            isAdmin    = admins.includes(senderNum);
            isBotAdmin = admins.includes(botNum);
        } catch {}

        if (!isAdmin)    return reply(sock, chatId, '❌ هذا الأمر للمشرفين فقط', msg);
        if (!isBotAdmin) return reply(sock, chatId, '❌ البوت يحتاج صلاحية مشرف', msg);

        // ── جلب الصورة (اقتباس أو مرفق) ─────────────────────
        const ctxInfo   = msg.message?.extendedTextMessage?.contextInfo;
        const quotedMsg = ctxInfo?.quotedMessage
            ? { message: ctxInfo.quotedMessage,
                key: { ...msg.key, id: ctxInfo.stanzaId, participant: ctxInfo.participant } }
            : null;

        const targetMsg     = quotedMsg || msg;
        const targetContent = targetMsg.message || {};

        if (!targetContent.imageMessage) {
            return reply(sock, chatId, '🖼️ أرسل أو اقتبس *صورة* مع الأمر', msg);
        }

        await react(sock, msg, '⏳');
        try {
            const buffer = await downloadMediaMessage(targetMsg, 'buffer', {});
            if (!buffer?.length) throw new Error('فشل تحميل الصورة');

            await sock.updateProfilePicture(chatId, buffer);
            await react(sock, msg, '✅');
            await reply(sock, chatId, '✅ تم تغيير صورة المجموعة', msg);
        } catch (e) {
            await react(sock, msg, '❌');
            await reply(sock, chatId, `❌ فشل: ${e?.message}`, msg);
        }
    }
};
