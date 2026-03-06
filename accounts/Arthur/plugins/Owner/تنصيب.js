// ══════════════════════════════════════════════════════════════
//  أمر .تنصيب — يربط بوت فرعي جديد
// ══════════════════════════════════════════════════════════════
import fs   from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { createAccount, ensureAccountFiles, getAccountsList } from '../../accounts/accountUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const accountsDir = path.resolve(__dirname, '..', '..', 'accounts');

// ── سجل الطلبات المعلّقة { phone: { name, code, chatId, ts } } ──
const pendingInstalls = new Map();

// ── توليد كود عشوائي 8 أحرف ──────────────────────────────────
function genCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// ── كتابة config.js للحساب الفرعي ────────────────────────────
async function writeSubConfig(accountName, phone, code) {
    const configPath = path.join(accountsDir, accountName, 'nova', 'config.js');
    if (!fs.existsSync(configPath)) return false;

    let content = await fs.readFile(configPath, 'utf8');

    // استبدال pairing phone وcode
    content = content
        .replace(/(pairing\s*:\s*\{[^}]*phone\s*:\s*)["'][^"']*["']/s,  `$1"${phone}"`)
        .replace(/(pairing\s*:\s*\{[^}]*code\s*:\s*)["'][^"']*["']/s,   `$1"${code}"`);

    await fs.writeFile(configPath, content, 'utf8');
    return true;
}

// ── حفظ الحساب الفرعي في قائمة الفروع ────────────────────────
async function registerSub(accountName) {
    const subFile = path.join(accountsDir, 'sub_accounts.json');
    let list = [];
    try { list = JSON.parse(await fs.readFile(subFile, 'utf8')); } catch {}
    if (!list.includes(accountName)) list.push(accountName);
    await fs.writeFile(subFile, JSON.stringify(list, null, 2), 'utf8');
}

// ══════════════════════════════════════════════════════════════
export default {
    NovaUltra: {
        command: ['تنصيب', 'install'],
        description: 'تنصيب بوت فرعي جديد',
        elite: 'off', group: false, prv: true, lock: 'off'
    },

    execute: async ({ sock, msg, args }) => {
        const chatId  = msg.key.remoteJid;
        const phone   = args[0]?.replace(/[^0-9]/g, '');

        // ── بدون رقم → اعرض التعليمات ────────────────────────
        if (!phone || phone.length < 7) {
            return sock.sendMessage(chatId, {
                text:
`╭━━━━━━━━━━━━━━━━━╮
┃  🤖 *تنصيب بوت فرعي*
╰━━━━━━━━━━━━━━━━━╯

*الخطوات:*
1️⃣ أرسل: \`.تنصيب [رقمك]\`
   مثال: \`.تنصيب 966501234567\`

2️⃣ سيُرسَل لك *كود الربط*

3️⃣ افتح واتساب → الأجهزة المرتبطة
   → ربط جهاز → ربط برقم الهاتف
   → أدخل الكود

4️⃣ ✅ البوت يشتغل تلقائياً!`
            }, { quoted: msg });
        }

        // ── التحقق من عدم التكرار ──────────────────────────────
        const existing = getAccountsList();
        const alreadyExists = existing.some(acc => {
            const cfgPath = path.join(accountsDir, acc, 'nova', 'config.js');
            try {
                const cfg = fs.readFileSync(cfgPath, 'utf8');
                return cfg.includes(`"${phone}"`) || cfg.includes(`'${phone}'`);
            } catch { return false; }
        });

        if (alreadyExists) {
            return sock.sendMessage(chatId, {
                text: `❌ الرقم \`${phone}\` مسجّل بالفعل.`
            }, { quoted: msg });
        }

        await sock.sendMessage(chatId, {
            react: { text: '⏳', key: msg.key }
        });

        // ── إنشاء اسم الحساب ──────────────────────────────────
        const accountName = `sub_${phone.slice(-6)}_${Date.now().toString(36)}`;
        const code        = genCode();

        // ── إنشاء مجلد الحساب من القالب ──────────────────────
        const created = createAccount(accountName);
        if (!created.success) {
            return sock.sendMessage(chatId, {
                text: `❌ فشل إنشاء الحساب: ${created.msg}`
            }, { quoted: msg });
        }

        // ── كتابة الكونفيج ────────────────────────────────────
        const configured = await writeSubConfig(accountName, phone, code);
        if (!configured) {
            await fs.remove(path.join(accountsDir, accountName)).catch(() => {});
            return sock.sendMessage(chatId, {
                text: '❌ فشل كتابة إعدادات الحساب.'
            }, { quoted: msg });
        }

        // ── تسجيل الحساب في قائمة الفروع ──────────────────────
        await registerSub(accountName);

        // ── إبلاغ index.js بتشغيل الحساب الجديد ──────────────
        try {
            process.send({ type: 'spawn_sub', name: accountName });
        } catch {
            // لو ما في IPC (Termux) — شغّله مباشرة
            const { fork } = await import('child_process');
            const mainPath  = path.resolve(__dirname, '..', '..', 'main.js');
            const targetFolder = path.join(accountsDir, accountName);
            fork(mainPath, [], {
                stdio: 'inherit',
                env: {
                    ...process.env,
                    TARGET_FOLDER:     targetFolder,
                    ACCOUNT_NAME:      accountName,
                    LOGIN_MODE:        'false',
                    CONNECTION_FOLDER: path.join(targetFolder, 'ملف_الاتصال'),
                }
            });
        }

        // ── إرسال الكود للمستخدم ──────────────────────────────
        await sock.sendMessage(chatId, {
            text:
`╭━━━━━━━━━━━━━━━━━╮
┃  ✅ *تم إنشاء البوت*
╰━━━━━━━━━━━━━━━━━╯

📱 *الرقم:* \`+${phone}\`
🔑 *كود الربط:*

\`\`\`${code}\`\`\`

*الخطوات:*
1️⃣ واتساب ← الأجهزة المرتبطة
2️⃣ ربط جهاز ← ربط برقم الهاتف
3️⃣ أدخل الرقم ثم الكود أعلاه

⏰ الكود صالح لـ 5 دقائق`
        }, { quoted: msg });

        // ── تنظيف تلقائي لو ما اتربط ─────────────────────────
        setTimeout(async () => {
            const connFile = path.join(accountsDir, accountName, 'ملف_الاتصال', 'creds.json');
            if (!fs.existsSync(connFile)) {
                // ما اتربط — احذف الحساب
                await fs.remove(path.join(accountsDir, accountName)).catch(() => {});
                // احذف من قائمة الفروع
                const subFile = path.join(accountsDir, 'sub_accounts.json');
                try {
                    let list = JSON.parse(await fs.readFile(subFile, 'utf8'));
                    list = list.filter(n => n !== accountName);
                    await fs.writeFile(subFile, JSON.stringify(list, null, 2), 'utf8');
                } catch {}
            }
        }, 5 * 60 * 1000); // 5 دقائق
    }
};
