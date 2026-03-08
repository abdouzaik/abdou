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

        // ── صلاحيات ───────────────────────────────────────────
        let isAdmin = false, isBotAdmin = false;
        try {
            const meta   = await sock.groupMetadata(chatId);
            const botRaw = sock.user.id;                          // مثال: 966501234567:12@s.whatsapp.net
            const botNum = botRaw.split(':')[0].split('@')[0];   // 966501234567

            // كل المشرفين كأرقام نظيفة
            const adminNums = meta.participants
                .filter(p => p.admin)
                .map(p => p.id.split(':')[0].split('@')[0]);

            // رقم المرسل — جرب كل المصادر
            const candidates = [
                sender?.pn,
                sender?.lid,
                msg.key.participant,
                msg.key.remoteJid
            ].filter(Boolean).map(v => v.split(':')[0].split('@')[0]);

            isAdmin    = msg.key.fromMe || candidates.some(c => adminNums.includes(c));
            isBotAdmin = adminNums.includes(botNum);
        } catch {}

        if (!isAdmin)    return reply(sock, chatId, '❌ هذا الأمر للمشرفين فقط', msg);
        if (!isBotAdmin) return reply(sock, chatId, '❌ البوت يحتاج صلاحية مشرف', msg);

        // ── الصورة ────────────────────────────────────────────
        const ctxInfo   = msg.message?.extendedTextMessage?.contextInfo;
        const quotedMsg = ctxInfo?.quotedMessage
            ? { message: ctxInfo.quotedMessage,
                key: { ...msg.key, id: ctxInfo.stanzaId, participant: ctxInfo.participant } }
            : null;
        const targetMsg     = quotedMsg || msg;
        const targetContent = targetMsg.message || {};

        if (!targetContent.imageMessage)
            return reply(sock, chatId, '🖼️ أرسل أو اقتبس *صورة* مع الأمر', msg);

        await react(sock, msg, '⏳');
        try {
            const buffer = await downloadMediaMessage(targetMsg, 'buffer', {});
            if (!buffer?.length) throw new Error('فشل تحميل الصورة');
            await sock.updateProfilePicture(chatId, buffer);
            await react(sock, msg, '✅');
        } catch (e) {
            await react(sock, msg, '❌');
            await reply(sock, chatId, `❌ فشل: ${e?.message}`, msg);
        }
    }
};
