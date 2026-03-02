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
async function getInstagramMedia(url) {
    const apis = [
        {
            endpoint: `https://api.rnity.dev/dl/instagram?url=${encodeURIComponent(url)}`,
            extractor: res => {
                const item = res?.data?.[0] || res?.result?.[0];
                if (!item?.url) return null;
                return { type: item.type === 'video' || item.mime?.includes('video') ? 'video' : 'image', url: item.url };
            }
        },
        {
            endpoint: `https://api.lolhuman.xyz/api/instagram?apikey=lolhuman&url=${encodeURIComponent(url)}`,
            extractor: res => {
                const d = res?.result;
                if (!d?.video && !d?.image) return null;
                return { type: d.video ? 'video' : 'image', url: d.video || d.image };
            }
        },
        {
            endpoint: `https://co.wuk.sh/api/json`,
            method: 'POST',
            body: JSON.stringify({ url, vQuality: 'max', filenamePattern: 'basic' }),
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            extractor: res => {
                if (!res?.url) return null;
                return { type: res.url.includes('.mp4') ? 'video' : 'image', url: res.url };
            }
        },
        {
            endpoint: `https://instavideosave.net/api?url=${encodeURIComponent(url)}`,
            extractor: res => {
                const v = res?.data?.[0]?.url || res?.url;
                if (!v) return null;
                return { type: 'video', url: v };
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
        command: ['ig', 'انستا', 'instagram'],
        description: 'تحميل من انستقرام',
        elite: 'off', group: false, prv: false, lock: 'off'
    },
    execute: async ({ sock, msg, args }) => {
        const chatId = msg.key.remoteJid;
        const url = args[0];

        if (!url) return reply(sock, chatId, '📎 أرسل رابط انستقرام مع الأمر\nمثال: .ig https://instagram.com/p/...', msg);
        if (!/instagram\.com\/(p|reel|share|tv|stories)\//i.test(url))
            return reply(sock, chatId, '❌ الرابط غير صالح — أرسل رابط انستقرام صحيح', msg);

        await react(sock, msg, '⏳');

        const data = await getInstagramMedia(url);
        if (!data) {
            await react(sock, msg, '❌');
            return reply(sock, chatId, '❌ فشل التحميل — المنشور قد يكون خاصاً أو الرابط منتهي', msg);
        }

        try {
            const caption =
                `ㅤ۟∩　ׅ　★ ໌　ׅ　🅘𝖦 🅓ownload　ׄᰙ\n\n` +
                `𖣣ֶㅤ֯⌗ ❀  ⬭ *الرابط* › ${url}`;

            if (data.type === 'video') {
                const buffer = await getBuffer(data.url);
                await sock.sendMessage(chatId, { video: buffer, caption, mimetype: 'video/mp4', fileName: 'ig.mp4' }, { quoted: msg });
            } else {
                const buffer = await getBuffer(data.url);
                await sock.sendMessage(chatId, { image: buffer, caption }, { quoted: msg });
            }
            await react(sock, msg, '✅');
        } catch (e) {
            await react(sock, msg, '❌');
            await reply(sock, chatId, `❌ خطأ في الإرسال: ${e.message}`, msg);
        }
    }
};
