// ═══ كاشف أحداث المجموعة التلقائي ═══
// يرصد: تغيير الاسم، الصورة، الرابط، الإعدادات، الترقية، الخفض

if (!global.featureHandlers) global.featureHandlers = [];
if (!global.groupEvHandlers) global.groupEvHandlers = [];

global.featureHandlers = global.featureHandlers.filter(h => h._src !== 'autodetect_msg');
global.groupEvHandlers = global.groupEvHandlers.filter(h => h._src !== 'autodetect_group');

// ─── رسالة وهمية للاقتباس ────────────────────────
const fakeQuote = {
    key: {
        participants: '0@s.whatsapp.net',
        remoteJid: 'status@broadcast',
        fromMe: false,
        id: 'arthur-autodetect'
    },
    message: {
        contactMessage: {
            vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN:𝙰𝙱𝙳𝙾𝚄\nEND:VCARD'
        }
    },
    participant: '0@s.whatsapp.net'
};

// ─── معالج رسائل النظام (تغيير اسم/صورة/رابط/إعدادات) ──
async function autodetectMsgHandler(sock, msg, { isGroup, chatId }) {
    if (!isGroup || !msg.messageStubType) return true;

    const stub   = msg.messageStubType;
    const params = msg.messageStubParameters || [];
    const sender = msg.key.participant || msg.key.remoteJid;
    const tag    = `@${sender.split('@')[0]}`;

    let pp = null;
    try { pp = await sock.profilePictureUrl(chatId, 'image'); } catch {}

    // 21 = تغيير اسم المجموعة
    if (stub === 21) {
        await sock.sendMessage(chatId, {
            text: `*❍━━━══━━❪🌸❫━━══━━━❍*\n*❍⇇تـم تـغـيـر اسـم الـمـجـمـوعـه*\n*❍⇇بـواسـطـة↜❪${tag}❫*\n*❍⇇الاسـم الـجـديـد↶*\n❍⇇┊${params[0] || ''}┊\n*❍━━━══━━❪🌸❫━━══━━━❍*`,
            mentions: [sender]
        }, { quoted: fakeQuote });
    }

    // 22 = تغيير صورة المجموعة
    else if (stub === 22) {
        await sock.sendMessage(chatId, {
            image: { url: pp || 'https://qu.ax/QGAVS.jpg' },
            caption: `*❍━━━══━━❪🌸❫━━══━━━❍*\n*❍⇇تـم تـغـيـر صـورة الـمـجـمـوعـه*\n*❍⇇بـواسـطـة↜❪${tag}❫*\n*❍━━━══━━❪🌸❫━━══━━━❍*`,
            mentions: [sender]
        }, { quoted: fakeQuote });
    }

    // 23 = تغيير رابط المجموعة
    else if (stub === 23) {
        await sock.sendMessage(chatId, {
            text: `*❍━━━══━━❪🌸❫━━══━━━❍*\n*❍⇇تـم تـغـيـر رابـط الـمـجـمـوعـه*\n*❍⇇بـواسـطـة↜❪${tag}❫*\n*❍━━━══━━❪🌸❫━━══━━━❍*`,
            mentions: [sender]
        }, { quoted: fakeQuote });
    }

    // 25 = تعديل إعدادات الرسائل
    else if (stub === 25) {
        const mode = params[0] === 'on' ? '*للأدمن فقط*' : '*للجميع*';
        await sock.sendMessage(chatId, {
            text: `*❍━━━══━━❪🌸❫━━══━━━❍*\n*❍⇇تـم تـغـيـر إعـدادات الـمـجـمـوعـه*\n*❍⇇بـواسـطـة↜❪${tag}❫*\n❍⇇${mode} *من يمكنهم التحدث*\n*❍━━━══━━❪🌸❫━━══━━━❍*`,
            mentions: [sender]
        }, { quoted: fakeQuote });
    }

    // 26 = تغيير إعدادات التعديل
    else if (stub === 26) {
        const mode = params[0] === 'on' ? '*للأدمن فقط*' : '*للجميع*';
        await sock.sendMessage(chatId, {
            text: `*❍━━━══━━❪🌸❫━━══━━━❍*\n*❍⇇تـم تـغـيـر إعـدادات الـمـجـمـوعـه*\n*❍⇇بـواسـطـة↜❪${tag}❫*\n❍⇇${mode} *من يمكنهم تعديل الإعدادات*\n*❍━━━══━━❪🌸❫━━══━━━❍*`,
            mentions: [sender]
        }, { quoted: fakeQuote });
    }

    return true;
}
autodetectMsgHandler._src = 'autodetect_msg';
global.featureHandlers.push(autodetectMsgHandler);

// ─── معالج أحداث الأعضاء (ترقية / خفض) ──────────
async function autodetectGroupHandler(sock, { id: chatId, participants, action }) {
    if (action !== 'promote' && action !== 'demote') return;

    for (const p of participants) {
        const tag = `@${p.split('@')[0]}`;

        if (action === 'promote') {
            await sock.sendMessage(chatId, {
                text: `*❍━━━══━━❪🌸❫━━══━━━❍*\n*❍⇇تم ترقية↜❪${tag}❫*\n*❍↜مبارك لك الترقية 🐤👏*\n*❍━━━══━━❪🌸❫━━══━━━❍*`,
                mentions: [p]
            }, { quoted: fakeQuote });
        } else {
            await sock.sendMessage(chatId, {
                text: `*❍━━━══━━❪🌸❫━━══━━━❍*\n*❍⇇تم إعفاء↜❪${tag}❫*\n*❍↜للأسف تم إعفاؤك من رتبتك 😔💔*\n*❍━━━══━━❪🌸❫━━══━━━❍*`,
                mentions: [p]
            }, { quoted: fakeQuote });
        }
    }
}
autodetectGroupHandler._src = 'autodetect_group';
global.groupEvHandlers.push(autodetectGroupHandler);

// ─── NovaUltra (بدون أوامر — يعمل تلقائياً) ──────
const NovaUltra = {
    command: [],
    description: 'كاشف أحداث المجموعة التلقائي',
    elite: 'off', group: false, prv: false, lock: 'off'
};
async function execute() {}

export default { NovaUltra, execute };
