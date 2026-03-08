// ══════════════════════════════════════════════════════════════
//  نظام الأسئلة
//
//  المستخدم (خاص):
//    .سؤال [نصه]  ← ريكشن 👤
//    [اسم المرسل] ← ريكشن ✔️ (خلال 30 ثانية)
//    لو ما كتب الاسم → ينتهي صامتاً
//    يقدر يطرح أي عدد من الأسئلة
//
//  الأونر (خاص أو قروب):
//    .ق        ← يقبل سؤال عشوائي وينشر الاستمارة
//    .طلبات   ← إجمالي / مقبول / متبقي
// ══════════════════════════════════════════════════════════════
import fs   from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = path.resolve(__dirname, '../../nova/data');
fs.ensureDirSync(DATA_DIR);

const DB_FILE   = path.join(DATA_DIR, 'qform.json');
const GRP_FILE  = path.join(DATA_DIR, 'qform_group.json');
const GRP_CODE  = 'DkiyU5dmM0MGEJqqS5ZXur'; // كود الرابط

function readGrp()    { try { return JSON.parse(require('fs').readFileSync(GRP_FILE,'utf8')); } catch { return {}; } }
function writeGrp(d)  { require('fs').writeFileSync(GRP_FILE, JSON.stringify(d,null,2),'utf8'); }

// يحول كود الدعوة → JID (مع cache)
async function resolveGroupJid(sock) {
    const cache = readGrp();
    if (cache.jid) return cache.jid;
    try {
        const info = await sock.groupGetInviteInfo(GRP_CODE);
        const jid  = info.id;
        writeGrp({ jid, subject: info.subject });
        return jid;
    } catch { return null; }
}

function readDB() {
    try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
    catch { return { pending: [], accepted: 0, total: 0 }; }
}
function writeDB(db) {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

// ── الاستمارة المنسقة ─────────────────────────────────────────
function makeForm(senderName, question, num) {
    return (
`╭─˚‧₊⊹  𝑢𝑙𝑡𝑟𝑎 𝑛𝜊𝜈𝑎 ᎪᏒᎿ ᠀⊹˚‧₊──

 *\`ぃ 𝑸𝒖𝒆𝒔𝒕𝒊𝒐𝒏 #${num} 𔒩\`* 

╰──˚‧₊⊹ 𝑢𝑙𝑡𝑟𝑎 𝑛𝜊𝜈𝑎 🪶 ⊹˚‧₊──

╭『 👤 』──────────────
┊ *لــــقــــب* : ${senderName}
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
        description: 'نظام الأسئلة بالاستمارة',
        elite: 'off', group: false, prv: true, lock: 'off'
    },

    execute: async ({ sock, msg, args, sender, BIDS }) => {
        const chatId  = msg.key.remoteJid;
        const pfx     = global._botConfig?.prefix || global._botConfig?.defaultPrefix || '.';
        const rawText = msg.message?.conversation
            || msg.message?.extendedTextMessage?.text || '';
        const cmd     = rawText.trim().slice(pfx.length).split(/\s+/)[0]?.toLowerCase();

        const ownerNum = (global._botConfig?.owner || '').toString().replace(/\D/g,'');
        const ownerJid = ownerNum + '@s.whatsapp.net';
        const isOwner  = msg.key.fromMe
            || (sender?.pn || '').replace(/\D/g,'').includes(ownerNum);

        // ══════════════════════════════════════════════════════
        // .طلبات
        // ══════════════════════════════════════════════════════
        if (cmd === 'طلبات') {
            if (!isOwner) return;
            const db = readDB();
            const text =
`╭─˚‧₊⊹ 𝑢𝑙𝑡𝑟𝑎 𝑛𝜊𝜈𝑎 ⊹˚‧₊──

📊 *الطلبات*
┄┄┄┄┄┄┄┄┄┄┄┄┄┄
📨 إجمالي  : *${db.total}*
✅ مقبولة  : *${db.accepted}*
⏳ متبقية  : *${db.pending.length}*

> © 𝘼𝙍𝙏𝙃𝙐𝙍 𝘽𝙊𝙏`;
            return sock.sendMessage(chatId, { text }, { quoted: msg });
        }

        // ══════════════════════════════════════════════════════
        // .ق  ← قبول عشوائي
        // ══════════════════════════════════════════════════════
        if (cmd === 'ق') {
            if (!isOwner) return;
            const db = readDB();

            if (!db.pending.length) {
                await sock.sendMessage(chatId, { react: { text: '📭', key: msg.key } });
                return;
            }

            // اختر عشوائي
            const idx    = Math.floor(Math.random() * db.pending.length);
            const picked = db.pending[idx];

            db.accepted++;
            db.pending.splice(idx, 1);
            writeDB(db);

            // ── حوّل الرابط لـ JID ─────────────────────────
            const groupJid = await resolveGroupJid(sock);
            if (!groupJid) {
                await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } });
                return;
            }

            // انشر الاستمارة في القروب المحدد
            const form = makeForm(picked.senderName, picked.question, db.accepted);
            await sock.sendMessage(groupJid, { text: form });

            // ريكشن للأونر
            await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });
            return;
        }

        // ══════════════════════════════════════════════════════
        // .سؤال [نصه]  ← من المستخدم في الخاص
        // ══════════════════════════════════════════════════════
        if (cmd === 'سؤال') {
            if (isOwner) return;
            if (chatId.endsWith('@g.us')) return;

            const question = args.join(' ').trim();
            if (!question) return;

            // ريكشن 👤 على رسالة السؤال
            await sock.sendMessage(chatId, { react: { text: '👤', key: msg.key } });

            // ── انتظر اللقب في رسالة ثانية (30 ثانية) ───────
            const TIMEOUT = 30_000;
            const cleanup = () => {
                sock.ev.off('messages.upsert', nameListener);
                clearTimeout(timer);
            };

            const timer = setTimeout(cleanup, TIMEOUT); // صامت

            const nameListener = async ({ messages: msgs }) => {
                const m = msgs?.[0];
                if (!m?.message) return;
                if (m.key.remoteJid !== chatId) return;
                if (m.key.fromMe) return;

                const input = (
                    m.message.conversation ||
                    m.message.extendedTextMessage?.text || ''
                ).trim();
                if (!input) return;

                // لو كتب أمر ثاني — تجاهل وأنهِ
                if (input.startsWith(pfx)) { cleanup(); return; }

                cleanup();

                // احفظ السؤال باللقب
                const db = readDB();
                db.pending.push({ senderName: input, question, chatId, ts: Date.now() });
                db.total++;
                writeDB(db);

                // ريكشن ✔️ على رسالة اللقب
                await sock.sendMessage(chatId, { react: { text: '✔️', key: m.key } });
            };

            sock.ev.on('messages.upsert', nameListener);
            return;
        }
    }
};
