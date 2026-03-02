import Jimp from 'jimp';

// ── تصغير الصورة وتجهيزها ──
async function resizeImage(buffer) {
    const img = await Jimp.read(buffer);
    const size = Math.min(img.getWidth(), img.getHeight());
    const cropped = img.crop(0, 0, size, size).scaleToFit(720, 720);
    return {
        img:     await cropped.getBufferAsync(Jimp.MIME_JPEG),
        preview: await cropped.normalize().getBufferAsync(Jimp.MIME_JPEG),
    };
}

export default {
    NovaUltra: {
        command: "صورة-بوت",
        description: "تغيير صورة البوت",
        elite: "on",
    },
    execute: async ({ sock, msg, isOwner }) => {
        const chatId = msg.key.remoteJid;

        if (!isOwner) {
            return await sock.sendMessage(chatId, {
                text: "❌ هذا الأمر للمالك فقط"
            }, { quoted: msg });
        }

        // ── جلب الصورة من الرسالة أو الاقتباس ──
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const target = quoted || msg.message;

        const imgMsg = target?.imageMessage;
        if (!imgMsg) {
            return await sock.sendMessage(chatId, {
                text: "📸 أرسل أو اقتبس صورة مع الأمر"
            }, { quoted: msg });
        }

        // ── تحميل الصورة ──
        const { downloadMediaMessage } = await import('@whiskeysockets/baileys');
        const media = await downloadMediaMessage(
            quoted ? { message: quoted, key: msg.key } : msg,
            'buffer',
            {}
        );

        if (!media) {
            return await sock.sendMessage(chatId, {
                text: "❌ فشل تحميل الصورة"
            }, { quoted: msg });
        }

        const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';

        try {
            const { img } = await resizeImage(media);
            await sock.updateProfilePicture(botJid, img);
            await sock.sendMessage(chatId, {
                text: "✅ تم تغيير صورة البوت بنجاح"
            }, { quoted: msg });
        } catch (err) {
            await sock.sendMessage(chatId, {
                text: `❌ فشل: ${err?.message}`
            }, { quoted: msg });
        }
    }
};
