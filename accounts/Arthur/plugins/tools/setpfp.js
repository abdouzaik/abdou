// ── setpfp — تغيير صورة البوت ──────────────────────────────
import { downloadMediaMessage } from '@whiskeysockets/baileys';

async function resizeImage(buffer) {
    const { Jimp, JimpMime } = await import('jimp');
    const img  = await Jimp.read(buffer);
    const size = Math.min(img.bitmap.width, img.bitmap.height);
    img.crop({ x: 0, y: 0, w: size, h: size }).resize({ w: 512, h: 512 });
    return img.getBuffer(JimpMime.jpeg);
}

export default {
    NovaUltra: {
        command: ['صورة-بوت', 'setpfp'],
        description: 'تغيير صورة البوت',
        elite: 'on',
    },
    execute: async ({ sock, msg, sender, BIDS }) => {
        const chatId = msg.key.remoteJid;

        // ── isOwner: إما fromMe أو رقمه = رقم الأونر في الكونفيج ──
        const ownerNum = (global._botConfig?.owner || '').toString().replace(/\D/g,'');
        const senderNum = (sender?.pn || '').replace(/\D/g,'').replace('s.whatsapp.net','');
        const isOwner = msg.key.fromMe || (ownerNum && senderNum.includes(ownerNum));

        if (!isOwner)
            return sock.sendMessage(chatId, { text: '❌ للمالك فقط' }, { quoted: msg });

        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const target = quoted || msg.message;
        if (!target?.imageMessage)
            return sock.sendMessage(chatId, { text: '📸 أرسل أو اقتبس صورة مع الأمر' }, { quoted: msg });

        const msgToDownload = quoted
            ? { message: quoted, key: { ...msg.key, id: msg.message?.extendedTextMessage?.contextInfo?.stanzaId } }
            : msg;

        await sock.sendMessage(chatId, { react: { text: '⏳', key: msg.key } });

        const media = await downloadMediaMessage(msgToDownload, 'buffer', {}).catch(() => null);
        if (!media)
            return sock.sendMessage(chatId, { text: '❌ فشل تحميل الصورة' }, { quoted: msg });

        try {
            const img    = await resizeImage(media);
            const botJid = BIDS?.pn || sock.user.id.split(':')[0] + '@s.whatsapp.net';
            await sock.updateProfilePicture(botJid, img);
            await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });
            await sock.sendMessage(chatId, { text: '✅ تم تغيير صورة البوت' }, { quoted: msg });
        } catch (e) {
            await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } });
            await sock.sendMessage(chatId, { text: `❌ فشل: ${e?.message}` }, { quoted: msg });
        }
    }
};
