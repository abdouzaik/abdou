import fetch from 'node-fetch';

// ── helpers ──────────────────────────────────────────────────
const reply = (sock, chatId, text, msg) => sock.sendMessage(chatId, { text }, { quoted: msg });
const react = (sock, msg, e) => sock.sendMessage(msg.key.remoteJid, { react: { text: e, key: msg.key } });

async function getBuffer(url) {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
}

// ── تحميل من Pinterest ───────────────────────────────────────
async function getPinterestMedia(url) {
    const apis = [
        {
            endpoint: `https://co.wuk.sh/api/json`,
            method: 'POST',
            body: JSON.stringify({ url, filenamePattern: 'basic' }),
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            extractor: res => {
                if (!res?.url) return null;
                return { type: res.url.includes('.mp4') ? 'video' : 'image', url: res.url };
            }
        },
        {
            endpoint: `https://api.rnity.dev/dl/pinterest?url=${encodeURIComponent(url)}`,
            extractor: res => {
                const u = res?.data?.url || res?.result?.url;
                if (!u) return null;
                return { type: u.includes('.mp4') ? 'video' : 'image', url: u };
            }
        },
        {
            endpoint: `https://pindown.net/api?url=${encodeURIComponent(url)}`,
            extractor: res => {
                const u = res?.url || res?.data?.url;
                if (!u) return null;
                return { type: u.includes('.mp4') ? 'video' : 'image', url: u };
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

// ── بحث Pinterest ────────────────────────────────────────────
async function searchPinterest(query) {
    try {
        const res = await fetch(
            `https://api.rnity.dev/search/pinterest?q=${encodeURIComponent(query)}&limit=9`,
            { signal: AbortSignal.timeout(8000) }
        ).then(r => r.json());
        return res?.data || res?.result || [];
    } catch { return []; }
}

// ── NovaUltra ────────────────────────────────────────────────
export default {
    NovaUltra: {
        command: ['pin', 'بينتيريست', 'pinterest'],
        description: 'تحميل أو بحث في Pinterest',
        elite: 'off', group: false, prv: false, lock: 'off'
    },
    execute: async ({ sock, msg, args }) => {
        const chatId = msg.key.remoteJid;
        const text = args.join(' ').trim();

        if (!text) return reply(sock, chatId, '📌 أرسل رابط أو كلمة بحث\nمثال: .pin قطط أو .pin https://pinterest.com/...', msg);

        await react(sock, msg, '⏳');
        const isUrl = /^https?:\/\//.test(text);

        if (isUrl) {
            // ── تحميل ──────────────────────────────────────
            const data = await getPinterestMedia(text);
            if (!data) {
                await react(sock, msg, '❌');
                return reply(sock, chatId, '❌ فشل التحميل — تأكد من صحة الرابط', msg);
            }

            try {
                const caption = `ㅤ۟∩　ׅ　★　ׅ　🅟𝖨𝖭 🅓ownload　ׄᰙ　\n\n𖣣ֶㅤ֯⌗ ☆  ⬭ *الرابط* › ${text}`;
                const buffer = await getBuffer(data.url);
                if (data.type === 'video') {
                    await sock.sendMessage(chatId, { video: buffer, caption, mimetype: 'video/mp4', fileName: 'pin.mp4' }, { quoted: msg });
                } else {
                    await sock.sendMessage(chatId, { image: buffer, caption }, { quoted: msg });
                }
                await react(sock, msg, '✅');
            } catch (e) {
                await react(sock, msg, '❌');
                await reply(sock, chatId, `❌ خطأ: ${e.message}`, msg);
            }

        } else {
            // ── بحث ────────────────────────────────────────
            const results = await searchPinterest(text);
            if (!results.length) {
                await react(sock, msg, '❌');
                return reply(sock, chatId, `❌ لا توجد نتائج لـ *${text}*`, msg);
            }

            // إرسال أول 6 صور
            let sent = 0;
            for (const item of results.slice(0, 6)) {
                const imgUrl = item?.image || item?.url || item?.media_url;
                if (!imgUrl) continue;
                try {
                    const buf = await getBuffer(imgUrl);
                    await sock.sendMessage(chatId, {
                        image: buf,
                        caption: sent === 0 ? `📌 *نتائج البحث:* ${text}` : ''
                    }, { quoted: sent === 0 ? msg : undefined });
                    sent++;
                } catch {}
            }

            if (sent === 0) {
                await react(sock, msg, '❌');
                return reply(sock, chatId, '❌ فشل إرسال النتائج', msg);
            }
            await react(sock, msg, '✅');
        }
    }
};
