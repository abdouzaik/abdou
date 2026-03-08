// ── أمر .طلبات ───────────────────────────────────────────────
import { readDB } from './qform-shared.js';

export default {
    NovaUltra: {
        command: 'طلبات',
        description: 'إحصائيات الأسئلة',
        elite: 'on', group: false, prv: false, lock: 'off'
    },
    execute: async ({ sock, msg }) => {
        const chatId = msg.key.remoteJid;
        const db     = readDB();
        await sock.sendMessage(chatId, {
            text:
`╭─˚‧₊⊹ 𝑢𝑙𝑡𝑟𝑎 𝑛𝜊𝜈𝑎 ⊹˚‧₊──

📊 *الطلبات*
┄┄┄┄┄┄┄┄┄┄┄┄┄┄
📨 إجمالي : *${db.total}*
✅ مقبولة : *${db.accepted}*
⏳ متبقية : *${db.pending.length}*

> © 𝙰𝚛𝚝`
        }, { quoted: msg });
    }
};
