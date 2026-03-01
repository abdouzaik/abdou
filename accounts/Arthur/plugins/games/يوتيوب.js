import axios from 'axios';

function react(sock, msg, e) { return sock.sendMessage(msg.key.remoteJid, { react: { text: e, key: msg.key } }); }

async function ytSearch(query) {
    try {
        const res = await axios.post(
            'https://www.youtube.com/youtubei/v1/search?prettyPrint=false',
            { context: { client: { clientName: 'WEB', clientVersion: '2.20231121.08.00' } }, query },
            { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
        );
        const items = res.data?.contents?.twoColumnSearchResultsRenderer
            ?.primaryContents?.sectionListRenderer?.contents?.[0]
            ?.itemSectionRenderer?.contents || [];
        const v = items.find(i => i.videoRenderer)?.videoRenderer;
        if (!v) return null;
        const id = v.videoId;
        return { url: `https://www.youtube.com/watch?v=${id}`, title: v.title?.runs?.[0]?.text || '', thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, duration: v.lengthText?.simpleText || '' };
    } catch { return null; }
}

async function downloadYT(url, type) {
    try {
        const r = await axios.get(`https://the-end-api.vercel.app/api/download/youtube/all_media?q=${encodeURIComponent(url)}`, { timeout: 30000 });
        return r.data?.data?.[type] || null;
    } catch { return null; }
}

const NovaUltra = {
    command: ['اغنيه', 'اغنية', 'ytmp3', 'فيديو', 'ytmp4'],
    description: 'تحميل من يوتيوب',
    elite: 'off', group: false, prv: false, lock: 'off'
};

async function execute({ sock, msg, args }) {
    const chatId  = msg.key.remoteJid;
    const rawText = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const cmd     = rawText.trim().split(/\s+/)[0].replace(/^\./, '');
    const isAudio = /اغنيه|اغنية|ytmp3/.test(cmd);
    const query   = args.join(' ').trim();

    if (!query) return sock.sendMessage(chatId, { text: `*❗ أرسل اسم ${isAudio ? 'الأغنية' : 'الفيديو'} أو رابط يوتيوب.*` }, { quoted: msg });

    await react(sock, msg, '🔍');

    const isUrl = /youtu/.test(query);
    let   info  = null;
    let   dlUrl = isUrl ? query : null;

    if (!isUrl) {
        info = await ytSearch(query);
        if (!info) { await react(sock, msg, '❌'); return sock.sendMessage(chatId, { text: '❌ لم يتم العثور على نتائج.' }, { quoted: msg }); }
        dlUrl = info.url;
    }

    await react(sock, msg, '⏳');
    const mediaUrl = await downloadYT(dlUrl, isAudio ? 'audio' : 'video');

    if (!mediaUrl) { await react(sock, msg, '❌'); return sock.sendMessage(chatId, { text: '❌ تعذّر التحميل.' }, { quoted: msg }); }

    if (info) {
        await sock.sendMessage(chatId, {
            image: { url: info.thumb },
            caption: `*⋄┄〘 يوتيوب 〙┄⋄*\n\n│ *◈ ${info.title}*\n│ *◈ المدة:* ${info.duration}\n\n> © 𝘼𝙍𝙏𝙃𝙐𝙍 𝘽𝙊𝙏`
        }, { quoted: msg });
    }

    if (isAudio) {
        await sock.sendMessage(chatId, { audio: { url: mediaUrl }, mimetype: 'audio/mpeg', fileName: `${info?.title || 'audio'}.mp3` }, { quoted: msg });
        await react(sock, msg, '🎧');
    } else {
        await sock.sendMessage(chatId, { video: { url: mediaUrl }, caption: `*◈ ${info?.title || ''}*\n> © 𝘼𝙍𝙏𝙃𝙐𝙍 𝘽𝙊𝙏`, mimetype: 'video/mp4' }, { quoted: msg });
        await react(sock, msg, '🎥');
    }
}

export default { NovaUltra, execute };
