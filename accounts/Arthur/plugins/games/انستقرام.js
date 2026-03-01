import axios from 'axios';

function react(sock, msg, e) { return sock.sendMessage(msg.key.remoteJid, { react: { text: e, key: msg.key } }); }

async function getIgMedia(url) {
    const apis = [
        { ep: () => `${global.APIs?.adonix?.url}/download/instagram?apikey=${global.APIs?.adonix?.key}&url=${encodeURIComponent(url)}`,
          get: r => r?.status && r.data?.length ? r.data.map(v => ({ type: /mp4|video/i.test(v.url) ? 'video' : 'image', url: v.url })) : null },
        { ep: () => `${global.APIs?.vreden?.url}/api/igdownload?url=${encodeURIComponent(url)}`,
          get: r => r?.resultado?.respuesta?.datos?.length ? r.resultado.respuesta.datos.map(v => ({ type: 'image', url: v.url })) : null },
        { ep: () => `${global.APIs?.delirius?.url}/download/instagram?url=${encodeURIComponent(url)}`,
          get: r => r?.status && r.data?.length ? r.data.map(v => ({ type: v.type === 'video' ? 'video' : 'image', url: v.url })) : null },
        { ep: () => `${global.APIs?.nekolabs?.url}/downloader/instagram?url=${encodeURIComponent(url)}`,
          get: r => r?.success && r.result?.downloadUrl?.length ? r.result.downloadUrl.map(u => ({ type: r.result.metadata?.isVideo ? 'video' : 'image', url: u })) : null },
    ];
    for (const { ep, get } of apis) {
        try {
            const r = await axios.get(ep(), { timeout: 20000 });
            const res = get(r.data);
            if (res?.length) return res;
        } catch {}
        await new Promise(r => setTimeout(r, 400));
    }
    return null;
}

const NovaUltra = {
    command: ['انستا', 'ig', 'انستقرام'],
    description: 'تحميل من انستقرام',
    elite: 'off', group: false, prv: false, lock: 'off'
};

async function execute({ sock, msg, args }) {
    const chatId = msg.key.remoteJid;
    const url    = args[0]?.trim();

    if (!url || !/instagram\.com/i.test(url))
        return sock.sendMessage(chatId, { text: '❀ أرسل رابط انستقرام.' }, { quoted: msg });

    await react(sock, msg, '🕒');
    const items = await getIgMedia(url);

    if (!items) { await react(sock, msg, '❌'); return sock.sendMessage(chatId, { text: 'ꕥ تعذّر التحميل.' }, { quoted: msg }); }

    for (const item of items.slice(0, 5)) {
        if (item.type === 'video') {
            await sock.sendMessage(chatId, { video: { url: item.url }, caption: '❀ إليك ฅ^•ﻌ•^ฅ', mimetype: 'video/mp4' }, { quoted: msg });
        } else {
            await sock.sendMessage(chatId, { image: { url: item.url }, caption: '❀ إليك ฅ^•ﻌ•^ฅ' }, { quoted: msg });
        }
    }
    await react(sock, msg, '✔️');
}

export default { NovaUltra, execute };
