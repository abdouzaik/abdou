import axios from "axios";
import { downloadMediaMessage } from "@whiskeysockets/baileys";

const NovaUltra = {
    command: ["تطقيم", "ماتشينج"],
    description: "إرسال صورتين عشوائيتين",
    elite: "off",
    group: false,
    prv: false,
    lock: "off",
};

const JSON_URL = "https://raw.githubusercontent.com/Afghhjjkoo/GURU-BOT/main/lib/miku54.json";

async function execute({ sock, msg }) {
    const chatId = msg.key.remoteJid;

    try {
        await sock.sendMessage(chatId, { react: { text: "⏳", key: msg.key } });

        const { data } = await axios.get(JSON_URL);
        if (!Array.isArray(data) || data.length === 0) throw new Error("No data in JSON");

        const cita = data[Math.floor(Math.random() * data.length)];

        const [img1, img2] = await Promise.all([
            axios.get(cita.cowo, { responseType: "arraybuffer" }),
            axios.get(cita.cewe, { responseType: "arraybuffer" })
        ]);

        await sock.sendMessage(chatId, {
            image: Buffer.from(img1.data),
            caption: "*قَـلـب 🤍*"
        }, { quoted: msg });

        await sock.sendMessage(chatId, {
            image: Buffer.from(img2.data),
            caption: "*حـب 🖤*"
        });

        await sock.sendMessage(chatId, { react: { text: "✅", key: msg.key } });

    } catch (err) {
        console.error("[تطقيم]", err.message);
        await sock.sendMessage(chatId, {
            text: "❌ حدث خطأ أثناء تحميل الصور، حاول مرة أخرى."
        }, { quoted: msg });
    }
}

export default { NovaUltra, execute };
