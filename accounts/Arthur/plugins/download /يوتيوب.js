import axios from 'axios';

// ─── مساعدات ──────────────────────────────────────
function reply(sock, chatId, text, msg) {
    return sock.sendMessage(chatId, { text }, { quoted: msg });
}
function react(sock, msg, emoji) {
    return sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } });
}

const NovaUltra = {
    command: ['اغنيه', 'اغنية', 'فيديو'],
    description: 'تحميل أغنية أو فيديو من يوتيوب',
    elite: 'off',
    group: false,
    prv: false,
    lock: 'off',
};

async function execute({ sock, msg, args }) {
    const chatId    = msg.key.remoteJid;
    const rawText   = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const cmdWord   = rawText.trim().split(/\s+/)[0].replace(/^[^\u0600-\u06FFa-zA-Z0-9]/, '');
    const text      = args.join(' ').trim();

    if (!text) {
        return reply(sock, chatId,
            `*❲ ❗ ❳ يرجى إدخال نص للتحميل من اليوتيوب.*\n> مثال: *${cmdWord} القرآن الكريم*\n> أو: *${cmdWord} https://youtu.be/...*`,
            msg);
    }

    await react(sock, msg, '🔍');

    const apiUrl = `https://the-end-api.vercel.app/api/download/youtube/all_media?q=${encodeURIComponent(text)}`;

    try {
        const res  = await axios.get(apiUrl, { timeout: 30000 });
        const data = res.data?.data;

        if (!data) throw new Error('لم يتم العثور على نتائج');

        await react(sock, msg, '⏳');

        const infoCaption =
            `*⋄┄┄┄〘 تحميل اليوتيوب 〙┄┄┄⋄*\n\n` +
            `│ *◈ العنوان :* ${data.title || 'غير متوفر'}\n` +
            `│ *◈ المدة :* ${data.time || 'غير متوفر'}\n` +
            `│ *◈ الصانع :* ${data.author || 'غير متوفر'}\n` +
            `│ *◈ النشر :* ${data.ago || 'غير متوفر'}\n\n` +
            `> © 𝘼𝙍𝙏𝙃𝙐𝙍 𝘽𝙊𝙏`;

        // إرسال الصورة المصغرة مع المعلومات
        if (data.thumbnail) {
            await sock.sendMessage(chatId,
                { image: { url: data.thumbnail }, caption: infoCaption },
                { quoted: msg });
        }

        if ((cmdWord === 'اغنيه' || cmdWord === 'اغنية') && data.audio) {
            await sock.sendMessage(chatId, {
                audio: { url: data.audio },
                fileName: 'arthur_bot.mp3',
                mimetype: 'audio/mpeg'
            }, { quoted: msg });
            await react(sock, msg, '🎧');

        } else if (cmdWord === 'فيديو' && data.video) {
            await sock.sendMessage(chatId, {
                video: { url: data.video },
                caption: `*◈ ${data.title || ''}*\n\n> © 𝘼𝙍𝙏𝙃𝙐𝙍 𝘽𝙊𝙏`,
                fileName: 'arthur_bot.mp4',
                mimetype: 'video/mp4'
            }, { quoted: msg });
            await react(sock, msg, '🎥');
        } else {
            await reply(sock, chatId, 'ꕥ لم يتم العثور على الملف المطلوب.', msg);
            await react(sock, msg, '❌');
        }

    } catch (e) {
        await react(sock, msg, '❌');
        await reply(sock, chatId, `ꕥ حدث خطأ أثناء التحميل:\n> ${e.message}`, msg);
    }
}

export default { NovaUltra, execute };
