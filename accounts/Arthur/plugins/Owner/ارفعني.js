const NovaUltra = {
    command: ['ادمني'],
    description: 'ترقية عضو لمشرف',
    elite: 'off', group: true, prv: false, lock: 'off'
};

async function execute({ sock, msg, args, sender }) {
    const chatId   = msg.key.remoteJid;
    const ownerNum = (global.config?.owner || '').toString().replace(/\D/g, '');
    const isOwner  = (sender?.pn || '').includes(ownerNum);
    if (!isOwner) return;

    // ارفع المطورين
    if (args[0] === 'المطورين') {
        try {
            const devs = (global.config?.owners || []).map(id => id + '@s.whatsapp.net');
            if (!devs.length) return sock.sendMessage(chatId, { text: 'لا يوجد مطورون مضافون.' }, { quoted: msg });
            await sock.groupParticipantsUpdate(chatId, devs, 'add').catch(() => {});
            await sock.groupParticipantsUpdate(chatId, devs, 'promote');
            await sock.sendMessage(chatId, { text: '✅ تم إضافة وترقية جميع المطورين.' }, { quoted: msg });
        } catch (e) {
            await sock.sendMessage(chatId, { text: `❌ خطأ: ${e.message}` }, { quoted: msg });
        }
        return;
    }

    // ارفع المرسل
    try {
        const meta = await sock.groupMetadata(chatId);
        const isAdmin = meta.participants.find(p =>
            p.id.split('@')[0].split(':')[0] === sender.pn.split('@')[0]
        )?.admin;

        if (isAdmin) return sock.sendMessage(chatId, { text: 'أنت مشرف بالفعل.' }, { quoted: msg });
        await sock.groupParticipantsUpdate(chatId, [sender.pn], 'promote');
        await sock.sendMessage(chatId, { text: '✅ تمت ترقيتك لمشرف.' }, { quoted: msg });
    } catch (e) {
        await sock.sendMessage(chatId, { text: `❌ خطأ: ${e.message}` }, { quoted: msg });
    }
}

export default { NovaUltra, execute };
