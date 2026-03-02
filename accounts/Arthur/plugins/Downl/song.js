import { execSync, spawn } from 'child_process';
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const reply = (sock, chatId, text, msg) => sock.sendMessage(chatId, { text }, { quoted: msg });
const react = (sock, msg, e) => sock.sendMessage(msg.key.remoteJid, { react: { text: e, key: msg.key } });

// ── إيجاد yt-dlp في أي بيئة ─────────────────────────────────
function findYtdlp() {
    const candidates = [
        '/usr/bin/yt-dlp',
        '/usr/local/bin/yt-dlp',
        '/data/data/com.termux/files/usr/bin/yt-dlp',
        '/root/.local/bin/yt-dlp',
    ];
    // جرب which أولاً
    try { return execSync('which yt-dlp').toString().trim(); } catch {}
    // جرب المسارات المعروفة
    for (const p of candidates) {
        try { if (fs.existsSync(p)) return p; } catch {}
    }
    return 'yt-dlp'; // fallback
}

const YTDLP = findYtdlp();

function runYtdlp(args) {
    return new Promise((resolve, reject) => {
        const proc = spawn(YTDLP, args);
        let out = '', err = '';
        proc.stdout.on('data', d => out += d.toString());
        proc.stderr.on('data', d => err += d.toString());
        proc.on('close', code => code === 0 ? resolve(out) : reject(new Error(err.slice(-300))));
        proc.on('error', e => reject(new Error(`yt-dlp not found: ${e.message}`)));
    });
}

export default {
    NovaUltra: {
        command: ['شغل', 'اغنية', 'song'],
        description: 'تحميل أغنية من يوتيوب',
        elite: 'off', group: false, prv: false, lock: 'off'
    },
    execute: async ({ sock, msg, args }) => {
        const chatId = msg.key.remoteJid;
        const query  = args.join(' ').trim();

        if (!query) return reply(sock, chatId, '🎵 مثال: .شغل Despacito', msg);

        await react(sock, msg, '🔎');
        await reply(sock, chatId, `🔎 جاري البحث عن "${query}"...`, msg);

        // ── 1. معلومات الفيديو ───────────────────────────────
        let videoData;
        try {
            const raw = await runYtdlp([
                `ytsearch1:${query}`,
                '--skip-download', '--print-json', '--no-playlist'
            ]);
            videoData = JSON.parse(raw.trim().split('\n')[0]);
        } catch (e) {
            await react(sock, msg, '❌');
            return reply(sock, chatId, `❌ فشل البحث: ${e.message}`, msg);
        }

        const title    = videoData.title            || 'غير معروف';
        const uploader = videoData.uploader         || 'غير معروف';
        const duration = videoData.duration_string  || 'غير معروف';
        const thumb    = videoData.thumbnail        || null;
        const date     = videoData.upload_date
            ? `${videoData.upload_date.slice(6,8)}/${videoData.upload_date.slice(4,6)}/${videoData.upload_date.slice(0,4)}`
            : 'غير معروف';

        const caption =
            `🎶 *${title}*\n🎤 ${uploader}\n⏱️ ${duration} | 📅 ${date}\n\n> 𝑨𝑹𝑻𝑯𝑼𝑹 ⚡`;

        if (thumb) {
            await sock.sendMessage(chatId, { image: { url: thumb }, caption }, { quoted: msg });
        } else {
            await reply(sock, chatId, caption, msg);
        }

        // ── 2. تحميل الصوت ──────────────────────────────────
        const tmpFile = path.join(process.cwd(), 'tmp', `song_${Date.now()}.mp3`);
        fs.mkdirSync(path.dirname(tmpFile), { recursive: true });

        await react(sock, msg, '⏳');

        try {
            await runYtdlp([
                `ytsearch1:${query}`,
                '-x', '--audio-format', 'mp3', '--audio-quality', '0',
                '--no-playlist', '-o', tmpFile
            ]);

            if (!fs.existsSync(tmpFile)) throw new Error('الملف لم يُنشأ');

            await sock.sendMessage(chatId, {
                audio: fs.readFileSync(tmpFile),
                mimetype: 'audio/mpeg',
                fileName: `${title}.mp3`
            }, { quoted: msg });

            await react(sock, msg, '✅');
        } catch (e) {
            await react(sock, msg, '❌');
            await reply(sock, chatId, `❌ فشل التحميل: ${e.message}`, msg);
        } finally {
            try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch {}
        }
    }
};
