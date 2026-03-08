// ── أمر .مقابلة ───────────────────────────────────────────────
// يحول القروب الحالي لوجهة الأسئلة
import fs   from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = path.resolve(__dirname, '../../nova/data');
const GRP_FILE  = path.join(DATA_DIR, 'qform_group.json');
fs.ensureDirSync(DATA_DIR);

export default {
    NovaUltra: {
        command: 'مقابلة',
        description: 'يحول القروب الحالي لوجهة الأسئلة',
        elite: 'on', group: true, prv: false, lock: 'off'
    },

    execute: async ({ sock, msg }) => {
        const chatId = msg.key.remoteJid;

        try {
            const meta = await sock.groupMetadata(chatId);

            // احفظ الـ JID الجديد
            fs.writeFileSync(GRP_FILE, JSON.stringify({
                jid:     chatId,
                subject: meta.subject
            }, null, 2), 'utf8');

            await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });
            await sock.sendMessage(chatId, {
                text:
`✅ *تم تحديث وجهة الأسئلة*
┄┄┄┄┄┄┄┄┄┄┄┄┄
📌 القروب : *${meta.subject}*

الأسئلة الجديدة ستُرسل لهنا

> © 𝙰𝚛𝚝`
            }, { quoted: msg });

        } catch (e) {
            await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } });
            await sock.sendMessage(chatId, {
                text: `❌ فشل: ${e?.message}`
            }, { quoted: msg });
        }
    }
};
