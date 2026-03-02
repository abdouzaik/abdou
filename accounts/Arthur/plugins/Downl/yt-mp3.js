import yts from 'yt-search';
import fetch from 'node-fetch';

import yts   from 'yt-search';
import fetch  from 'node-fetch';

// ── helpers ──────────────────────────────────────────────────
const reply = (sock, chatId, text, msg) => sock.sendMessage(chatId, { text }, { quoted: msg });
const react = (sock, msg, e) => sock.sendMessage(msg.key.remoteJid, { react: { text: e, key: msg.key } });

async function getBuffer(url) {
    const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(30000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
}

// ── YouTube search ───────────────────────────────────────────
async function searchYT(query) {
    const r = await yts(query);
    return r?.all?.[0] || null;
}

// ── YouTube download APIs (مجانية بدون مفاتيح) ──────────────
async function getYTAudio(url) {
    const apis = [
        {
            endpoint: `https://co.wuk.sh/api/json`,
            method: 'POST',
            body: JSON.stringify({ url, isAudioOnly: true, filenamePattern: 'basic' }),
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            extractor: res => res?.url
        },
        {
            endpoint: `https://api.rnity.dev/dl/youtube?url=${encodeURIComponent(url)}&format=mp3`,
            extractor: res => res?.data?.url || res?.result?.url
        },
        {
            endpoint: `https://yt-api.p.rapidapi.com/dl?id=${extractYTId(url)}&cgeo=US`,
            headers: { 'X-RapidAPI-Key': 'free', 'X-RapidAPI-Host': 'yt-api.p.rapidapi.com' },
            extractor: res => res?.adaptiveFormats?.find(f => f.mimeType?.includes('audio'))?.url
        },
    ];

    for (const { endpoint, method, body, headers, extractor } of apis) {
        try {
            const res = await fetch(endpoint, {
                method: method || 'GET',
                body,
                headers: { 'User-Agent': 'Mozilla/5.0', ...(headers || {}) },
                signal: AbortSignal.timeout(10000)
            }).then(r => r.json());
            const url = extractor(res);
            if (url) return url;
        } catch {}
    }
    return null;
}

async function getYTVideo(url) {
    const apis = [
        {
            endpoint: `https://co.wuk.sh/api/json`,
            method: 'POST',
            body: JSON.stringify({ url, vQuality: '720', filenamePattern: 'basic' }),
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            extractor: res => res?.url
        },
        {
            endpoint: `https://api.rnity.dev/dl/youtube?url=${encodeURIComponent(url)}&format=mp4`,
            extractor: res => res?.data?.url || res?.result?.url
        },
    ];

    for (const { endpoint, method, body, headers, extractor } of apis) {
        try {
            const res = await fetch(endpoint, {
                method: method || 'GET',
                body,
                headers: { 'User-Agent': 'Mozilla/5.0', ...(headers || {}) },
                signal: AbortSignal.timeout(10000)
            }).then(r => r.json());
            const url = extractor(res);
            if (url) return url;
        } catch {}
    }
    return null;
}

function extractYTId(url) {
    const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([a-zA-Z0-9_-]{11})/);
    return m?.[1] || '';
}

export default {{
    NovaUltra: {{
        command: ['play', 'mp3', 'صوت'],
        description: 'تحميل صوت من يوتيوب',
        elite: 'off', group: false, prv: false, lock: 'off'
    }},
    execute: async ({{ sock, msg, args }}) => {{
        const chatId = msg.key.remoteJid;
        if (!args[0]) return reply(sock, chatId, '🎵 أرسل اسم أو رابط\nمثال: .mp3 اسم الاغنية', msg);
        await react(sock, msg, '⏳');
        const query = args.join(' ');
        try {{
            const video = await searchYT(query);
            if (!video) return reply(sock, chatId, '❌ لا توجد نتائج', msg);
            const thumbBuf = await getBuffer(video.image).catch(() => null);
            const info = `🎵 *جاري التحميل...*\n\n➩ ${{video.title}}\n⏱ ${{video.timestamp}} | 🔗 ${{video.url}}`;
            if (thumbBuf) await sock.sendMessage(chatId, {{ image: thumbBuf, caption: info }}, {{ quoted: msg }});
            else await reply(sock, chatId, info, msg);
            const audioUrl = await getYTAudio(video.url);
            if (!audioUrl) {{ await react(sock, msg, '❌'); return reply(sock, chatId, '❌ فشل التحميل — جرب مرة أخرى', msg); }}
            const audioBuf = await getBuffer(audioUrl);
            await sock.sendMessage(chatId, {{ audio: audioBuf, fileName: `${{video.title}}.mp3`, mimetype: 'audio/mpeg' }}, {{ quoted: msg }});
            await react(sock, msg, '✅');
        }} catch (e) {{
            await react(sock, msg, '❌');
            await reply(sock, chatId, `❌ خطأ: ${{e.message}}`, msg);
        }}
    }}
}};