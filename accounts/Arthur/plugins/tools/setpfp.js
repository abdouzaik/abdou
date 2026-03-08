import { downloadMediaMessage } from '@whiskeysockets/baileys';
import fs   from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function resizeImage(buffer) {
    const { Jimp, JimpMime } = await import('jimp');
    const img  = await Jimp.read(buffer);
    const size = Math.min(img.bitmap.width, img.bitmap.height);
    img.crop({ x: 0, y: 0, w: size, h: size }).resize({ w: 512, h: 512 });
    return img.getBuffer(JimpMime.jpeg);
}

// قراءة الأونر من كل المصادر الممكنة
function getOwnerNum() {
    // 1. global config
    if (global._botConfig?.owner)
        return global._botConfig.owner.toString().replace(/\D/g,'');
    // 2. اقرأ config.js مباشرة
    try {
        const cfgPath = path.resolve(__dirname, '../../nova/config.js');
        const raw     = fs.readFileSync(cfgPath, 'utf8');
        const match   = raw.match(/owner\s*:\s*['"`]?(\d+)/);
        if (match) return match[1];
    } catch {}
    return '';
}

export default {
    NovaUltra: {
        command: ['صورة-بوت', 'setpfp'],
        description: 'تغيير صورة البوت',
        elite: 'on',
    },
    execute: async ({ sock, msg, sender, BIDS }) => {
        const chatId = msg.key.remoteJid;

        const ownerNum  = getOwnerNum();
        const senderNum = (sender?.pn || msg.key.participant || msg.key.remoteJid || '')
            .split('@')[0].split(':')[0].replace(/\D/g,'');
        const isOwner   = msg.key.fromMe
            || (ownerNum && senderNum === ownerNum)
            || (ownerNum && senderNum.includes(ownerNum));

        if (!isOwner)
            return sock.sendMessage(chatId, { react: { text: '🚫', key: msg.key } });

        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const target = quoted || msg.message;
        if (!target?.imageMessage)
            return sock.sendMessage(chatId, { text: '📸 أرسل أو اقتبس صورة مع الأمر' }, { quoted: msg });

        const msgToDownload = quoted
            ? { message: quoted, key: { ...msg.key, id: msg.message?.extendedTextMessage?.contextInfo?.stanzaId } }
            : msg;

        await sock.sendMessage(chatId, { react: { text: '⏳', key: msg.key } });

        const media = await downloadMediaMessage(msgToDownload, 'buffer', {}).catch(() => null);
        if (!media) return sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } });

        try {
            const img    = await resizeImage(media);
            const botJid = BIDS?.pn || sock.user.id.split(':')[0] + '@s.whatsapp.net';
            await sock.updateProfilePicture(botJid, img);
            await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });
        } catch (e) {
            await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } });
            await sock.sendMessage(chatId, { text: `❌ فشل: ${e?.message}` }, { quoted: msg });
        }
    }
};
