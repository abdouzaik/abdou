import fs   from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = path.resolve(__dirname, '../../nova/data');
fs.ensureDirSync(DATA_DIR);

const DB_FILE  = path.join(DATA_DIR, 'qform.json');
const GRP_FILE = path.join(DATA_DIR, 'qform_group.json');
const GRP_CODE = 'DkiyU5dmM0MGEJqqS5ZXur';

// ── DB ────────────────────────────────────────────────────────
function readDB()      { try { return JSON.parse(fs.readFileSync(DB_FILE,  'utf8')); } catch { return { pending: [], accepted: 0, total: 0 }; } }
function writeDB(d)    { fs.writeFileSync(DB_FILE,  JSON.stringify(d, null, 2), 'utf8'); }
function readGrp()     { try { return JSON.parse(fs.readFileSync(GRP_FILE, 'utf8')); } catch { return {}; } }
function writeGrp(d)   { fs.writeFileSync(GRP_FILE, JSON.stringify(d, null, 2), 'utf8'); }

// ── رابط → JID مع cache ───────────────────────────────────────
async function resolveGroupJid(sock) {
    const cache = readGrp();
    if (cache.jid) return cache.jid;
    try {
        const info = await sock.groupGetInviteInfo(GRP_CODE);
        writeGrp({ jid: info.id, subject: info.subject });
        return info.id;
    } catch { return null; }
}

// ── الاستمارة ─────────────────────────────────────────────────
function makeForm(laqab, question, num) {
    return (
`╭─˚‧₊⊹  𝑢𝑙𝑡𝑟𝑎 𝑛𝜊𝜈𝑎 ᎪᏒᎿ ᠀⊹˚‧₊──

 *\`ぃ 𝑺𝜜𝑼𝑨𝑳 #${num} 𔒩\`* 

╰──˚‧₊⊹ 𝑢𝑙𝑡𝑟𝑎 𝑛𝜊𝜈𝑎 🪶 ⊹˚‧₊──

╭『 👤 』──────────────
┊ *ﻟــﻘـﺐ* : ${laqab}
╰────────────────────

╭『 ❓ 』──────────────
┊ ${question}
╰────────────────────

> © 𝙰𝚛𝚝`
    );
}

// ══════════════════════════════════════════════════════════════
export default {
    NovaUltra: {
        command: ['سؤال', 'ق', 'طلبات'],
        description: 'نظام الأسئلة',
        elite: 'off', group: false, prv: false, lock: 'off'
    },

    execute: async ({ sock, msg, args, sender }) => {
        const chatId = msg.key.remoteJid;

        // تجاهل القروبات لأمر السؤال
        const isGroup = chatId.endsWith('@g.us');

        const rawText = msg.message?.conversation
            || msg.message?.extendedTextMessage?.text || '';
        const pfx = global._botConfig?.prefix || global._botConfig?.defaultPrefix || '.';
        const cmd = rawText.trim().slice(pfx.length).split(/\s+/)[0]?.toLowerCase();

        const ownerNum = (global._botConfig?.owner || '').toString().replace(/\D/g,'');
        const isOwner  = msg.key.fromMe
            || (sender?.pn || '').replace(/\D/g,'').includes(ownerNum);

        // ══ .طلبات ════════════════════════════════════════════
        if (cmd === 'طلبات') {
            if (!isOwner) return;
            const db = readDB();
            return sock.sendMessage(chatId, {
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

        // ══ .ق  ═══════════════════════════════════════════════
        if (cmd === 'ق') {
            if (!isOwner) return;
            const db = readDB();

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
            return;
        }

        // ══ .سؤال ═════════════════════════════════════════════
        if (cmd === 'سؤال') {
            if (isOwner) return;
            if (isGroup)  return;

            const question = args.join(' ').trim();
            if (!question) return;

            // ريكشن 👤 على السؤال
            await sock.sendMessage(chatId, { react: { text: '👤', key: msg.key } });

            // انتظر اللقب 30 ثانية
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
            return;
        }
    }
};
