import axios from "axios";
import FormData from "form-data";
import { downloadMediaMessage } from "@whiskeysockets/baileys";

const NovaUltra = {
    command: ["hd", "enhance", "remini"],
    description: "تحسين جودة الصور",
    elite: "off",
    group: false,
    prv: false,
    lock: "off",
};

const STELLAR_URL = "https://api.stellarwa.xyz";
const STELLAR_KEY = "YukiWaBot";

async function uploadToUguu(buffer) {
    const body = new FormData();
    body.append("files[]", buffer, "image.jpg");
    const res = await axios.post("https://uguu.se/upload.php", body, {
        headers: body.getHeaders()
    });
    return res.data?.files?.[0]?.url || null;
}

async function getEnhancedBuffer(url) {
    const res = await axios.get(`${STELLAR_URL}/tools/upscale?url=${url}&key=${STELLAR_KEY}`, {
        responseType: "arraybuffer"
    });
    if (res.status !== 200) return null;
    return Buffer.from(res.data);
}

async function execute({ sock, msg }) {
    const chatId = msg.key.remoteJid;

    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const targetMsg = quoted
        ? { message: quoted, key: { remoteJid: chatId } }
        : msg;

    const mtype = Object.keys(targetMsg.message || {}).find(k =>
        k === "imageMessage"
    );

    const mime = targetMsg.message?.[mtype]?.mimetype || "";

    if (!mtype || !mime) {
        return await sock.sendMessage(chatId, {
            text: "❗ أرسل أو رد على *صورة* لتحسين جودتها."
        }, { quoted: msg });
    }

    if (!/image\/(jpe?g|png)/.test(mime)) {
        return await sock.sendMessage(chatId, {
            text: `❗ الصيغة *${mime}* غير مدعومة. أرسل صورة JPG أو PNG.`
        }, { quoted: msg });
    }

    await sock.sendMessage(chatId, { react: { text: "⏳", key: msg.key } });

    try {
        const buffer = await downloadMediaMessage(targetMsg, "buffer", {});

        const uploadedUrl = await uploadToUguu(buffer);
        if (!uploadedUrl) {
            return await sock.sendMessage(chatId, {
                text: "❌ فشل رفع الصورة، حاول مرة ثانية."
            }, { quoted: msg });
        }

        const enhancedBuffer = await getEnhancedBuffer(uploadedUrl);
        if (!enhancedBuffer) {
            return await sock.sendMessage(chatId, {
                text: "❌ فشل تحسين الصورة، حاول مرة ثانية."
            }, { quoted: msg });
        }

        await sock.sendMessage(chatId, {
            image: enhancedBuffer,
            caption: ""
        }, { quoted: msg });

        await sock.sendMessage(chatId, { react: { text: "✅", key: msg.key } });

    } catch (e) {
        console.error("[hd]", e.message);
        await sock.sendMessage(chatId, {
            text: `❌ خطأ: ${e.message}`
        }, { quoted: msg });
    }
}

export default { NovaUltra, execute };
