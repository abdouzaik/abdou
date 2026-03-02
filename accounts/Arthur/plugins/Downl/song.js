import { spawn }  from 'child_process';
import fs          from 'fs';
import path        from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const reply = (sock, chatId, text, msg) => sock.sendMessage(chatId, { text }, { quoted: msg });
const react = (sock, msg, e) => sock.sendMessage(msg.key.remoteJid, { react: { text: e, key: msg.key } });

// ── مسار yt-dlp (يشتغل على Termux + Linux) ─────────────────
function getYtdlpPath() {
    const paths = [
        '/data/data/com.termux/files/usr/bin/yt-dlp', // Termux
        '/usr/local/bin/yt-dlp',                       // Linux
        '/usr/bin/yt-dlp',
        'yt-dlp'                                       // في الـ PATH
    ];
    for (const p of paths) {
        try {
            if (p === 'yt-dlp' || fs.existsSync(p)) return p;
        } catch {}
    }
    return 'yt-dlp';
}

// ── تشغيل yt-dlp مع promise ─────────────────────────────────
function runYtdlp(args) {
    return new Promise((resolve, reject) => {
        const bin = getYtdlpPath();
        const proc = spawn(bin, args);
        let out = '', err = '';
        proc.stdout.on('data', d => out += d.toString());
        proc.stderr.on('data', d => err += d.toString());
        proc.on('close', code => code === 0 ? resolve(out) : reject(new Error(err.slice(-300))));
        proc.on('error', reject);
    });
}

// ══════════════════════════════════════════════════════════════
export default {
    NovaUltra: {
        command: ['شغل', 'اغنية', 'song'],
        description: 'تحميل أغنية من يوتيوب بجودة عالية',
        elite: 'off', group: false, prv: false, lock: 'off'
    },

    execute: async ({ sock, msg, args }) => {
        const chatId = msg.key.remoteJid;
        const query  = args.join(' ').trim();

        if (!query)
            return reply(sock, chatId, '🎵 أرسل اسم الأغنية\nمثال: .شغل Despacito', msg);

        await react(sock, msg, '🔎');
        await reply(sock, chatId, `🔎 جاري البحث عن "${query}"...`, msg);

        // ── 1. جلب معلومات الفيديو ──────────────────────────
        let videoData;
        try {
            const raw = await runYtdlp([
                `ytsearch1:${query}`,
                '--skip-download',
                '--print-json',
                '--no-playlist'
            ]);
            videoData = JSON.parse(raw.trim().split('\n')[0]);
        } catch (e) {
            await react(sock, msg, '❌');
            return reply(sock, chatId, `❌ فشل البحث: ${e.message}`, msg);
        }

        const title      = videoData.title        || 'غير معروف';
        const uploader   = videoData.uploader     || 'غير معروف';
        const duration   = videoData.duration_string || 'غير معروف';
        const thumb      = videoData.thumbnail    || null;
        const uploadDate = videoData.upload_date
            ? `${videoData.upload_date.slice(6,8)}/${videoData.upload_date.slice(4,6)}/${videoData.upload_date.slice(0,4)}`
            : 'غير معروف';

        // ── 2. إرسال التفاصيل + الصورة ──────────────────────
        const caption =
            `🎶 *${title}*\n` +
            `🎤 القناة : ${uploader}\n` +
            `⏱️ المدة  : ${duration}\n` +
            `📅 التاريخ: ${uploadDate}\n\n` +
            `> 𝑨𝑹𝑻𝑯𝑼𝑹 ⚡`;

        if (thumb) {
            await sock.sendMessage(chatId, {
                image: { url: thumb }, caption
            }, { quoted: msg });
        } else {
            await reply(sock, chatId, caption, msg);
        }

        // ── 3. تحميل الصوت ───────────────────────────────────
        const tmpId   = Date.now();
        const tmpFile = path.join(__dirname, `..`, `..`, `tmp`, `song_${tmpId}.mp3`);
        fs.mkdirSync(path.dirname(tmpFile), { recursive: true });

        await react(sock, msg, '⏳');

        try {
            await runYtdlp([
                `ytsearch1:${query}`,
                '-x',
                '--audio-format', 'mp3',
                '--audio-quality', '0',
                '--no-playlist',
                '-o', tmpFile
            ]);

            if (!fs.existsSync(tmpFile))
                throw new Error('الملف الصوتي لم يُنشأ');

            await sock.sendMessage(chatId, {
                audio:    fs.readFileSync(tmpFile),
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
