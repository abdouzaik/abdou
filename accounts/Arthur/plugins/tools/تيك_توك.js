import axios from 'axios';

const NovaUltra = {
    command: ['تيك', 'تيكتوك', 'تكتوك'],
    description: 'تحميل أو بحث فيديوهات تيك توك',
    elite: 'off',
    group: false,
    prv: false,
    lock: 'off'
};

function createCaption(title, author, duration) {
    return (
        `❀ *العنوان ›* ${title || 'بدون عنوان'}\n` +
        `> ☕︎ المؤلف › ${author?.nickname || author?.unique_id || 'مجهول'}\n` +
        `> ⏱ المدة › ${duration || '?'} ثانية\n` +
        `© mᥲძᥱ ᥕі𝗍һ ᑲᥡ 𝙰𝙱𝙳𝙾𝚄`
    );
}

function createSearchCaption(v) {
    return (
        `❀ *العنوان ›* ${v.title || 'بدون عنوان'}\n` +
        `> ☕︎ المؤلف › ${v.author?.nickname || v.author?.unique_id || 'مجهول'}\n` +
        `> 👁 مشاهدات › ${v.play_count?.toLocaleString() || '?'}\n` +
        `© mᥲძᥱ ᥕі𝗍һ ᑲᥡ 𝙰𝙱𝙳𝙾𝚄`
    );
}

function reply(sock, chatId, text, msg) {
    return sock.sendMessage(chatId, { text }, { quoted: msg });
}
function react(sock, msg, emoji) {
    return sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } });
}

async function execute({ sock, msg, args }) {
    const chatId = msg.key.remoteJid;
    const text   = args.join(' ').trim();

    if (!text) return reply(sock, chatId, '❀ أرسل رابط تيك توك أو كلمة بحث.', msg);

    const isUrl = /(?:https?:\/\/)?(?:www\.|vm\.|vt\.|t\.)?tiktok\.com\/([^\s&]+)/gi.test(text);

    await react(sock, msg, '🕒');

    try {
        if (isUrl) {
            // ── تحميل بالرابط ──
            const res  = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(text)}&hd=1`);
            const data = res.data?.data;

            if (!data?.play) return reply(sock, chatId, 'ꕥ الرابط غير صالح أو لا يحتوي على محتوى.', msg);

            const { title, duration, author, type, images, music, play } = data;
            const caption = createCaption(title, author, duration);

            if (type === 'image' && Array.isArray(images)) {
                for (const url of images) {
                    await sock.sendMessage(chatId, { image: { url }, caption }, { quoted: msg });
                }
                if (music) {
                    await sock.sendMessage(chatId, {
                        audio: { url: music },
                        mimetype: 'audio/mp4',
                        fileName: 'tiktok_audio.mp4'
                    }, { quoted: msg });
                }
            } else {
                await sock.sendMessage(chatId, { video: { url: play }, caption }, { quoted: msg });
            }

        } else {
            // ── بحث بكلمة ──
            const res = await axios({
                method: 'POST',
                url: 'https://tikwm.com/api/feed/search',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'Cookie': 'current_language=en',
                    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36'
                },
                data: { keywords: text, count: 20, cursor: 0, HD: 1 }
            });

            const results = (res.data?.data?.videos || []).filter(v => v.play);
            if (!results.length) return reply(sock, chatId, 'ꕥ لم يتم العثور على نتائج.', msg);

            for (const v of results.slice(0, 5)) {
                await sock.sendMessage(chatId, {
                    video: { url: v.play },
                    caption: createSearchCaption(v)
                }, { quoted: msg });
            }
        }

        await react(sock, msg, '✔️');

    } catch (e) {
        await react(sock, msg, '✖️');
        await reply(sock, chatId, `⚠︎ حدثت مشكلة أثناء التنفيذ.\n\n${e.message}`, msg);
    }
}

export default { NovaUltra, execute };
