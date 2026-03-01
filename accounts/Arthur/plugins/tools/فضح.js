import { downloadMediaMessage } from "@whiskeysockets/baileys";

const NovaUltra = {
    command: ["فضح", "افضح", "افضحه"],
    description: "كشف الصور والفيديوهات المخفية (مشاهدة مرة واحدة)",
    elite: "off",
    group: false,
    prv: false,
    lock: "off",
};

async function execute({ sock, msg }) {
    const chatId = msg.key.remoteJid;

    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (!quoted) {
        return await sock.sendMessage(chatId, {
            text: "✧✦┇*رد على فيديو أو صورة تم تعيينها للمشاهدة مرة واحدة فقط.*┇✦✧"
        }, { quoted: msg });
    }

    // تحديد نوع الميديا
    const mtype = Object.keys(quoted).find(k =>
        ["imageMessage", "videoMessage"].includes(k)
    );

    if (!mtype) {
        return await sock.sendMessage(chatId, {
            text: "✧✦┇*رد على فيديو أو صورة تم تعيينها للمشاهدة مرة واحدة فقط.*┇✦✧"
        }, { quoted: msg });
    }

    const mediaMsg = quoted[mtype];

    // التحقق إنها viewOnce
    if (!mediaMsg?.viewOnce) {
        return await sock.sendMessage(chatId, {
            text: "✧✦┇*رد على فيديو أو صورة تم تعيينها للمشاهدة مرة واحدة فقط.*┇✦✧"
        }, { quoted: msg });
    }

    // تحميل الميديا
    const buffer = await downloadMediaMessage(
        { message: quoted, key: msg.message.extendedTextMessage.contextInfo },
        "buffer",
        {}
    );

    const type = mtype.replace("Message", "");
    let caption = mediaMsg?.caption || "";
    caption += "\n\n*لا يسمح لك بإخفاء شيء هنا! 🤫*";

    await sock.sendMessage(chatId, {
        [type]: buffer,
        caption
    }, { quoted: msg });
}

export default { NovaUltra, execute };
