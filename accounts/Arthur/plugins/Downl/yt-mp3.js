import yts from 'yt-search';

const reply = (sock, chatId, text, msg) => sock.sendMessage(chatId, { text }, { quoted: msg });
const react  = (sock, msg, e)            => sock.sendMessage(msg.key.remoteJid, { react: { text: e, key: msg.key } });

async function getBuffer(url) {
    const { default: fetch } = await import('node-fetch');
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return Buffer.from(await res.arrayBuffer());
}

function extractYTId(url) {
    const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([a-zA-Z0-9_-]{11})/);
    return m?.[1] || '';
}

async function getYTAudio(url) {
    const { default: fetch } = await import('node-fetch');
    const apis = [
        { url: `https://co.wuk.sh/api/json`, method: 'POST',
          body: JSON.stringify({ url, isAudioOnly: true, filenamePattern: 'basic' }),
          hdrs: { 'Content-Type': 'application/json', Accept: 'application/json' },
          get: r => r?.url },
        { url: `https://api.rnity.dev/dl/youtube?url=${encodeURIComponent(url)}&format=mp3`,
          get: r => r?.data?.url || r?.result?.url },
    ];
    for (const a of apis) {
        try {
            const r = await fetch(a.url, { method: a.method||'GET', body: a.body,
                headers: { 'User-Agent': 'Mozilla/5.0', ...(a.hdrs||{}) },
                signal: AbortSignal.timeout(10000) }).then(x => x.json());
            const u = a.get(r); if (u) return u;
        } catch {}
    }
    return null;
}

async function getYTVideo(url) {
    const { default: fetch } = await import('node-fetch');
    const apis = [
        { url: `https://co.wuk.sh/api/json`, method: 'POST',
          body: JSON.stringify({ url, vQuality: '720', filenamePattern: 'basic' }),
          hdrs: { 'Content-Type': 'application/json', Accept: 'application/json' },
          get: r => r?.url },
        { url: `https://api.rnity.dev/dl/youtube?url=${encodeURIComponent(url)}&format=mp4`,
          get: r => r?.data?.url || r?.result?.url },
    ];
    for (const a of apis) {
        try {
            const r = await fetch(a.url, { method: a.method||'GET', body: a.body,
                headers: { 'User-Agent': 'Mozilla/5.0', ...(a.hdrs||{}) },
                signal: AbortSignal.timeout(10000) }).then(x => x.json());
            const u = a.get(r); if (u) return u;
        } catch {}
    }
    return null;
}

export default {
    NovaUltra: {
        command: ['play', 'mp3', 'صوت'],
        description: 'تحميل صوت من يوتيوب',
        elite: 'off', group: false, prv: false, lock: 'off'
    },
    execute: async ({ sock, msg, args }) => {
        const chatId = msg.key.remoteJid;
        if (!args[0]) return reply(sock, chatId, '🎵 مثال: .mp3 اسم الاغنية', msg);
        await react(sock, msg, '⏳');
        const r = await yts(args.join(' '));
        const v = r?.all?.[0];
        if (!v) return reply(sock, chatId, '❌ لا توجد نتائج', msg);
        const thumbBuf = await getBuffer(v.image).catch(() => null);
        const info = `🎵 *جاري التحميل...*\n\n➩ ${v.title}\n⏱ ${v.timestamp} | 🔗 ${v.url}`;
        if (thumbBuf) await sock.sendMessage(chatId, { image: thumbBuf, caption: info }, { quoted: msg });
        else await reply(sock, chatId, info, msg);
        const audioUrl = await getYTAudio(v.url);
        if (!audioUrl) { await react(sock, msg, '❌'); return reply(sock, chatId, '❌ فشل التحميل', msg); }
        const buf = await getBuffer(audioUrl);
        await sock.sendMessage(chatId, { audio: buf, fileName: `${v.title}.mp3`, mimetype: 'audio/mpeg' }, { quoted: msg });
        await react(sock, msg, '✅');
    }
};
