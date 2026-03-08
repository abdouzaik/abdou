// ── أمر .ق ───────────────────────────────────────────────────
import { readDB, writeDB, resolveGroupJid, makeForm } from './qform-shared.js';

export default {
    NovaUltra: {
        command: 'ق',
        description: 'قبول سؤال عشوائي ونشره',
        elite: 'on', group: false, prv: false, lock: 'off'
    },
    execute: async ({ sock, msg }) => {
        const chatId = msg.key.remoteJid;
        const db     = readDB();

        if (!db.pending.length) {
            await sock.sendMessage(chatId, { react: { text: '📭', key: msg.key } });
            return;
        }

        const idx    = Math.floor(Math.random() * db.pending.length);
        const picked = db.pending[idx];
        db.accepted++;
        db.pending.splice(idx, 1);
        writeDB(db);

        const groupJid = await resolveGroupJid(sock);
        if (!groupJid) {
            await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } });
            return;
        }

        const form = makeForm(picked.laqab, picked.question, db.accepted);
        await sock.sendMessage(groupJid, { text: form });
        await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });
    }
};
