// ── أمر .مكتبات ───────────────────────────────────────────────
// يضغط فقط المكتبات المذكورة في dependencies ويرسلها zip
import fs      from 'fs-extra';
import path    from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '../..');   // جذر المشروع
const TMP_DIR   = path.resolve(ROOT, 'tmp');
fs.ensureDirSync(TMP_DIR);

const MAX_MB = 500;

export default {
    NovaUltra: {
        command: ['مكتبات', 'libs'],
        description: 'يضغط مكتبات البوت ويرسلها',
        elite: 'on', group: false, prv: false, lock: 'off'
    },

    execute: async ({ sock, msg }) => {
        const chatId  = msg.key.remoteJid;
        const zipPath = path.join(TMP_DIR, `libs_${Date.now()}.zip`);

        await sock.sendMessage(chatId, { react: { text: '⏳', key: msg.key } });

        try {
            // ── اقرأ dependencies من package.json ────────────
            const pkgPath = path.join(ROOT, 'package.json');
            if (!fs.existsSync(pkgPath))
                throw new Error('ما وجدت package.json');

            const pkg  = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            const deps = Object.keys(pkg.dependencies || {});

            if (!deps.length)
                throw new Error('ما في dependencies في package.json');

            // ── تحقق إن كل مكتبة موجودة ──────────────────────
            const nmDir    = path.join(ROOT, 'node_modules');
            const existing = deps.filter(d => fs.existsSync(path.join(nmDir, d)));

            if (!existing.length)
                throw new Error('ما وجدت node_modules');

            // ── احسب الحجم التقريبي ───────────────────────────
            await sock.sendMessage(chatId, {
                text: `📦 *${existing.length}* مكتبة — جاري الضغط...`
            }, { quoted: msg });

            // بناء قائمة المسارات للضغط
            const paths = existing
                .map(d => `node_modules/${d}`)
                .join(' ');

            // ضغط باستخدام zip
            await execAsync(
                `cd "${ROOT}" && zip -r "${zipPath}" ${paths} -x "*.map" "*.ts" "*.md" "*.txt" "test/*" "tests/*" "__tests__/*" ".github/*"`,
                { maxBuffer: 1024 * 1024 * 100 } // 100MB buffer
            );

            if (!fs.existsSync(zipPath))
                throw new Error('فشل إنشاء الملف');

            // ── تحقق من الحجم ─────────────────────────────────
            const sizeMB = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1);

            if (parseFloat(sizeMB) > MAX_MB) {
                // حاول ضغط أقوى
                const zip2 = zipPath.replace('.zip', '_v2.zip');
                await execAsync(
                    `cd "${ROOT}" && zip -9 -r "${zip2}" ${paths} -x "*.map" "*.ts" "*.md" "*.txt" "test/*" "tests/*" "__tests__/*" ".github/*" "*.html" "*.png" "*.jpg"`,
                    { maxBuffer: 1024 * 1024 * 100 }
                );
                await fs.remove(zipPath);

                const size2MB = (fs.statSync(zip2).size / 1024 / 1024).toFixed(1);
                if (parseFloat(size2MB) > MAX_MB) {
                    await fs.remove(zip2);
                    throw new Error(`الحجم ${size2MB}MB يتجاوز الحد المسموح ${MAX_MB}MB`);
                }

                await sendZip(sock, chatId, msg, zip2, size2MB, existing.length);
            } else {
                await sendZip(sock, chatId, msg, zipPath, sizeMB, existing.length);
            }

        } catch (e) {
            console.error('[LIBS ZIP ERROR]', e?.message);
            await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } });
            await sock.sendMessage(chatId, {
                text: `❌ فشل: ${e?.message}`
            }, { quoted: msg });
        }
    }
};

async function sendZip(sock, chatId, msg, zipPath, sizeMB, count) {
    try {
        const buffer = await fs.readFile(zipPath);

        await sock.sendMessage(chatId, {
            document: buffer,
            mimetype: 'application/zip',
            fileName: `bot_libs_${new Date().toISOString().slice(0,10)}.zip`,
            caption:
`📦 *مكتبات البوت*
┄┄┄┄┄┄┄┄┄┄┄┄┄
📚 عدد المكتبات : *${count}*
💾 الحجم        : *${sizeMB} MB*

> © 𝙰𝚛𝚝`
        }, { quoted: msg });

        await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });
    } finally {
        await fs.remove(zipPath).catch(() => {});
    }
}
