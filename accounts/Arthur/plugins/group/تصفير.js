import fs from "fs";
import path from "path";
import { loadPlugins } from "../../handlers/plugins.js";

const NovaUltra = {
    command: "تصفير",
    description: "تصفير البوت وتنظيف الذاكرة بدون قطع الاتصال",
    elite: "off",
    group: false,
    prv: false,
    lock: "on",
};

const historyPath = path.join(process.cwd(), "nova", "data", "History.txt");

async function execute({ sock, msg }) {
    const chatId = msg.key.remoteJid;

    // مسح History.txt
    try {
        if (fs.existsSync(historyPath)) {
            fs.writeFileSync(historyPath, "", "utf8");
        }
    } catch (e) {}

    // إعادة تحميل البلجنات
    try {
        await loadPlugins();
    } catch (e) {}

    await sock.sendMessage(chatId, {
        react: { text: "✅", key: msg.key }
    });
}

export default { NovaUltra, execute };
