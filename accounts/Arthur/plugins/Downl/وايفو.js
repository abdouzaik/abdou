import axios from 'axios';

function reply(sock, chatId, text, msg) {
    return sock.sendMessage(chatId, { text }, { quoted: msg });
}
function react(sock, msg, emoji) {
    return sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } });
}

const NovaUltra = {
    command: ['ساكو', 'waifu'],
    description: 'صورة وايفو عشوائية 🌸',
    elite: 'off',
    group: false,
    prv: false,
    lock: 'off',
};

async function execute({ sock, msg, args }) {
    const chatId = msg.key.remoteJid;
    try {
        await react(sock, msg, '🕒');
        const res = await axios.get('https://api.waifu.pics/sfw/waifu', { timeout: 10000 });
        const url = res.data?.url;
        if (!url) throw new Error('لم يتم العثور على صورة');
        await sock.sendMessage(chatId, { image: { url }, caption: '*❀ Take this wife* ฅ^•ﻌ•^ฅ' }, { quoted: msg });
        await react(sock, msg, '✔️');
    } catch (e) {
        await react(sock, msg, '✖️');
        await reply(sock, chatId, `⚠︎ حدثت مشكلة:\n> ${e.message}`, msg);
    }
}

export default { NovaUltra, execute };
