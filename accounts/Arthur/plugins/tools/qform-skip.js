// ── أمر .سكيب ────────────────────────────────────────────────
// يحذف السؤال الأخير من القروب ويبعث التالي تلقائياً
import { readLast, writeLast, sendOldest } from './qform-q.js';
import { readDB, writeDB } from './qform-shared.js';

export default {
    NovaUltra: {
        command: ['سكيب', 'skip'],
        description: 'يتخطى السؤال الحالي ويبعث التالي',
        elite: 'on', group: false, prv: false, lock: 'off'
    },

    execute: async ({ sock, msg }) => {
        const chatId = msg.key.remoteJid;
        const last   = readLast();

        if (!last?.msgKey || !last?.groupJid) {
            await sock.sendMessage(chatId, { react: { text: '📭', key: msg.key } });
            return;
        }

        await sock.sendMessage(chatId, { react: { text: '⏳', key: msg.key } });

        // ── احذف الرسالة من القروب ───────────────────────────
        try {
            await sock.sendMessage(last.groupJid, {
                delete: last.msgKey
            });
        } catch {
            // ممكن تكون انحذفت أصلاً — كمّل
        }

        // ── امسح الـ last ─────────────────────────────────────
        writeLast({});

        // ── رجّع العداد خطوة (السؤال ما اتقبل فعلياً) ──────
        const db = readDB();
        if (db.accepted > 0) {
            db.accepted--;
            writeDB(db);
        }

        // ── ابعث التالي تلقائياً ─────────────────────────────
        const hadNext = await sendOldest(sock, chatId, msg);

        if (!hadNext) {
            await sock.sendMessage(chatId, {
                text: '📭 ما في أسئلة ثانية'
            }, { quoted: msg });
        }
    }
};
