import fetch from 'node-fetch';

// ── helpers ──────────────────────────────────────────────────
const reply = (sock, chatId, text, msg) => sock.sendMessage(chatId, { text }, { quoted: msg });
const react = (sock, msg, e) => sock.sendMessage(msg.key.remoteJid, { react: { text: e, key: msg.key } });

async function getBuffer(url) {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
}

// ── APIs مجانية بدون مفاتيح ─────────────────────────────────
async function getFacebookMedia(url) {
    const apis = [
        {
            endpoint: `https://co.wuk.sh/api/json`,
            method: 'POST',
            body: JSON.stringify({ url, vQuality: 'max', filenamePattern: 'basic' }),
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            extractor: res => {
                if (!res?.url) return null;
                return { type: 'video', url: res.url, resolution: 'HD' };
            }
        },
        {
            endpoint: `https://api.rnity.dev/dl/facebook?url=${encodeURIComponent(url)}`,
            extractor: res => {
                const hd = res?.data?.hd || res?.result?.hd;
                const sd = res?.data?.sd || res?.result?.sd;
                const u = hd || sd;
                if (!u) return null;
                return { type: 'video', url: u, resolution: hd ? 'HD' : 'SD' };
            }
        },
        {
            endpoint: `https://www.fbdownloader.site/api?url=${encodeURIComponent(url)}`,
            extractor: res => {
                const u = res?.hd || res?.sd || res?.data?.hd || res?.data?.sd;
                if (!u) return null;
                return { type: 'video', url: u, resolution: res?.hd ? 'HD' : 'SD' };
            }
        },
        {
            endpoint: `https://fdown.net/download.php`,
            method: 'POST',
            body: new URLSearchParams({ URLz: url }).toString(),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' },
            extractor: res => {
                const u = res?.hd_link || res?.sd_link;
                if (!u) return null;
                return { type: 'video', url: u, resolution: res?.hd_link ? 'HD' : 'SD' };
            }
        },
    ];

    for (const { endpoint, method, body, headers, extractor } of apis) {
        try {
            const res = await fetch(endpoint, {
                method: method || 'GET',
                body,
                headers: { 'User-Agent': 'Mozilla/5.0', ...(headers || {}) },
                signal: AbortSignal.timeout(8000)
            }).then(r => r.json());
            const result = extractor(res);
            if (result?.url) return result;
        } catch {}
    }
    return null;
}

// ── NovaUltra ────────────────────────────────────────────────
export default {
    NovaUltra: {
        command: ['fb', 'فيس', 'facebook'],
        description: 'تحميل فيديو من فيسبوك',
        elite: 'off', group: false, prv: false, lock: 'off'
    },
    execute: async ({ sock, msg, args }) => {
        const chatId = msg.key.remoteJid;
        const url = args[0];

        if (!url) return reply(sock, chatId, '📎 أرسل رابط فيسبوك مع الأمر\nمثال: .fb https://facebook.com/...', msg);
        if (!/facebook\.com|fb\.watch|video\.fb\.com/i.test(url))
            return reply(sock, chatId, '❌ الرابط غير صالح — أرسل رابط فيسبوك صحيح', msg);

        await react(sock, msg, '⏳');

        const data = await getFacebookMedia(url);
        if (!data) {
            await react(sock, msg, '❌');
            return reply(sock, chatId, '❌ فشل التحميل — تأكد أن الفيديو عام وليس خاصاً', msg);
        }

        try {
            const caption =
                `ㅤ۟∩　ׅ　★　ׅ　🅕𝖡 🅓ownload　ׄᰙ　\n\n` +
                `𖣣ֶㅤ֯⌗ ☆  ׄ ⬭ *الجودة* › ${data.resolution || 'HD'}\n` +
                `𖣣ֶㅤ֯⌗ ☆  ׄ ⬭ *الرابط* › ${url}`;

            const buffer = await getBuffer(data.url);
            await sock.sendMessage(chatId, { video: buffer, caption, mimetype: 'video/mp4', fileName: 'fb.mp4' }, { quoted: msg });
            await react(sock, msg, '✅');
        } catch (e) {
            await react(sock, msg, '❌');
            await reply(sock, chatId, `❌ خطأ في الإرسال: ${e.message}`, msg);
        }
    }
};
