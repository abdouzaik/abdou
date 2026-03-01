import axios from 'axios';

function react(sock, msg, e) { return sock.sendMessage(msg.key.remoteJid, { react: { text: e, key: msg.key } }); }

async function searchPinterest(query) {
    const apis = [
        { ep: () => `${global.APIs?.stellar?.url}/search/pinterest?query=${encodeURIComponent(query)}&key=${global.APIs?.stellar?.key}`,
          get: r => r?.data?.length ? r.data.map(d => ({ image: d.hd || d.image, title: d.title || '' })) : null },
        { ep: () => `${global.APIs?.delirius?.url}/search/pinterestv2?text=${encodeURIComponent(query)}`,
          get: r => r?.data?.length ? r.data.map(d => ({ image: d.hd || d.image, title: d.title || '' })) : null },
        { ep: () => `${global.APIs?.vreden?.url}/api/v2/search/pinterest?query=${encodeURIComponent(query)}&limit=10`,
          get: r => r?.response?.pins?.length ? r.response.pins.map(p => ({ image: p.media?.images?.orig?.url, title: p.title || '' })) : null },
    ];
    for (const { ep, get } of apis) {
        try {
            const r = await axios.get(ep(), { timeout: 15000 });
            const res = get(r.data);
            if (res?.length) return res.filter(x => x.image);
        } catch {}
    }
    return [];
}

const NovaUltra = {
    command: ['بينتيريست', 'pin', 'pinterest'],
    description: 'بحث عن صور من Pinterest',
    elite: 'off', group: false, prv: false, lock: 'off'
};

async function execute({ sock, msg, args }) {
    const chatId = msg.key.remoteJid;
    const query  = args.join(' ').trim();

    if (!query) return sock.sendMessage(chatId, { text: '❀ أدخل كلمة البحث.\n> مثال: *بينتيريست anime*' }, { quoted: msg });

    await react(sock, msg, '🔍');
    const results = await searchPinterest(query);

    if (!results.length) { await react(sock, msg, '❌'); return sock.sendMessage(chatId, { text: `❀ لا نتائج لـ "${query}"` }, { quoted: msg }); }

    const picks = results.sort(() => Math.random() - 0.5).slice(0, 6);

    for (const r of picks) {
        try {
            await sock.sendMessage(chatId, { image: { url: r.image }, caption: r.title ? `*${r.title}*` : '' }, { quoted: msg });
        } catch {}
    }
    await react(sock, msg, '✔️');
}

export default { NovaUltra, execute };
