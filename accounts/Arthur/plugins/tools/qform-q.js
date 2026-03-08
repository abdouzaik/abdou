// ── أمر .ق ───────────────────────────────────────────────────
import { readDB, writeDB, resolveGroupJid, makeForm } from './qform-shared.js';
import fs   from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR   = path.resolve(__dirname, '../../nova/data');
const LAST_FILE  = path.join(DATA_DIR, 'qform_last.json');

export function readLast()   { try { return JSON.parse(fs.readFileSync(LAST_FILE, 'utf8')); } catch { return {}; } }
export function writeLast(d) { fs.writeFileSync(LAST_FILE, JSON.stringify(d, null, 2), 'utf8'); }

export async function sendOldest(sock, chatId, msg) {
    const db = readDB();

    if (!db.pending.length) {
        await sock.sendMessage(chatId, { react: { text: '📭', key: msg.key } });
        return false;
    }

    // الأقدم أولاً
    db.pending.sort((a, b) => a.ts - b.ts);
    const picked = db.pending[0];
    db.pending.shift();
    db.accepted++;
    writeDB(db);

    const groupJid = await resolveGroupJid(sock);
    if (!groupJid) {
        await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } });
        return false;
    }

    const form    = makeForm(picked.laqab, picked.question, db.accepted);
    const sent    = await sock.sendMessage(groupJid, { text: form });

    // احفظ آخر رسالة مرسلة (للسكيب)
    writeLast({
        msgKey:   sent.key,
        groupJid,
        laqab:    picked.laqab,
        question: picked.question,
        num:      db.accepted
    });

    await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });
    return true;
}

export default {
    NovaUltra: {
        command: 'ق',
        description: 'يرسل أقدم سؤال للقروب',
        elite: 'on', group: false, prv: false, lock: 'off'
    },
    execute: async ({ sock, msg }) => {
        await sendOldest(sock, msg.key.remoteJid, msg);
    }
};
