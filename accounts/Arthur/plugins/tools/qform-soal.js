// ── أمر .سؤال ────────────────────────────────────────────────
import { readDB, writeDB } from './qform-shared.js';

export default {
    NovaUltra: {
        command: 'سؤال',
        description: 'أرسل سؤالك للبوت',
        elite: 'off', group: false, prv: true, lock: 'off'
    },
    execute: async ({ sock, msg, args }) => {
        const chatId  = msg.key.remoteJid;

        const question = args.join(' ').trim();
        if (!question) return; // صامت

        // ريكشن 👤 على السؤال
        await sock.sendMessage(chatId, { react: { text: '👤', key: msg.key } });

        // انتظر اللقب 30 ثانية
        const pfx = global._botConfig?.prefix || global._botConfig?.defaultPrefix || '.';
        let done = false;

        const cleanup = () => {
            if (done) return;
            done = true;
            sock.ev.off('messages.upsert', onName);
            clearTimeout(timer);
        };

        const timer = setTimeout(cleanup, 30_000);

        async function onName({ messages: msgs }) {
            const m = msgs?.[0];
            if (!m?.message) return;
            if (m.key.remoteJid !== chatId) return;
            if (m.key.fromMe) return;

            const input = (
                m.message.conversation ||
                m.message.extendedTextMessage?.text || ''
            ).trim();

            if (!input) return;
            if (input.startsWith(pfx)) { cleanup(); return; }

            cleanup();

            const db = readDB();
            db.pending.push({ laqab: input, question, chatId, ts: Date.now() });
            db.total++;
            writeDB(db);

            await sock.sendMessage(chatId, { react: { text: '✔️', key: m.key } });
        }

        sock.ev.on('messages.upsert', onName);
    }
};
