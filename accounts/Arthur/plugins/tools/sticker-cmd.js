// ========== ستيكر بقص مربع ==========
import path from 'path';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';
import { fileTypeFromBuffer } from 'file-type';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import crypto from 'crypto';
import webp from 'node-webpmux';
import { downloadMediaMessage } from '@whiskeysockets/baileys';

// ── تحديد مسار ffmpeg ──
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(__dirname, '../../tmp');
fs.ensureDirSync(TMP);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// إضافة EXIF للستيكر
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function addExif(buffer, packname = 'ULTRA NOVA', author = 'ART') {
    const img = new webp.Image();
    const id  = crypto.randomBytes(32).toString('hex');
    const json = {
        'sticker-pack-id': id,
        'sticker-pack-name': packname,
        'sticker-pack-publisher': author,
        emojis: ['🐺']
    };
    const exifAttr = Buffer.from([
        0x49,0x49,0x2a,0x00,0x08,0x00,0x00,0x00,
        0x01,0x00,0x41,0x57,0x07,0x00,0x00,0x00,
        0x00,0x00,0x16,0x00,0x00,0x00
    ]);
    const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
    const exif = Buffer.concat([exifAttr, jsonBuf]);
    exif.writeUIntLE(jsonBuf.length, 14, 4);
    await img.load(buffer);
    img.exif = exif;
    return await img.save(null);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// تحويل لـ WebP مربع بالقص
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function toSquareWebp(inputPath, outputPath, isAnimated) {
    return new Promise((resolve, reject) => {
        // القص: يأخذ أصغر بُعد ويقص المنتصف → مربع 512×512
        // crop=min(iw,ih):min(iw,ih):(iw-min(iw,ih))/2:(ih-min(iw,ih))/2
        const cropFilter = isAnimated
            ? "crop=min(iw\\,ih):min(iw\\,ih):(iw-min(iw\\,ih))/2:(ih-min(iw\\,ih))/2,scale=512:512,fps=15"
            : "crop=min(iw\\,ih):min(iw\\,ih):(iw-min(iw\\,ih))/2:(ih-min(iw\\,ih))/2,scale=512:512";

        const cmd = ffmpeg(inputPath)
            .outputOptions([
                '-vcodec', 'libwebp',
                '-vf', cropFilter,
                '-loop', isAnimated ? '0' : '1',
                '-preset', 'default',
                '-an',
                '-vsync', '0',
                '-t', isAnimated ? '8' : '1', // حد 8 ثوان للمتحرك
            ])
            .toFormat('webp')
            .save(outputPath);

        cmd.on('end', resolve);
        cmd.on('error', reject);
    });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// الدالة الرئيسية
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function makeSticker(buffer) {
    const type = await fileTypeFromBuffer(buffer);
    if (!type) throw new Error('نوع الملف غير معروف');

    const isAnimated = /video|gif/i.test(type.mime) || ['mp4','webm','gif','mov'].includes(type.ext);

    const id      = Date.now() + '_' + crypto.randomBytes(4).toString('hex');
    const tmpIn   = path.join(TMP, `${id}.${type.ext}`);
    const tmpOut  = path.join(TMP, `${id}.webp`);

    await fs.writeFile(tmpIn, buffer);

    try {
        await toSquareWebp(tmpIn, tmpOut, isAnimated);
        const result = await fs.readFile(tmpOut);
        return await addExif(result);
    } finally {
        await fs.remove(tmpIn).catch(() => {});
        await fs.remove(tmpOut).catch(() => {});
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// البلوجن
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export default {
    NovaUltra: {
        command: "ستيكر",
        description: "يحول صورة أو فيديو لستيكر مربع مقصوص",
        elite: "on",
    },
    execute: async ({ sock, msg }) => {
        const chatId = msg.key.remoteJid;

        // ── جلب الرسالة المستهدفة (اقتباس أو الرسالة نفسها) ──
        const ctxInfo = msg.message?.extendedTextMessage?.contextInfo;
        const quotedMsg = ctxInfo?.quotedMessage
            ? { message: ctxInfo.quotedMessage, key: { ...msg.key, id: ctxInfo.stanzaId, participant: ctxInfo.participant } }
            : null;

        const targetMsg = quotedMsg || msg;
        const targetContent = targetMsg.message || {};

        const hasImage = !!(targetContent.imageMessage);
        const hasVideo = !!(targetContent.videoMessage);
        const hasGif   = !!(targetContent.videoMessage?.gifPlayback);
        const hasSticker = !!(targetContent.stickerMessage);

        if (!hasImage && !hasVideo && !hasGif && !hasSticker) {
            return await sock.sendMessage(chatId, {
                text: '📎 أرسل أو اقتبس *صورة / فيديو / GIF* مع الأمر'
            }, { quoted: msg });
        }

        // ── إشعار انتظار ──
        await sock.sendMessage(chatId, {
            text: '⏳ جاري التحويل...'
        }, { quoted: msg });

        try {
            const buffer = await downloadMediaMessage(targetMsg, 'buffer', {});
            if (!buffer || buffer.length === 0) throw new Error('فشل التحميل');

            const sticker = await makeSticker(buffer);

            await sock.sendMessage(chatId, {
                sticker
            }, { quoted: msg });

        } catch (err) {
            console.error('[STICKER ERROR]', err?.message);
            await sock.sendMessage(chatId, {
                text: `❌ فشل التحويل: ${err?.message || 'خطأ غير معروف'}`
            }, { quoted: msg });
        }
    }
};
