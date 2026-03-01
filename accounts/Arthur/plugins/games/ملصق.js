import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { exec } from 'child_process';
import { promisify } from 'util';

const execP = promisify(exec);
const tmp   = path.join(process.cwd(), 'tmp');
if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });

function react(sock, msg, e) { return sock.sendMessage(msg.key.remoteJid, { react: { text: e, key: msg.key } }); }

async function toWebp(buffer, isVideo = false) {
    const id  = Date.now();
    const inp = path.join(tmp, `stk_in_${id}.${isVideo ? 'mp4' : 'jpg'}`);
    const out = path.join(tmp, `stk_out_${id}.webp`);
    fs.writeFileSync(inp, buffer);
    try {
        if (isVideo) {
            await execP(`ffmpeg -i "${inp}" -vf "scale=512:512:force_original_aspect_ratio=decrease,fps=15" -vcodec libwebp -lossless 0 -compression_level 6 -q:v 50 -loop 0 -preset picture -an -t 6 "${out}" -y`);
        } else {
            await execP(`ffmpeg -i "${inp}" -vf "scale=512:512:force_original_aspect_ratio=decrease" "${out}" -y`);
        }
        const data = fs.readFileSync(out);
        return data;
    } finally {
        try { fs.unlinkSync(inp); } catch {}
        try { fs.unlinkSync(out); } catch {}
    }
}

const NovaUltra = {
    command: ['ملصق', 'متحرك', 'sticker', 'فيد', 's'],
    description: 'تحويل صورة أو فيديو لملصق',
    elite: 'off', group: false, prv: false, lock: 'off'
};

async function execute({ sock, msg, args }) {
    const chatId = msg.key.remoteJid;

    // البحث عن الميديا — رسالة مقتبسة أو الرسالة الحالية
    const ctx   = msg.message?.extendedTextMessage?.contextInfo;
    const qMsg  = ctx?.quotedMessage;
    const qType = qMsg ? Object.keys(qMsg)[0] : null;

    let buffer   = null;
    let isVideo  = false;

    if (qType === 'imageMessage' || qType === 'videoMessage' || qType === 'stickerMessage') {
        const quotedMsg = {
            key: { remoteJid: chatId, id: ctx.stanzaId, participant: ctx.participant },
            message: qMsg
        };
        try {
            const stream = await sock.downloadMediaMessage(quotedMsg);
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            buffer  = Buffer.concat(chunks);
            isVideo = qType === 'videoMessage';
        } catch (e) {
            return sock.sendMessage(chatId, { text: `❌ خطأ في التحميل: ${e.message}` }, { quoted: msg });
        }
    } else if (msg.message?.imageMessage || msg.message?.videoMessage) {
        try {
            const stream = await sock.downloadMediaMessage(msg);
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            buffer  = Buffer.concat(chunks);
            isVideo = !!msg.message?.videoMessage;
        } catch (e) {
            return sock.sendMessage(chatId, { text: `❌ خطأ: ${e.message}` }, { quoted: msg });
        }
    }

    if (!buffer) return sock.sendMessage(chatId, { text: '❀ أرسل صورة أو فيديو أو رد عليه.' }, { quoted: msg });

    await react(sock, msg, '⏳');

    try {
        const webp = await toWebp(buffer, isVideo);
        await sock.sendMessage(chatId, { sticker: webp }, { quoted: msg });
        await react(sock, msg, '✅');
    } catch (e) {
        await react(sock, msg, '❌');
        await sock.sendMessage(chatId, { text: `❌ فشل التحويل: ${e.message}\n> تأكد إن ffmpeg مثبت.` }, { quoted: msg });
    }
}

export default { NovaUltra, execute };
