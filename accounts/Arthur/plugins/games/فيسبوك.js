import axios from 'axios';

function react(sock, msg, e) { return sock.sendMessage(msg.key.remoteJid, { react: { text: e, key: msg.key } }); }

async function getFbMedia(url) {
    const apis = [
        { ep: () => `${global.APIs?.adonix?.url}/download/facebook?apikey=${global.APIs?.adonix?.key}&url=${encodeURIComponent(url)}`,
          get: r => r?.status && r.result?.media?.video_hd ? { type: 'video', url: r.result.media.video_hd } : null },
        { ep: () => `${global.APIs?.vreden?.url}/api/v1/download/facebook?url=${encodeURIComponent(url)}`,
          get: r => r?.status && (r.result?.download?.hd || r.result?.download?.sd)
                ? { type: 'video', url: r.result.download.hd || r.result.download.sd } : null },
        { ep: () => `${global.APIs?.delirius?.url}/download/facebook?url=${encodeURIComponent(url)}`,
          get: r => { const u = r?.urls?.find(x=>x.hd)?.hd || r?.urls?.find(x=>x.sd)?.sd; return u ? { type:'video', url: u } : null; } },
    ];
    for (const { ep, get } of apis) {
        try {
            const r = await axios.get(ep(), { timeout: 20000 });
            const res = get(r.data);
            if (res) return res;
        } catch {}
        await new Promise(r => setTimeout(r, 400));
    }
    return null;
}

const NovaUltra = {
    command: ['فيس', 'fb', 'فيسبوك'],
    description: 'تحميل فيديو من فيسبوك',
    elite: 'off', group: false, prv: false, lock: 'off'
};

async function execute({ sock, msg, args }) {
    const chatId = msg.key.remoteJid;
    const url    = args[0]?.trim();

    if (!url || !/facebook\.com|fb\.watch/i.test(url))
        return sock.sendMessage(chatId, { text: '❀ أرسل رابط فيديو فيسبوك.\n> مثال: *فيس https://fb.watch/...*' }, { quoted: msg });

    await react(sock, msg, '🕒');
    const data = await getFbMedia(url);

    if (!data) { await react(sock, msg, '❌'); return sock.sendMessage(chatId, { text: 'ꕥ تعذّر التحميل. تأكد أن الرابط صحيح وعام.' }, { quoted: msg }); }

    await sock.sendMessage(chatId, {
        video: { url: data.url }, caption: '❀ إليك الفيديو ฅ^•ﻌ•^ฅ', mimetype: 'video/mp4', fileName: 'fb.mp4'
    }, { quoted: msg });
    await react(sock, msg, '✔️');
}

export default { NovaUltra, execute };
