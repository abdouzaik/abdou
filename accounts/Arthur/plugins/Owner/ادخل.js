const linkRegex = /chat\.whatsapp\.com\/([0-9A-Za-z]{20,24})/i;

const NovaUltra = {
    command: ['ادخل', 'انضم'],
    description: 'ينضم البوت لمجموعة عبر رابط',
    elite: 'off', group: false, prv: false, lock: 'off'
};

async function execute({ sock, msg, args, sender }) {
    const chatId   = msg.key.remoteJid;
    const ownerNum = (global.config?.owner || '').toString().replace(/\D/g, '');
    const isOwner  = (sender?.pn || '').includes(ownerNum);
    if (!isOwner) return;

    const link = args.join(' ').trim();
    if (!link || !linkRegex.test(link)) {
        return sock.sendMessage(chatId, {
            text: '*❗ حط رابط المجموعة.*\n> مثال: *ادخل https://chat.whatsapp.com/...*'
        }, { quoted: msg });
    }

    const [, code] = link.match(linkRegex);
    try {
        await sock.groupAcceptInvite(code);
        await sock.sendMessage(chatId, { text: '*✔️ تم الانضمام بنجاح.*' }, { quoted: msg });
    } catch (e) {
        await sock.sendMessage(chatId, { text: `*❌ فشل الانضمام:*\n> ${e.message}` }, { quoted: msg });
    }
}

export default { NovaUltra, execute };
