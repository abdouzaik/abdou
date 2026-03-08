// ========== ستيكر بقص مربع + ضغط ==========
import path      from 'path';
import fs        from 'fs-extra';
import { fileURLToPath } from 'url';
import { fileTypeFromBuffer } from 'file-type';
import ffmpeg    from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import crypto    from 'crypto';
import webp      from 'node-webpmux';
import { downloadMediaMessage } from '@whiskeysockets/baileys';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(__dirname, '../../tmp');
fs.ensureDirSync(TMP);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EXIF
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function addExif(buffer, packname = 'ULTRA NOVA', author = 'ART') {
    const img  = new webp.Image();
    const id   = crypto.randomBytes(32).toString('hex');
    const json = {
        'sticker-pack-id':        id,
        'sticker-pack-name':      packname,
        'sticker-pack-publisher': author,
        emojis: ['🐺']
    };
    const exifAttr = Buffer.from([
        0x49,0x49,0x2a,0x00,0x08,0x00,0x00,0x00,
        0x01,0x00,0x41,0x57,0x07,0x00,0x00,0x00,
        0x00,0x00,0x16,0x00,0x00,0x00
    ]);
    const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
    const exif   = Buffer.concat([exifAttr, jsonBuf]);
    exif.writeUIntLE(jsonBuf.length, 14, 4);
    await img.load(buffer);
    img.exif = exif;
    return await img.save(null);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// صورة ثابتة
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function toStaticWebp(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .outputOptions([
                '-vcodec', 'libwebp',
                '-vf', "crop=min(iw\\,ih):min(iw\\,ih):(iw-min(iw\\,ih))/2:(ih-min(iw\\,ih))/2,scale=512:512",
                '-loop', '1',
                '-preset', 'default',
                '-compression_level', '6',
                '-quality', '80',
                '-an', '-vsync', '0', '-t', '1',
            ])
            .toFormat('webp').save(outputPath)
            .on('end', resolve).on('error', reject);
    });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// متحرك — محاولة واحدة
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function toAnimatedWebp(inputPath, outputPath, quality, fps, size) {
    const crop = `crop=min(iw\\,ih):min(iw\\,ih):(iw-min(iw\\,ih))/2:(ih-min(iw\\,ih))/2,scale=${size}:${size},fps=${fps}`;
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .outputOptions([
                '-vcodec', 'libwebp_anim',
                '-vf', crop,
                '-loop', '0',
                '-preset', 'default',
                '-compression_level', '6',
                '-quality', String(quality),
                '-an', '-vsync', '0', '-t', '6',
            ])
            .toFormat('webp').save(outputPath)
            .on('end', resolve)
            .on('error', () => {
                // fallback libwebp
                ffmpeg(inputPath)
                    .outputOptions([
                        '-vcodec', 'libwebp',
                        '-vf', crop,
                        '-loop', '0',
                        '-preset', 'default',
                        '-compression_level', '6',
                        '-quality', String(quality),
                        '-an', '-vsync', '0', '-t', '6',
                    ])
                    .toFormat('webp').save(outputPath)
                    .on('end', resolve).on('error', reject);
            });
    });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// الدالة الرئيسية
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const MAX_SIZE = 900 * 1024; // 900KB

async function makeSticker(buffer) {
    const type = await fileTypeFromBuffer(buffer);
    if (!type) throw new Error('نوع الملف غير معروف');

    const isAnimated = /video|gif/i.test(type.mime)
        || ['mp4','webm','gif','mov'].includes(type.ext);

    const id    = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const tmpIn = path.join(TMP, `${id}.${type.ext}`);
    const tmpOut = path.join(TMP, `${id}.webp`);

    await fs.writeFile(tmpIn, buffer);

    try {
        if (!isAnimated) {
            await toStaticWebp(tmpIn, tmpOut);
            return await addExif(await fs.readFile(tmpOut));
        }

        // ── ضغط تدريجي للمتحرك ────────────────────────────────
        const attempts = [
            { quality: 75, fps: 10, size: 512 },
            { quality: 60, fps:  8, size: 384 },
            { quality: 45, fps:  6, size: 256 },
            { quality: 30, fps:  5, size: 256 },
        ];

        let finalBuf = null;
        for (const { quality, fps, size } of attempts) {
            if (fs.existsSync(tmpOut)) await fs.remove(tmpOut);
            await toAnimatedWebp(tmpIn, tmpOut, quality, fps, size);
            if (!fs.existsSync(tmpOut)) continue;
            const buf = await fs.readFile(tmpOut);
            if (buf.length <= MAX_SIZE) { finalBuf = buf; break; }
        }

        if (!finalBuf && fs.existsSync(tmpOut))
            finalBuf = await fs.readFile(tmpOut);

        if (!finalBuf) throw new Error('فشل التحويل');
        return await addExif(finalBuf);

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
        command: 'ستيكر',
        description: 'يحول صورة أو فيديو لستيكر مربع مضغوط',
        elite: 'on',
    },
    execute: async ({ sock, msg }) => {
        const chatId   = msg.key.remoteJid;
        const ctxInfo  = msg.message?.extendedTextMessage?.contextInfo;
        const quotedMsg = ctxInfo?.quotedMessage
            ? { message: ctxInfo.quotedMessage, key: { ...msg.key, id: ctxInfo.stanzaId, participant: ctxInfo.participant } }
            : null;

        const targetMsg     = quotedMsg || msg;
        const targetContent = targetMsg.message || {};

        if (!targetContent.imageMessage && !targetContent.videoMessage && !targetContent.stickerMessage) {
            return sock.sendMessage(chatId, {
                text: '📎 أرسل أو اقتبس *صورة / فيديو / GIF* مع الأمر'
            }, { quoted: msg });
        }

        await sock.sendMessage(chatId, { react: { text: '⏳', key: msg.key } });

        try {
            const buffer = await downloadMediaMessage(targetMsg, 'buffer', {});
            if (!buffer?.length) throw new Error('فشل تحميل الملف');

            const sticker = await makeSticker(buffer);
            await sock.sendMessage(chatId, { sticker }, { quoted: msg });
            await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });

        } catch (err) {
            console.error('[STICKER ERROR]', err?.message);
            await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } });
            await sock.sendMessage(chatId, {
                text: `❌ فشل: ${err?.message || 'خطأ غير معروف'}`
            }, { quoted: msg });
        }
    }
};
