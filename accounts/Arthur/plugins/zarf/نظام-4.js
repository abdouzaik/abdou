// ══════════════════════════════════════════════════════════════
//  نظام البوت الشامل — نظام.js
//  الأقسام:
//   ① القائمة الرئيسية
//   ② 👑 إدارة النخبة
//   ③ 🧩 إدارة البلاجنز
//   ④ 🤖 تنصيب البوتات الفرعية
//   ⑤ 📊 إحصاءات
//   ⑥ 🛡️ الحماية (أنتي كراش، لينكات، حذف، سب، view-once)
//   ⑦ 🔧 أدوات الأوامر (تغيير اسم، مصلح AI)
// ══════════════════════════════════════════════════════════════
import fs          from 'fs-extra';
import path        from 'path';
import os          from 'os';
import { fileURLToPath } from 'url';
import { loadPlugins, getPlugins } from '../../handlers/plugins.js';
import { exec }                        from 'child_process';
import { promisify }                   from 'util';
const execAsync = promisify(exec);
import { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers } from '@whiskeysockets/baileys';
import pino                            from 'pino';
import { downloadMediaMessage }    from '@whiskeysockets/baileys';
import * as accountUtils           from '../../../accountUtils.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const BOT_DIR    = path.resolve(__dirname, '../../');
const ROOT_DIR   = path.resolve(__dirname, '../../../../');
const DATA_DIR   = path.join(BOT_DIR, 'nova', 'data');
const PLUGINS_DIR= path.join(BOT_DIR, 'plugins');
const ACCOUNTS_DIR = path.join(ROOT_DIR, 'accounts');
const CONFIG_PATH  = path.join(BOT_DIR, 'nova', 'config.js');
const PROT_FILE    = path.join(DATA_DIR, 'protection.json');
const STATS_FILE   = path.join(DATA_DIR, 'sys_stats.json');
const SUB_FILE     = path.join(ACCOUNTS_DIR, 'sub_accounts.json');

fs.ensureDirSync(DATA_DIR);

// ── helpers ───────────────────────────────────────────────────
const sleep  = ms => new Promise(r => setTimeout(r, ms));
const react  = (sock, msg, e) =>
    sock.sendMessage(msg.key.remoteJid, { react: { text: e, key: msg.key } }).catch(() => {});

function readJSON(file, def = {}) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return def; }
}
function writeJSON(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// ── حماية: قراءة/كتابة ────────────────────────────────────────
function readProt()   { return readJSON(PROT_FILE, {
    antiCrash:    'off',
    antiLink:     'off',
    antiDelete:   'off',
    antiInsult:   'off',
    antiViewOnce: 'off',
    antiAccept:   'off',
}); }
function writeProt(d) { writeJSON(PROT_FILE, d); }

// ── إحصاءات ───────────────────────────────────────────────────
function readStats()  { return readJSON(STATS_FILE, { commands: {}, users: {}, total: 0 }); }
function writeStats(d){ writeJSON(STATS_FILE, d); }

// ── ملف الأوامر الفرعية ───────────────────────────────────────
function readSubs()   { return readJSON(SUB_FILE, []); }
function writeSubs(d) { writeJSON(SUB_FILE, d); }

// ── قراءة config ──────────────────────────────────────────────
function getCfg(key) {
    try {
        const c = fs.readFileSync(CONFIG_PATH, 'utf8');
        const m = c.match(new RegExp(`${key}:\\s*['"\`](on|off)['"\`]`));
        return m ? m[1] : 'off';
    } catch { return 'off'; }
}

// ── كل ملفات البلاجنز ─────────────────────────────────────────
function getAllPluginFiles(dir = PLUGINS_DIR, list = []) {
    if (!fs.existsSync(dir)) return list;
    for (const f of fs.readdirSync(dir)) {
        const full = path.join(dir, f);
        if (fs.statSync(full).isDirectory()) getAllPluginFiles(full, list);
        else if (f.endsWith('.js')) list.push(full);
    }
    return list;
}

function getPluginInfo(filePath) {
    const code = fs.readFileSync(filePath, 'utf8');
    const cmd   = (code.match(/command:\s*['"`]([^'"`]+)['"`]/)?.[1] || path.basename(filePath, '.js'));
    const elite = code.match(/elite:\s*['"`](on|off)['"`]/i)?.[1] || 'off';
    const lock  = code.match(/lock:\s*['"`](on|off)['"`]/i)?.[1]  || 'off';
    const group = code.match(/group:\s*(true|false)/i)?.[1] || 'false';
    const prv   = code.match(/prv:\s*(true|false)/i)?.[1]   || 'false';
    return { cmd, elite, lock, group: group === 'true', prv: prv === 'true', filePath };
}

function updatePluginField(filePath, key, value) {
    let code = fs.readFileSync(filePath, 'utf8');
    if (key === 'elite' || key === 'lock') {
        code = code.replace(new RegExp(`(${key}:\\s*['"\`])(on|off)(['"\`])`, 'i'), `$1${value}$3`);
    } else if (key === 'group' || key === 'prv') {
        code = code.replace(new RegExp(`(${key}:\\s*)(true|false)`, 'i'), `$1${value}`);
    } else if (key === 'command') {
        code = code.replace(/command:\s*['"`][^'"`]+['"`]/, `command: '${value}'`);
    }
    fs.writeFileSync(filePath, code, 'utf8');
}

async function findPluginByCmd(cmdName) {
    for (const f of getAllPluginFiles()) {
        const code = fs.readFileSync(f, 'utf8');
        if (new RegExp(`command:\\s*['"\`]${cmdName}['"\`]`, 'i').test(code)) return f;
    }
    return null;
}

// ── فاحص الكود — يشغل node --check ──────────────────────────
async function checkPluginSyntax(filePath) {
    try {
        await execAsync(`node --input-type=module --check < "${filePath}"`);
        return { ok: true };
    } catch (e) {
        // استخرج السطر ورقم الخطأ من الرسالة
        const errMsg = (e.stderr || e.message || '').trim();
        const lineMatch = errMsg.match(/:(\d+)$/m);
        const line = lineMatch ? parseInt(lineMatch[1]) : null;
        // اقرأ السطر المشكل إذا عُرف
        let codeLine = '';
        if (line) {
            try {
                const lines = fs.readFileSync(filePath, 'utf8').split('\n');
                codeLine = lines[line - 1]?.trim() || '';
            } catch {}
        }
        return { ok: false, error: errMsg, line, codeLine };
    }
}

// ── فحص نصي مبدئي — يكشف أخطاء شائعة قبل التشغيل ───────────
function quickLint(filePath) {
    const code = fs.readFileSync(filePath, 'utf8');
    const issues = [];
    // أقواس غير متوازنة
    const opens  = (code.match(/\{/g) || []).length;
    const closes = (code.match(/\}/g) || []).length;
    if (opens !== closes) issues.push(`الأقواس {} غير متوازنة — مفتوحة:${opens} مغلقة:${closes}`);
    // async بدون await
    if (/async function/.test(code) && !/await/.test(code))
        issues.push('دالة async بدون أي await داخلها');
    // export default غير موجود
    if (!/export default/.test(code))
        issues.push('لا يوجد export default — البوت لن يحملها');
    // NovaUltra أو command غير موجود
    if (!/command\s*:/.test(code))
        issues.push('لا يوجد حقل command — الأمر لن يُعرف');
    return issues;
}

// ══════════════════════════════════════════════════════════════
//  featureHandlers — الحماية التلقائية
// ══════════════════════════════════════════════════════════════

// رسائل الكراش المعروفة
const CRASH_PATTERNS = [
    /[\u202E\u200F\u200E]{10,}/,               // RTL flood
    /(.)\1{300,}/,                              // تكرار حرف مفرط
    /[\uD83D][\uDC00-\uDFFF]{50,}/,            // emoji flood
    /\u0000{5,}/,                               // null bytes
];

const INSULT_WORDS = ['كس','طيز','شرموط','عاهر','زب','كسمك','عرص','منيوك','قحبة'];
const LINK_REGEX   = /(?:https?:\/\/|wa\.me\/|chat\.whatsapp\.com\/)[^\s]*/i;

async function protectionHandler(sock, msg) {
    try {
        const prot   = readProt();
        const chatId = msg.key.remoteJid;
        const isGroup= chatId.endsWith('@g.us');

        const text = (
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption || ''
        );

        // ── أنتي كراش ─────────────────────────────────────────
        if (prot.antiCrash === 'on') {
            for (const pattern of CRASH_PATTERNS) {
                if (pattern.test(text)) {
                    try { await sock.sendMessage(chatId, { delete: msg.key }); } catch {}
                    return;
                }
            }
        }

        // ── أنتي لينكات (في القروبات فقط) ────────────────────
        if (prot.antiLink === 'on' && isGroup && LINK_REGEX.test(text)) {
            const meta    = await sock.groupMetadata(chatId).catch(() => null);
            if (meta) {
                const botNum  = sock.user.id.split(':')[0];
                const admins  = meta.participants.filter(p => p.admin).map(p => p.id.split(':')[0].split('@')[0]);
                const sender  = (msg.key.participant || '').split(':')[0].split('@')[0];
                if (!admins.includes(sender)) {
                    try { await sock.sendMessage(chatId, { delete: msg.key }); } catch {}
                }
            }
            return;
        }

        // ── أنتي سب ───────────────────────────────────────────
        if (prot.antiInsult === 'on') {
            const lower = text.toLowerCase();
            if (INSULT_WORDS.some(w => lower.includes(w))) {
                try { await sock.sendMessage(chatId, { delete: msg.key }); } catch {}
                return;
            }
        }

        // ── كشف view-once ──────────────────────────────────────
        if (prot.antiViewOnce === 'on') {
            const vo = msg.message?.viewOnceMessage || msg.message?.viewOnceMessageV2?.message;
            if (vo) {
                const ownerNum = (global._botConfig?.owner || '').toString().replace(/\D/g,'');
                const ownerJid = ownerNum + '@s.whatsapp.net';
                const inner    = vo.imageMessage || vo.videoMessage || vo.audioMessage;
                if (inner) {
                    // أرسل نسخة عادية للأونر
                    const { downloadMediaMessage } = await import('@whiskeysockets/baileys');
                    const buffer = await downloadMediaMessage({ message: vo }, 'buffer', {}).catch(() => null);
                    if (buffer) {
                        const type = vo.imageMessage ? 'image' : vo.videoMessage ? 'video' : 'audio';
                        await sock.sendMessage(ownerJid, { [type]: buffer, caption: `👁️ view-once من: ${chatId}` });
                    }
                }
            }
        }

    } catch {}
    return true;
}
protectionHandler._src = 'protection_system';

// ── إحصاءات تلقائية ───────────────────────────────────────────
async function statsAutoHandler(sock, msg) {
    try {
        const pfx  = global._botConfig?.prefix || '.';
        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        if (!text.startsWith(pfx)) return;

        const cmd    = text.slice(pfx.length).split(/\s+/)[0]?.toLowerCase();
        const sender = (msg.key.participant || msg.key.remoteJid || '').split('@')[0].split(':')[0];
        if (!cmd || !sender) return;

        const stats = readStats();
        stats.total = (stats.total || 0) + 1;
        stats.commands[cmd]   = (stats.commands[cmd]   || 0) + 1;
        stats.users[sender]   = (stats.users[sender]   || 0) + 1;
        writeStats(stats);
    } catch {}
    return true;
}
statsAutoHandler._src = 'stats_system';

// تسجيل featureHandlers
if (!global.featureHandlers) global.featureHandlers = [];
global.featureHandlers = global.featureHandlers.filter(h => !['protection_system','stats_system'].includes(h._src));
global.featureHandlers.push(protectionHandler, statsAutoHandler);

// ══════════════════════════════════════════════════════════════
//  نصوص القوائم المعدلة لتبدو مثل settings.js
// ══════════════════════════════════════════════════════════════
const MAIN_MENU =
`*اهلاً بك في نظام البوت الشامل ⚙️.*

- *نخبة*
\`👑 لإدارة قائمة النخبة (إضافة/حذف/عرض).\`

- *بلاجنز*
\`🧩 للتحكم بملفات الأوامر (تفعيل/إيقاف/تخصيص).\`

- *تنصيب*
\`🤖 لإنشاء وإدارة البوتات الفرعية (Sub-Bots).\`

- *إحصاءات*
\`📊 لعرض تقارير الاستخدام واستهلاك الموارد.\`

- *حماية*
\`🛡️ للتحكم بأنظمة الحماية (كراش، لينكات، حذف، الخ).\`

- *أوامر*
\`🔧 لتعديل أسماء الأوامر أو إصلاحها بالذكاء الاصطناعي.\`

- *إدارة*
\`🛠️ للتحكم الشامل بالمجموعات والأعضاء.\``;

// ══════════════════════════════════════════════════════════════
const activeSessions = new Map();

const NovaUltra = {
    command: 'نظام',
    description: 'نظام البوت الشامل',
    elite: 'on',
    group: false,
    prv: false,
    lock: 'off'
};

async function execute({ sock, msg }) {
    const chatId = msg.key.remoteJid;
    const sender = msg.key.participant || chatId;

    // أغلق جلسة قديمة
    if (activeSessions.has(chatId)) {
        const old = activeSessions.get(chatId);
        sock.ev.off('messages.upsert', old.listener);
        clearTimeout(old.timeout);
        activeSessions.delete(chatId);
    }

    const sentMsg = await sock.sendMessage(chatId, { text: MAIN_MENU }, { quoted: msg });
    let botMsgKey = sentMsg.key;
    let state     = 'MAIN';
    let tmp       = {};

    const update  = async (text) => sock.sendMessage(chatId, { text, edit: botMsgKey });

    // ── React map ───────────────────────────────────────────
    const REACTS = {
        'رجوع':'🔙','تشغيل':'✅','اطفاء':'⛔','نعم':'👍','لا':'❌',
        'حذف':'🗑️','اضافة':'➕','عرض':'📋','مسح الكل':'🗑️',
        'تنصيب':'🤖','نخبة':'👑','بلاجنز':'🧩','إحصاءات':'📊',
        'حماية':'🛡️','أوامر':'🔧','بحث':'🔍','تفاصيل':'🔎',
        'حفظ':'💾','تغيير':'✏️','إصلاح':'🔨','نظام':'⚙️','إدارة':'🛠️','فاحص الكود':'🔍','مسح كاش':'🗑️','نسخ':'💾','استعادة':'↩️','جديد':'➕','حالة':'📊','نعم':'👍',
        'طرد':'🚪','حظر':'🔨','كتم':'🔇','تثبيت':'📌','رابط':'🔗','قوانين':'📜',
        'ترحيب':'👋','الاوامر':'📋','معلومات':'ℹ️','اذاعة':'📢','تحديث':'🔄',
    };

    const listener = async ({ messages }) => {
        const m = messages[0];
        if (!m?.message || m.key.remoteJid !== chatId) return;
        if ((m.key.participant || m.key.remoteJid) !== sender) return;

        const text  = (m.message.conversation || m.message.extendedTextMessage?.text || '').trim();
        if (!text) return;

        // react تلقائي
        if (REACTS[text]) react(sock, m, REACTS[text]);

        // ════════════════════════════════════════════════════
        // MAIN
        // ════════════════════════════════════════════════════
        if (state === 'MAIN') {
            if (text === 'نخبة')      { await showEliteMenu();   state = 'ELITE';    return; }
            if (text === 'بلاجنز')    { await showPluginsMenu(); state = 'PLUGINS';  return; }
            if (text === 'تنصيب')     { await showSubMenu();     state = 'SUBS';     return; }
            if (text === 'إحصاءات')   { await showStats();       state = 'STATS';    return; }
            if (text === 'حماية')     { await showProtMenu();    state = 'PROT';     return; }
            if (text === 'أوامر')     { await showCmdTools();    state = 'CMDTOOLS'; return; }
            if (text === 'إدارة')     { await showAdminMenu();   state = 'ADMIN';    return; }
            return;
        }

        // ════════════════════════════════════════════════════
        // 👑 ELITE
        // ════════════════════════════════════════════════════
        if (state === 'ELITE') {
            if (text === 'رجوع') { await update(MAIN_MENU); state = 'MAIN'; return; }

            if (text === 'عرض') {
                try {
                    const list = await sock.getEliteList?.() || [];
                    if (!list.length) return update('📋 `قائمة النخبة الحالية فارغة.`\n\n🔙 *رجوع*');
                    const out = list.map((n,i) => `${i+1}. ${n}`).join('\n');
                    return update(`*قائمة النخبة الحالية 👑:*\n\n${out}\n\n🔙 *رجوع*`);
                } catch { return update('❌ `تعذر جلب القائمة.`\n\n🔙 *رجوع*'); }
            }

            if (text === 'اضافة') {
                await update('📱 `أرسل الرقم مع الكود الدولي لإضافته:`\nمثال: 966501234567\n\n🔙 *رجوع*');
                state = 'ELITE_ADD'; return;
            }

            if (text === 'حذف') {
                await update('📱 `أرسل الرقم المراد حذفه من النخبة:`\n\n🔙 *رجوع*');
                state = 'ELITE_DEL'; return;
            }

            if (text === 'مسح الكل') {
                await update('⚠️ *تأكيد مسح كل بيانات النخبة؟*\n`لا يمكن التراجع عن هذه الخطوة.`\n\nاكتب *نعم* للتأكيد أو *رجوع* للإلغاء.');
                state = 'ELITE_CLEAR'; return;
            }
            return;
        }

        if (state === 'ELITE_ADD') {
            if (text === 'رجوع') { await showEliteMenu(); state = 'ELITE'; return; }
            const num = text.replace(/\D/g,'');
            if (num.length < 9) return update('❌ `رقم غير صحيح، أعد المحاولة:`');
            try {
                await sock.addElite?.({ id: num + '@s.whatsapp.net' });
                await update(`✅ \`تم إضافة [ ${num} ] إلى قائمة النخبة بنجاح.\``);
                await sleep(1500); await showEliteMenu(); state = 'ELITE';
            } catch { await update('❌ `فشل الإضافة.`'); }
            return;
        }

        if (state === 'ELITE_DEL') {
            if (text === 'رجوع') { await showEliteMenu(); state = 'ELITE'; return; }
            const num = text.replace(/\D/g,'');
            if (num.length < 9) return update('❌ `رقم غير صحيح، أعد المحاولة:`');
            try {
                await sock.removeElite?.({ id: num + '@s.whatsapp.net' });
                await update(`✅ \`تم حذف [ ${num} ] من قائمة النخبة بنجاح.\``);
                await sleep(1500); await showEliteMenu(); state = 'ELITE';
            } catch { await update('❌ `فشل الحذف.`'); }
            return;
        }

        if (state === 'ELITE_CLEAR') {
            if (text === 'رجوع') { await showEliteMenu(); state = 'ELITE'; return; }
            if (text === 'نعم') {
                try {
                    const list = await sock.getEliteList?.() || [];
                    for (const id of list) await sock.removeElite?.({ id });
                    await update('✅ `تم مسح جميع أرقام النخبة بنجاح.`');
                    await sleep(1500); await showEliteMenu(); state = 'ELITE';
                } catch { await update('❌ `فشل المسح.`'); }
            }
            return;
        }

        // ════════════════════════════════════════════════════
        // 🧩 PLUGINS
        // ════════════════════════════════════════════════════
        if (state === 'PLUGINS') {
            if (text === 'رجوع') { await update(MAIN_MENU); state = 'MAIN'; return; }

            if (text === 'عرض') {
                const files  = getAllPluginFiles();
                const chunks = [];
                let   chunk  = '*الأوامر المتوفرة 🧩:*\n\n';
                for (const f of files) {
                    const { cmd, elite, lock } = getPluginInfo(f);
                    const line = `- ${cmd} ${elite==='on'?'👑':''} ${lock==='on'?'🔒':''}\n`;
                    if ((chunk + line).length > 3500) { chunks.push(chunk); chunk = ''; }
                    chunk += line;
                }
                if (chunk) chunks.push(chunk);
                for (const c of chunks) await sock.sendMessage(chatId, { text: c });
                await update('🔙 *رجوع* | أو اكتب *بحث* [اسم] لعرض التفاصيل.');
                return;
            }

            if (text.startsWith('بحث ')) {
                const cmdName = text.slice(4).trim();
                const filePath= await findPluginByCmd(cmdName);
                if (!filePath) return update(`❌ \`لم يتم العثور على الأمر: ${cmdName}\``);
                tmp.targetFile = filePath;
                tmp.targetCmd  = cmdName;
                await showPluginDetail(filePath, cmdName);
                state = 'PLUGIN_EDIT'; return;
            }

            if (text === 'طفي الكل') {
                for (const f of getAllPluginFiles()) {
                    if (f.includes('settings') || f.includes('نظام')) continue;
                    try { updatePluginField(f, 'lock', 'on'); } catch {}
                }
                await loadPlugins().catch(()=>{});
                await update('🔒 `تم قفل جميع البلاجنز بنجاح.`'); return;
            }

            if (text === 'شغل الكل') {
                for (const f of getAllPluginFiles()) {
                    if (f.includes('settings') || f.includes('نظام')) continue;
                    try { updatePluginField(f, 'lock', 'off'); } catch {}
                }
                await loadPlugins().catch(()=>{});
                await update('🔓 `تم فتح جميع البلاجنز بنجاح.`'); return;
            }
            return;
        }

        if (state === 'PLUGIN_EDIT') {
            if (text === 'رجوع') { await showPluginsMenu(); state = 'PLUGINS'; return; }
            const { targetFile: fp, targetCmd: tc } = tmp;
            if (!fp) return;

            if (text === 'قفل' || text === 'فتح') {
                const val = text === 'قفل' ? 'on' : 'off';
                updatePluginField(fp, 'lock', val);
                await loadPlugins().catch(()=>{});
                await update(`${val==='on'?'🔒':'🔓'} \`تم ${text} الأمر [ ${tc} ] بنجاح.\``);
                await sleep(1000); await showPluginDetail(fp, tc); return;
            }

            if (text === 'نخبة' || text === 'عام') {
                const val = text === 'نخبة' ? 'on' : 'off';
                updatePluginField(fp, 'elite', val);
                await loadPlugins().catch(()=>{});
                await update(`${val==='on'?'👑':'🌐'} \`تم تحويل الأمر [ ${tc} ] لـ ${text}.\``);
                await sleep(1000); await showPluginDetail(fp, tc); return;
            }

            if (text === 'مجموعات') {
                updatePluginField(fp, 'group', 'true');
                updatePluginField(fp, 'prv',   'false');
                await loadPlugins().catch(()=>{});
                await update(`✅ \`الأمر [ ${tc} ] الآن مخصص للمجموعات فقط.\``);
                await sleep(1000); await showPluginDetail(fp, tc); return;
            }

            if (text === 'خاص') {
                updatePluginField(fp, 'prv',   'true');
                updatePluginField(fp, 'group', 'false');
                await loadPlugins().catch(()=>{});
                await update(`✅ \`الأمر [ ${tc} ] الآن مخصص للخاص فقط.\``);
                await sleep(1000); await showPluginDetail(fp, tc); return;
            }

            if (text === 'للجميع') {
                updatePluginField(fp, 'group', 'false');
                updatePluginField(fp, 'prv',   'false');
                await loadPlugins().catch(()=>{});
                await update(`✅ \`الأمر [ ${tc} ] الآن يعمل في كل مكان.\``);
                await sleep(1000); await showPluginDetail(fp, tc); return;
            }

            if (text === 'تغيير الاسم') {
                await update(`✏️ \`اكتب الاسم الجديد للأمر [ ${tc} ]:\`\n\n🔙 *رجوع*`);
                state = 'PLUGIN_RENAME'; return;
            }
            return;
        }

        if (state === 'PLUGIN_RENAME') {
            if (text === 'رجوع') { await showPluginDetail(tmp.targetFile, tmp.targetCmd); state = 'PLUGIN_EDIT'; return; }
            const pfx = global._botConfig?.prefix || '.';
            const newCmd = text.replace(pfx, '').trim();
            updatePluginField(tmp.targetFile, 'command', newCmd);
            await loadPlugins().catch(()=>{});
            await update(`✅ \`تم تغيير اسم الأمر بنجاح:\`\n${pfx}${tmp.targetCmd} ➔ ${pfx}${newCmd}`);
            tmp.targetCmd = newCmd;
            await sleep(1500); await showPluginDetail(tmp.targetFile, newCmd);
            state = 'PLUGIN_EDIT'; return;
        }

        // ════════════════════════════════════════════════════
        // 🤖 SUBS — البوتات الفرعية
        // ════════════════════════════════════════════════════
        if (state === 'SUBS') {
            if (text === 'رجوع') { await update(MAIN_MENU); state = 'MAIN'; return; }

            if (text === 'جديد') {
                await update('*اكتب اسماً للبوت الجديد:*\n`حروف وأرقام إنجليزية فقط`\n\n🔙 *رجوع*');
                state = 'SUBS_NEWNAME'; return;
            }

            if (text === 'حالة') {
                const subs = readSubs();
                if (!subs.length) return update('📭 لا يوجد حسابات فرعية.\n\n🔙 *رجوع*');
                // اجلب الرقم من مجلد الجلسة لكل بوت
                const lines = subs.map(name => {
                    const credsPath = path.join(ACCOUNTS_DIR, name, 'nova', 'data', 'creds.json');
                    let jid = '—';
                    if (fs.existsSync(credsPath)) {
                        try {
                            const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
                            jid = creds.me?.id?.split(':')[0] || creds.me?.id || '—';
                        } catch {}
                    }
                    return `- *${name}* | +${jid}`;
                }).join('\n');
                await update(`*الحسابات الفرعية 🤖*\n\n${lines}\n\n🔙 *رجوع*`);
                return;
            }

            if (text.startsWith('ريستارت ')) {
                const name = text.slice(8).trim();
                const subs = readSubs();
                if (!subs.includes(name)) return update(`❌ البوت [ ${name} ] غير موجود.`);
                process.send?.({ type: 'kill_sub', name });
                await sleep(800);
                process.send?.({ type: 'spawn_sub', name });
                await update(`🔄 تم إعادة تشغيل [ ${name} ]`);
                await sleep(1000); await showSubMenu(); return;
            }

            if (text.startsWith('حذف ')) {
                const name = text.slice(4).trim();
                const subs = readSubs();
                if (!subs.includes(name)) return update(`❌ البوت [ ${name} ] غير موجود.`);
                await update(`⚠️ *تأكيد حذف [ ${name} ]؟*\nاكتب *نعم* أو *رجوع*`);
                tmp.pendingDelete = name;
                state = 'SUBS_CONFIRM_DEL'; return;
            }

            return;
        }

        // ── تأكيد الحذف ───────────────────────────────────
        if (state === 'SUBS_CONFIRM_DEL') {
            if (text === 'رجوع') { await showSubMenu(); state = 'SUBS'; return; }
            if (text === 'نعم') {
                const name = tmp.pendingDelete;
                process.send?.({ type: 'kill_sub', name });
                await sleep(400);
                const res = accountUtils.deleteAccount(name);
                writeSubs(readSubs().filter(s => s !== name));
                react(sock, m, res.success ? '🗑️' : '❌');
                await update(res.success ? `🗑️ تم حذف [ ${name} ] نهائياً.` : `❌ ${res.msg}`);
                await sleep(1000); await showSubMenu(); state = 'SUBS'; return;
            }
            return;
        }

        // ── اسم البوت الجديد ──────────────────────────────
        if (state === 'SUBS_NEWNAME') {
            if (text === 'رجوع') { await showSubMenu(); state = 'SUBS'; return; }
            const name = text.trim().replace(/[^a-zA-Z0-9_-]/g, '');
            if (!name) return update('❌ اسم غير صحيح.\n\n🔙 *رجوع*');

            const res = accountUtils.createAccount(name);
            if (!res.success) return update(`❌ ${res.msg}\n\n🔙 *رجوع*`);

            const subs = readSubs();
            if (!subs.includes(name)) { subs.push(name); writeSubs(subs); }

            tmp.subName = name;
            await update(`✅ تم إنشاء [ *${name}* ]\n\n📱 *أرسل رقم الهاتف لربط الحساب:*\nمثال: 966501234567\n\n🔙 *رجوع*`);
            state = 'SUBS_GETPHONE'; return;
        }

        // ── رقم الهاتف ────────────────────────────────────
        if (state === 'SUBS_GETPHONE') {
            if (text === 'رجوع') {
                // احذف الحساب الفارغ
                accountUtils.deleteAccount(tmp.subName);
                writeSubs(readSubs().filter(s => s !== tmp.subName));
                await showSubMenu(); state = 'SUBS'; return;
            }
            const phone = text.replace(/\D/g, '');
            if (phone.length < 9 || phone.length > 15)
                return update('❌ رقم غير صحيح.\nمثال: 966501234567\n\n🔙 *رجوع*');

            tmp.subPhone = phone;
            await update(`⏳ *جاري توليد كود الربط لـ [ ${tmp.subName} ]...*\n\nانتظر لحظة...`);
            react(sock, m, '⏳');

            // ── إنشاء سوكيت مؤقت للحصول على كود الربط ──
            try {
                const sessionDir = path.join(ACCOUNTS_DIR, tmp.subName, 'nova', 'data');
                fs.ensureDirSync(sessionDir);

                const { state: authState, saveCreds } = await useMultiFileAuthState(sessionDir);
                const { version } = await fetchLatestBaileysVersion();

                const tempSock = makeWASocket({
                    version,
                    logger: pino({ level: 'silent' }),
                    printQRInTerminal: false,
                    browser: Browsers.macOS('Chrome'),
                    auth: authState,
                    markOnlineOnConnect: false,
                    syncFullHistory: false,
                    getMessage: async () => undefined,
                });

                tempSock.ev.on('creds.update', saveCreds);

                let codeReceived = false;

                tempSock.ev.on('connection.update', async ({ connection, qr, lastDisconnect }) => {
                    if (codeReceived) return;

                    if (qr) {
                        // عند ظهور QR — اطلب pairing code
                        try {
                            let code = await tempSock.requestPairingCode(phone);
                            code = code.match(/.{1,4}/g)?.join('-') || code;
                            codeReceived = true;

                            await update(
`✅ *كود ربط البوت [ ${tmp.subName} ]*

\`${code}\`

📱 *كيفية الاستخدام:*
واتساب ← إعدادات ← الأجهزة المرتبطة
← ربط جهاز ← ربط برمز بدلاً من ذلك

⏱️ الكود صالح لمدة *60 ثانية*
🔙 *رجوع*`
                            );

                            // انتظر الاتصال أو timeout
                            setTimeout(() => {
                                if (!tempSock.user) {
                                    try { tempSock.end(); } catch {}
                                }
                            }, 65_000);

                        } catch (e) {
                            await update(`❌ فشل توليد الكود: ${e?.message}\n\n🔙 *رجوع*`);
                            try { tempSock.end(); } catch {}
                        }
                    }

                    if (connection === 'open') {
                        const jid = tempSock.user?.id?.split(':')[0] || phone;
                        try { tempSock.end(); } catch {}
                        // شغّل البوت الفعلي
                        process.send?.({ type: 'spawn_sub', name: tmp.subName });
                        react(sock, m, '✅');
                        await update(
`🎉 *تم ربط [ ${tmp.subName} ] بنجاح!*

📱 الرقم: +${jid}
🤖 البوت يعمل الآن.

🔙 *رجوع*`
                        );
                        await sleep(2000); await showSubMenu(); state = 'SUBS';
                    }

                    if (connection === 'close') {
                        const code = lastDisconnect?.error?.output?.statusCode;
                        if (code === 401 || code === 403) {
                            try { tempSock.end(); } catch {}
                            if (!codeReceived) await update('❌ انتهت صلاحية الكود.\n\n🔙 *رجوع*');
                        }
                    }
                });

            } catch (e) {
                await update(`❌ خطأ تقني: ${e?.message}\n\n🔙 *رجوع*`);
            }

            state = 'SUBS_WAITING_PAIR';
            return;
        }

        // ── انتظار الربط ─────────────────────────────────
        if (state === 'SUBS_WAITING_PAIR') {
            if (text === 'رجوع') {
                accountUtils.deleteAccount(tmp.subName);
                writeSubs(readSubs().filter(s => s !== tmp.subName));
                await showSubMenu(); state = 'SUBS';
            }
            return;
        }

        // ════════════════════════════════════════════════════
        // 📊 STATS
        // ════════════════════════════════════════════════════
        if (state === 'STATS') {
            if (text === 'رجوع') { await update(MAIN_MENU); state = 'MAIN'; return; }
            if (text === 'مسح') {
                writeStats({ commands: {}, users: {}, total: 0 });
                await update('✅ `تم مسح جميع الإحصاءات بنجاح.`'); await sleep(1000); await showStats(); return;
            }
            return;
        }

        // ════════════════════════════════════════════════════
        // 🛡️ PROT
        // ════════════════════════════════════════════════════
        if (state === 'PROT') {
            if (text === 'رجوع') { await update(MAIN_MENU); state = 'MAIN'; return; }

            const protMap = {
                'أنتي كراش':   'antiCrash',
                'أنتي لينكات': 'antiLink',
                'أنتي حذف':    'antiDelete',
                'أنتي سب':     'antiInsult',
                'view once':    'antiViewOnce',
            };

            for (const [label, key] of Object.entries(protMap)) {
                if (text === label) {
                    const p   = readProt();
                    p[key]    = p[key] === 'on' ? 'off' : 'on';
                    writeProt(p);
                    await update(`${p[key]==='on'?'✅':'⛔'} \`تم ${p[key]==='on'?'تفعيل':'تعطيل'} نظام [ ${label} ].\``);
                    await sleep(1000); await showProtMenu(); return;
                }
            }
            return;
        }

        // ════════════════════════════════════════════════════
        // 🔧 CMD TOOLS
        // ════════════════════════════════════════════════════
        if (state === 'CMDTOOLS') {
            if (text === 'رجوع') { await update(MAIN_MENU); state = 'MAIN'; return; }

            if (text === 'تغيير اسم') {
                await update('✏️ `اكتب اسم الأمر الحالي الذي ترغب بتغييره:`\n\n🔙 *رجوع*');
                state = 'RENAME_WAIT'; return;
            }

            if (text === 'فاحص الكود') {
                await update('*اكتب اسم الأمر للفحص:*\n\n🔙 *رجوع*');
                state = 'CODE_CHECK_WAIT'; return;
            }

            if (text === 'مسح كاش') {
                react(sock, m, '⏳');
                try {
                    if (global._pluginsCache) global._pluginsCache = {};
                    if (global._handlers)     global._handlers     = {};
                    if (global.featureHandlers) {
                        global.featureHandlers = global.featureHandlers.filter(h =>
                            ['protection_system','stats_system'].includes(h._src));
                    }
                    await loadPlugins().catch(()=>{});
                    react(sock, m, '✅');
                    await update('✅ تم مسح الكاش وإعادة التحميل.');
                } catch(e) {
                    react(sock, m, '❌');
                    await update(`❌ ${e?.message}`);
                }
                await sleep(800); await showCmdTools(); return;
            }
            return;
        }

        if (state === 'RENAME_WAIT') {
            if (text === 'رجوع') { await showCmdTools(); state = 'CMDTOOLS'; return; }
            const fp = await findPluginByCmd(text);
            if (!fp) return update(`❌ \`لم يتم العثور على الأمر: ${text}\`\nجرب مرة أخرى:`);
            tmp.targetFile = fp; tmp.targetCmd = text;
            await update(`✅ \`تم تحديد الأمر [ ${text} ].\`\nاكتب الاسم الجديد الآن:\n\n🔙 *رجوع*`);
            state = 'RENAME_NEW'; return;
        }

        if (state === 'RENAME_NEW') {
            if (text === 'رجوع') { await showCmdTools(); state = 'CMDTOOLS'; return; }
            const newCmd = text.trim();
            updatePluginField(tmp.targetFile, 'command', newCmd);
            await loadPlugins().catch(()=>{});
            const pfx = global._botConfig?.prefix || '.';
            await update(`✅ \`تم تغيير اسم الأمر بنجاح:\`\n${pfx}${tmp.targetCmd} ➔ ${pfx}${newCmd}`);
            await sleep(1500); await showCmdTools(); state = 'CMDTOOLS'; return;
        }

        if (state === 'CODE_CHECK_WAIT') {
            if (text === 'رجوع') { await showCmdTools(); state = 'CMDTOOLS'; return; }
            const fp = await findPluginByCmd(text);
            if (!fp) return update(`❌ ما وجدت الأمر: [ ${text} ]\nجرب مرة ثانية:`);

            react(sock, m, '⏳');
            await update(`⏳ *جاري فحص [ ${text} ]...*`);

            // فحص سريع أولاً
            const lintIssues = quickLint(fp);
            // ثم فحص الـ syntax
            const checkRes   = await checkPluginSyntax(fp);

            let report = `*نتيجة فحص الأمر [ ${text} ] 🔍*\n`;
            report += `📁 \`${path.basename(fp)}\`\n\n`;

            if (checkRes.ok && lintIssues.length === 0) {
                report += '✅ *الكود سليم — لا توجد أخطاء*\n';
            } else {
                if (!checkRes.ok) {
                    report += `❌ *خطأ في الـ Syntax:*\n`;
                    if (checkRes.line) report += `السطر: *${checkRes.line}*\n`;
                    if (checkRes.codeLine) report += `الكود: \`${checkRes.codeLine}\`\n`;
                    // أبرز نوع الخطأ
                    const errShort = (checkRes.error || '').split('\n').slice(0, 2).join(' ').substring(0, 200);
                    report += `\`${errShort}\`\n\n`;
                }
                if (lintIssues.length > 0) {
                    report += `⚠️ *تحذيرات:*\n`;
                    lintIssues.forEach(i => { report += `— ${i}\n`; });
                }
            }

            report += '\n*نسخ احتياطي | استعادة* — اكتب *نسخ* للنسخ الآن';
            report += '\n🔙 *رجوع*';

            tmp.checkFile = fp;
            tmp.checkCmd  = text;
            await update(report);
            state = 'CODE_CHECK_RESULT'; return;
        }

        if (state === 'CODE_CHECK_RESULT') {
            if (text === 'رجوع') { await showCmdTools(); state = 'CMDTOOLS'; return; }
            if (text === 'نسخ') {
                const backup = tmp.checkFile + '.bak';
                try {
                    fs.copyFileSync(tmp.checkFile, backup);
                    react(sock, m, '💾');
                    await update(`💾 تم حفظ نسخة احتياطية:\n\`${path.basename(backup)}\`\n\n*استعادة* — للرجوع للنسخة\n🔙 *رجوع*`);
                } catch(e) { await update(`❌ ${e?.message}`); }
                return;
            }
            if (text === 'استعادة') {
                const backup = tmp.checkFile + '.bak';
                if (!fs.existsSync(backup)) return update('❌ لا توجد نسخة احتياطية.\n\n🔙 *رجوع*');
                fs.copyFileSync(backup, tmp.checkFile);
                fs.removeSync(backup);
                await loadPlugins().catch(()=>{});
                react(sock, m, '↩️');
                await update('↩️ تم استعادة النسخة الأصلية.');
                await sleep(800); await showCmdTools(); state = 'CMDTOOLS'; return;
            }
            return;
        }
    };


        // ════════════════════════════════════════════════════
        // 🛠️ ADMIN — إدارة المجموعات
        // ════════════════════════════════════════════════════

        async function getAdminPerms() {
            const isGrp = chatId.endsWith('@g.us');
            if (!isGrp) return { isAdmin:false, isBotAdmin:false, meta:null, isGroup:false };
            try {
                const meta   = await sock.groupMetadata(chatId);
                const botNum = sock.user.id.split(':')[0];
                const admins = meta.participants.filter(p=>p.admin).map(p=>p.id.split(':')[0].split('@')[0]);
                const sNum   = (sender||'').split(':')[0].split('@')[0].replace(/\D/g,'');
                return { meta, isGroup:true, isAdmin: m.key.fromMe||admins.includes(sNum), isBotAdmin: admins.includes(botNum) };
            } catch { return { isAdmin:false, isBotAdmin:false, meta:null, isGroup:true }; }
        }

        function getTarget2(m2) {
            const ctx = m2.message?.extendedTextMessage?.contextInfo;
            return ctx?.mentionedJid?.[0] || ctx?.participant || null;
        }

        function grpFile(prefix) {
            return path.join(DATA_DIR, prefix + '_' + chatId.replace(/[^\w]/g,'_') + '.json');
        }

        if (state === 'ADMIN') {
            if (text === 'رجوع') { await update(MAIN_MENU); state = 'MAIN'; return; }

            // أعضاء
            const memberActions = { 'رفع مشرف':'promote','تنزيل مشرف':'demote','طرد':'remove','حظر':'ban','الغاء حظر':'unban','كتم':'mute','الغاء كتم':'unmute','تقييد':'restrict','رفع تقييد':'unrestrict' };
            if (memberActions[text]) {
                tmp.adminAction = memberActions[text];
                const hint = text==='كتم' ? 'قم بعمل منشن للعضو + الوقت بالدقائق (مثال: @رقم 30)' : 'قم بعمل منشن للعضو أو الرد على رسالته';
                await update(`📌 \`${hint}\`\n\n🔙 *رجوع*`);
                state = 'ADMIN_TARGET'; return;
            }

            if (text === 'المشرفين') {
                const { meta, isGroup } = await getAdminPerms();
                if (!isGroup||!meta) return update('❌ `هذا الأمر مخصص للمجموعات فقط.`');
                const admins = meta.participants.filter(p=>p.admin);
                if (!admins.length) return update('`لا يوجد مشرفين في هذه المجموعة.`');
                const list = admins.map((a,i)=>`${i+1}. @${a.id.split('@')[0]} ${a.admin==='superadmin'?'👑':''}`).join('\n');
                await sock.sendMessage(chatId,{text:`*قائمة المشرفين (${admins.length}) 👑:*\n\n${list}`,mentions:admins.map(a=>a.id)},{quoted:m});
                return;
            }

            if (text === 'رابط') {
                const {isAdmin,isBotAdmin,isGroup}=await getAdminPerms();
                if(!isGroup||!isAdmin||!isBotAdmin) return update('❌ `يتطلب صلاحيات المشرفين.`');
                try{ const code=await sock.groupInviteCode(chatId); await update(`🔗 https://chat.whatsapp.com/${code}`); }catch(e){await update(`❌ ${e?.message}`);}
                return;
            }

            if (text==='تثبيت'||text==='الغاء التثبيت'||text==='قفل المحادثة'||text==='فتح المحادثة'||text==='مسح') {
                const {isAdmin,isBotAdmin,isGroup}=await getAdminPerms();
                if(!isGroup||!isAdmin||!isBotAdmin) return update('❌ `يتطلب صلاحيات المشرفين.`');
                const ctx=m.message?.extendedTextMessage?.contextInfo;
                if((text==='تثبيت'||text==='مسح')&&!ctx?.stanzaId) return update('↩️ `يجب الرد على الرسالة المستهدفة أولاً.`');
                react(sock,m,'⏳');
                try {
                    if(text==='تثبيت') await sock.sendMessage(chatId,{pin:{type:1,time:604800},key:{...m.key,id:ctx.stanzaId,participant:ctx.participant}});
                    if(text==='الغاء التثبيت') await sock.sendMessage(chatId,{pin:{type:2}});
                    if(text==='قفل المحادثة') await sock.groupSettingUpdate(chatId,'announcement');
                    if(text==='فتح المحادثة') await sock.groupSettingUpdate(chatId,'not_announcement');
                    if(text==='مسح') await sock.sendMessage(chatId,{delete:{remoteJid:chatId,fromMe:false,id:ctx.stanzaId,participant:ctx.participant}});
                    react(sock,m,text==='مسح'?'🗑️':text==='قفل المحادثة'?'🔒':text==='فتح المحادثة'?'🔓':'✅');
                } catch(e){react(sock,m,'❌');await update(`❌ ${e?.message}`);}
                return;
            }

            if (text==='وضع اسم')  {await update('✍️ `اكتب الاسم الجديد للمجموعة:`\n\n🔙 *رجوع*');  state='ADMIN_SETNAME';  return;}
            if (text==='وضع وصف')  {await update('✍️ `اكتب الوصف الجديد للمجموعة:`\n\n🔙 *رجوع*');  state='ADMIN_SETDESC';  return;}
            if (text==='وضع صورة') {await update('🖼️ `أرسل أو قم بالرد على صورة:`\n\n🔙 *رجوع*'); state='ADMIN_SETIMG';   return;}
            if (text==='وضع ترحيب'){await update('✍️ `اكتب رسالة الترحيب — استخدم {name} كمتغير لاسم العضو:`\n\n🔙 *رجوع*'); state='ADMIN_SETWELCOME'; return;}
            if (text==='وضع قوانين'){await update('✍️ `اكتب القوانين الخاصة بالمجموعة:`\n\n🔙 *رجوع*'); state='ADMIN_SETRULES'; return;}

            if (text==='ترحيب') {
                const wf=grpFile('welcome');
                if(!fs.existsSync(wf)) return update('📭 `لا توجد رسالة ترحيب — استخدم خيار "وضع ترحيب".`');
                const {text:wt}=readJSON(wf);
                await update(`*رسالة الترحيب الحالية 📋:*\n${wt}\n\n- اكتب *حذف* لإزالتها.\n🔙 *رجوع*`);
                state='ADMIN_WELCOME_VIEW'; return;
            }

            if (text==='قوانين') {
                const rf=grpFile('rules');
                if(!fs.existsSync(rf)) return update('📭 `لا توجد قوانين — استخدم خيار "وضع قوانين".`');
                const {text:rt}=readJSON(rf);
                await update(`*القوانين الحالية 📜:*\n${rt}\n\n- اكتب *حذف* لإزالتها.\n🔙 *رجوع*`);
                state='ADMIN_RULES_VIEW'; return;
            }

            const LOCK_MAP={'قفل الروابط':'antiLink','قفل الصور':'images','قفل الفيديو':'videos','قفل البوتات':'bots'};
            if (LOCK_MAP[text]) {
                const {isAdmin,isBotAdmin,isGroup}=await getAdminPerms();
                if(!isGroup||!isAdmin||!isBotAdmin) return update('❌ `يتطلب صلاحيات المشرفين.`');
                const pf=grpFile('locks'),p=readJSON(pf,{}),key=LOCK_MAP[text];
                p[key]=p[key]==='on'?'off':'on'; writeJSON(pf,p);
                react(sock,m,p[key]==='on'?'✅':'⛔');
                await update(`${p[key]==='on'?'✅':'⛔'} \`حالة ${text}: ${p[key]}\``);
                await sleep(1000); await showAdminMenu(); return;
            }

            if (text==='كلمات ممنوعة') { await showBadwords(); state='ADMIN_BADWORDS'; return; }

            if (text==='نظام الحماية') {
                const pf=path.join(DATA_DIR,'protection.json'),p=readJSON(pf,{});
                const keys=['antiCrash','antiLink','antiInsult','antiViewOnce'];
                const allOn=keys.every(k=>p[k]==='on'),val=allOn?'off':'on';
                keys.forEach(k=>p[k]=val); writeJSON(pf,p);
                react(sock,m,val==='on'?'✅':'⛔');
                await update(`${val==='on'?'✅':'⛔'} \`جميع أنظمة الحماية: ${val}\``);
                await sleep(1000); await showAdminMenu(); return;
            }

            if (text==='الاوامر') {
                const plugins=getPlugins(), pfxC=global._botConfig?.prefix||'.';
                const lines=Object.entries(plugins).filter(([k])=>!k.startsWith('_')).map(([k,v])=>`- ${pfxC}${k}${v.description?' — '+v.description:''}`).join('\n');
                const chunks=[];let chunk=`*الأوامر المتوفرة 📋:*\n\n`;
                for(const line of lines.split('\n')){if((chunk+line).length>3500){chunks.push(chunk);chunk='';}chunk+=line+'\n';}
                if(chunk)chunks.push(chunk);
                for(const c of chunks) await sock.sendMessage(chatId,{text:c},{quoted:m});
                return;
            }

            if (text==='بحث اوامر') {await update('🔍 `اكتب اسم الأمر الذي تبحث عنه:`\n\n🔙 *رجوع*'); state='ADMIN_SRCHCMD'; return;}

            if (text==='معلومات') {
                const plugins=getPlugins(),up=process.uptime();
                const h=Math.floor(up/3600),mm2=Math.floor((up%3600)/60),ss2=Math.floor(up%60);
                const ram=os.totalmem(),free=os.freemem();
                const ramU=((ram-free)/1024/1024).toFixed(0),ramT=(ram/1024/1024).toFixed(0);
                const groups=Object.keys(await sock.groupFetchAllParticipating().catch(()=>({}))).length;
                const cfg=global._botConfig||{};
                await update(`*معلومات النظام 🤖:*\n\n- *الاسم:* ${cfg.botName||'البوت'}\n- *الإصدار:* ${cfg.version||'1.0.0'}\n- *التشغيل:* ${h}h ${mm2}m ${ss2}s\n- *الذاكرة:* ${ramU}/${ramT} MB\n- *الأوامر:* ${Object.keys(plugins).length}\n- *المجموعات:* ${groups}\n\n🔙 *رجوع*`);
                return;
            }

            if (text==='اذاعة') {await update('📢 `اكتب رسالة الإذاعة المراد نشرها:`\n\n🔙 *رجوع*'); state='ADMIN_BROADCAST'; return;}

            if (text==='تحديث') {
                react(sock,m,'⏳');
                try{await loadPlugins();react(sock,m,'✅');await update('✅ `تم تحديث ملفات الأوامر بنجاح.`');}
                catch(e){react(sock,m,'❌');await update(`❌ ${e?.message}`);}
                return;
            }
            return;
        }

        if (state==='ADMIN_TARGET') {
            if (text==='رجوع'){await showAdminMenu();state='ADMIN';return;}
            const {isAdmin,isBotAdmin,isGroup}=await getAdminPerms();
            if(!isGroup||!isAdmin||!isBotAdmin) return update('❌ `تحتاج لصلاحيات المشرفين.`');
            const target=getTarget2(m);
            if(!target) return update('❌ `الرجاء عمل منشن للعضو أو الرد على رسالته.`');
            react(sock,m,'⏳');
            const action=tmp.adminAction;
            try{
                if(action==='promote')    {await sock.groupParticipantsUpdate(chatId,[target],'promote');react(sock,m,'👑');}
                if(action==='demote')     {await sock.groupParticipantsUpdate(chatId,[target],'demote'); react(sock,m,'⬇️');}
                if(action==='remove')     {await sock.groupParticipantsUpdate(chatId,[target],'remove'); react(sock,m,'🚪');}
                if(action==='restrict')   {await sock.groupParticipantsUpdate(chatId,[target],'demote'); react(sock,m,'🔒');}
                if(action==='unrestrict') {await sock.groupParticipantsUpdate(chatId,[target],'promote');react(sock,m,'🔓');}
                if(action==='unmute')     {await sock.groupParticipantsUpdate(chatId,[target],'promote');react(sock,m,'🔊');}
                if(action==='mute'){
                    const mins=parseInt((text.match(/\d+/)||['30'])[0]);
                    await sock.groupParticipantsUpdate(chatId,[target],'demote');
                    await sock.sendMessage(chatId,{text:`🔇 تم كتم @${target.split('@')[0]} لمدة ${mins} دقيقة`,mentions:[target]});
                    setTimeout(async()=>{try{await sock.groupParticipantsUpdate(chatId,[target],'promote');}catch{}},mins*60_000);
                }
                if(action==='ban'){
                    await sock.groupParticipantsUpdate(chatId,[target],'remove');
                    const bans=readJSON(grpFile('bans'),[]);
                    if(!bans.includes(target))bans.push(target);
                    writeJSON(grpFile('bans'),bans); react(sock,m,'🔨');
                }
                if(action==='unban'){
                    let bans=readJSON(grpFile('bans'),[]);
                    writeJSON(grpFile('bans'),bans.filter(b=>b!==target));
                    react(sock,m,'✅');
                }
            }catch(e){react(sock,m,'❌');await update(`❌ فشل الإجراء: ${e?.message}`);}
            await sleep(800); await showAdminMenu(); state='ADMIN'; return;
        }

        if(state==='ADMIN_SETNAME'){
            if(text==='رجوع'){await showAdminMenu();state='ADMIN';return;}
            const {isAdmin,isBotAdmin,isGroup}=await getAdminPerms();
            if(!isGroup||!isAdmin||!isBotAdmin) return update('❌ `يتطلب صلاحيات المشرفين.`');
            react(sock,m,'⏳');
            try{await sock.groupUpdateSubject(chatId,text);react(sock,m,'✅');}catch(e){await update(`❌ ${e?.message}`);}
            await sleep(800);await showAdminMenu();state='ADMIN';return;
        }

        if(state==='ADMIN_SETDESC'){
            if(text==='رجوع'){await showAdminMenu();state='ADMIN';return;}
            const {isAdmin,isBotAdmin,isGroup}=await getAdminPerms();
            if(!isGroup||!isAdmin||!isBotAdmin) return update('❌ `يتطلب صلاحيات المشرفين.`');
            react(sock,m,'⏳');
            try{await sock.groupUpdateDescription(chatId,text);react(sock,m,'✅');}catch(e){await update(`❌ ${e?.message}`);}
            await sleep(800);await showAdminMenu();state='ADMIN';return;
        }

        if(state==='ADMIN_SETIMG'){
            if(text==='رجوع'){await showAdminMenu();state='ADMIN';return;}
            const {isAdmin,isBotAdmin,isGroup}=await getAdminPerms();
            if(!isGroup||!isAdmin||!isBotAdmin) return update('❌ `يتطلب صلاحيات المشرفين.`');
            const ctx=m.message?.extendedTextMessage?.contextInfo;
            const target2=ctx?.quotedMessage?{message:ctx.quotedMessage,key:{...m.key,id:ctx.stanzaId,participant:ctx.participant}}:m;
            if(!target2.message?.imageMessage) return update('🖼️ `الرجاء إرسال أو اقتباس صورة.`');
            react(sock,m,'⏳');
            try{const buf=await downloadMediaMessage(target2,'buffer',{});await sock.updateProfilePicture(chatId,buf);react(sock,m,'✅');}
            catch(e){await update(`❌ ${e?.message}`);}
            await sleep(800);await showAdminMenu();state='ADMIN';return;
        }

        if(state==='ADMIN_SETWELCOME'){
            if(text==='رجوع'){await showAdminMenu();state='ADMIN';return;}
            writeJSON(grpFile('welcome'),{text}); react(sock,m,'✅');
            await update(`✅ \`تم حفظ رسالة الترحيب بنجاح:\`\n${text}`);
            await sleep(800);await showAdminMenu();state='ADMIN';return;
        }

        if(state==='ADMIN_SETRULES'){
            if(text==='رجوع'){await showAdminMenu();state='ADMIN';return;}
            writeJSON(grpFile('rules'),{text}); react(sock,m,'✅');
            await sleep(800);await showAdminMenu();state='ADMIN';return;
        }

        if(state==='ADMIN_WELCOME_VIEW'){
            if(text==='رجوع'){await showAdminMenu();state='ADMIN';return;}
            if(text==='حذف'){fs.removeSync(grpFile('welcome'));react(sock,m,'🗑️');await sleep(500);await showAdminMenu();state='ADMIN';}
            return;
        }

        if(state==='ADMIN_RULES_VIEW'){
            if(text==='رجوع'){await showAdminMenu();state='ADMIN';return;}
            if(text==='حذف'){fs.removeSync(grpFile('rules'));react(sock,m,'🗑️');await sleep(500);await showAdminMenu();state='ADMIN';}
            return;
        }

        if(state==='ADMIN_BADWORDS'){
            if(text==='رجوع'){await showAdminMenu();state='ADMIN';return;}
            const bf=grpFile('badwords');
            let words=readJSON(bf,[]);
            if(text.startsWith('اضافة ')){
                const w=text.slice(6).trim().toLowerCase();
                if(w){words.push(w);writeJSON(bf,words);react(sock,m,'✅');}
                await sleep(400);await showBadwords();return;
            }
            if(text.startsWith('حذف ')){
                const w=text.slice(4).trim().toLowerCase();
                writeJSON(bf,words.filter(x=>x!==w));react(sock,m,'🗑️');
                await sleep(400);await showBadwords();return;
            }
            return;
        }

        if(state==='ADMIN_BROADCAST'){
            if(text==='رجوع'){await showAdminMenu();state='ADMIN';return;}
            react(sock,m,'⏳');
            try{
                const chats=await sock.groupFetchAllParticipating();
                let sent=0;
                for(const gid of Object.keys(chats)){try{await sock.sendMessage(gid,{text});sent++;}catch{}await sleep(500);}
                react(sock,m,'✅');await update(`✅ \`تم إرسال الإذاعة بنجاح إلى ${sent} مجموعة.\``);
            }catch(e){await update(`❌ ${e?.message}`);}
            await sleep(1000);await showAdminMenu();state='ADMIN';return;
        }

        if(state==='ADMIN_SRCHCMD'){
            if(text==='رجوع'){await showAdminMenu();state='ADMIN';return;}
            const plugins=getPlugins(),pfxC=global._botConfig?.prefix||'.';
            const res=Object.entries(plugins).filter(([k,v])=>k.includes(text)||(v.description||'').toLowerCase().includes(text)).map(([k,v])=>`- ${pfxC}${k}${v.description?' — '+v.description:''}`).join('\n');
            await update(res||`❌ \`لم يتم العثور على نتائج للبحث: "${text}"\`\n\n🔙 *رجوع*`);
            return;
        }



    async function showAdminMenu() {
        await update(
`*إدارة المجموعات 🛠️*

- *الأعضاء 👥*
\`رفع مشرف | تنزيل مشرف | المشرفين\`
\`طرد | حظر | الغاء حظر\`
\`كتم | الغاء كتم\`
\`تقييد | رفع تقييد\`

- *المجموعة ⚙️*
\`وضع اسم | وضع وصف | وضع صورة\`
\`قفل المحادثة | فتح المحادثة\`
\`تثبيت | الغاء التثبيت | مسح | رابط\`

- *محتوى 📋*
\`وضع ترحيب | ترحيب\`
\`وضع قوانين | قوانين\`
\`كلمات ممنوعة\`

- *حماية 🔒*
\`قفل الروابط | قفل الصور\`
\`قفل الفيديو | قفل البوتات\`
\`نظام الحماية\`

- *بوت 🤖*
\`الاوامر | بحث اوامر | معلومات\`
\`اذاعة | تحديث\`

🔙 *رجوع*`
        );
    }

    async function showBadwords() {
        const bf = path.join(DATA_DIR, 'badwords_' + chatId.replace(/[^\w]/g,'_') + '.json');
        const words = readJSON(bf,[]);
        const list = words.length ? words.map((w,i)=>`${i+1}. ${w}`).join('\n') : 'لا يوجد كلمات';
        await update(
`*الكلمات الممنوعة 🚫:*\n
${list}

- \`اضافة [الكلمة]\`
- \`حذف [الكلمة]\`
🔙 *رجوع*`
        );
    }


    // ════════════════════════════════════════════════════════
    // دوال عرض القوائم
    // ════════════════════════════════════════════════════════
    async function showEliteMenu() {
        await update(
`*إدارة النخبة 👑*

- *اضافة*
\`➕ لإضافة رقم جديد إلى قائمة النخبة.\`

- *حذف*
\`🗑️ لإزالة رقم من قائمة النخبة.\`

- *عرض*
\`📋 لعرض جميع أرقام النخبة الحالية.\`

- *مسح الكل*
\`🧹 لحذف جميع الأرقام من القائمة دفعة واحدة.\`

🔙 *رجوع*`
        );
    }

    async function showPluginsMenu() {
        const count = getAllPluginFiles().length;
        await update(
`*إدارة البلاجنز 🧩*
📦 إجمالي الأوامر: *${count}*

- *عرض*
\`📋 لعرض قائمة بكل الأوامر المتاحة.\`

- *بحث [اسم]*
\`🔍 للبحث عن تفاصيل أمر معين.\`

- *طفي الكل*
\`🔒 لتعطيل جميع البلاجنز دفعة واحدة.\`

- *شغل الكل*
\`🔓 لتفعيل جميع البلاجنز دفعة واحدة.\`

🔙 *رجوع*`
        );
    }

    async function showPluginDetail(fp, cmd) {
        const { elite, lock, group, prv } = getPluginInfo(fp);
        await update(
`*تفاصيل الأمر (${cmd}) 📋:*

\`حالة الخصائص:\`
- نخبة: ${elite==='on'?'✅':'❌'}
- قفل: ${lock==='on'?'✅':'❌'}
- مجموعات: ${group?'✅':'❌'}
- خاص: ${prv?'✅':'❌'}

*خيارات التعديل:*
- \`تغيير الاسم\`
- \`نخبة\` / \`عام\`
- \`قفل\` / \`فتح\`
- \`مجموعات\` / \`خاص\` / \`للجميع\`

🔙 *رجوع*`
        );
    }

    async function showSubMenu() {
        const subs = readSubs();
        const list = subs.map(name => {
            const credsPath = path.join(ACCOUNTS_DIR, name, 'nova', 'data', 'creds.json');
            let jid = '—';
            if (fs.existsSync(credsPath)) {
                try {
                    const c = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
                    jid = c.me?.id?.split(':')[0] || '—';
                } catch {}
            }
            return `— *${name}*  +${jid}`;
        }).join('\n') || 'لا يوجد بوتات فرعية';

        await update(
`*تنصيب البوتات الفرعية 🤖*

${list}

- *جديد* — إنشاء بوت جديد
- *حالة* — عرض الأرقام المربوطة
- *ريستارت [اسم]* — إعادة تشغيل
- *حذف [اسم]* — حذف نهائي

🔙 *رجوع*`
        );
    }

    async function showStats() {
        const s    = readStats();
        const topCmds = Object.entries(s.commands)
            .sort((a,b)=>b[1]-a[1]).slice(0,5)
            .map(([k,v],i)=>`${i+1}. ${k}: *${v}*`).join('\n') || 'لا يوجد';
        const topUsers= Object.entries(s.users)
            .sort((a,b)=>b[1]-a[1]).slice(0,5)
            .map(([k,v],i)=>`${i+1}. ${k}: *${v}*`).join('\n') || 'لا يوجد';

        const uptime = process.uptime();
        const h = Math.floor(uptime/3600), mm = Math.floor((uptime%3600)/60), ss = Math.floor(uptime%60);
        const ram  = os.totalmem(), free = os.freemem();
        const ramUsed = ((ram-free)/1024/1024/1024).toFixed(1);
        const ramTotal= (ram/1024/1024/1024).toFixed(1);

        await update(
`*إحصاءات النظام 📊*

📨 إجمالي الأوامر: *${s.total}*
⏱️ وقت التشغيل: *${h}h ${mm}m ${ss}s*
💾 الذاكرة المستهلكة: *${ramUsed}/${ramTotal} GB*

🏆 *أكثر الأوامر استخداماً:*
${topCmds}

👤 *أكثر المستخدمين تفاعلاً:*
${topUsers}

- \`مسح\` لتصفير الإحصاءات.
🔙 *رجوع*`
        );
    }

    async function showProtMenu() {
        const p = readProt();
        const s = k => p[k]==='on' ? '✅' : '⛔';
        await update(
`*نظام الحماية 🛡️*

- *أنتي كراش* ${s('antiCrash')}
\`💥 لحماية البوت من رسائل التجميد.\`

- *أنتي لينكات* ${s('antiLink')}
\`🔗 لمنع إرسال الروابط بالمجموعات.\`

- *أنتي حذف* ${s('antiDelete')}
\`🗑️ لإظهار الرسائل التي يحذفها الأعضاء.\`

- *أنتي سب* ${s('antiInsult')}
\`🤬 لحذف الكلمات البذيئة تلقائياً.\`

- *view once* ${s('antiViewOnce')}
\`👁️ لتحميل وعرض الصور/الفيديو المؤقتة.\`

\`اكتب اسم الميزة لتشغيلها أو إيقافها.\`
🔙 *رجوع*`
        );
    }

    async function showCmdTools() {
        await update(
`*أدوات الأوامر 🔧*

- *تغيير اسم*
\`✏️ تغيير اسم أمر (مثال: .تست ➔ .ارثر)\`

- *فاحص الكود*
\`🔍 يفحص syntax البلاجن ويكشف الأخطاء والتحذيرات\`

- *مسح كاش*
\`🗑️ مسح الكاش وإعادة تحميل الأوامر\`

🔙 *رجوع*`
        );
    }

    // ── تسجيل الجلسة ─────────────────────────────────────────
    sock.ev.on('messages.upsert', listener);
    const timeout = setTimeout(() => {
        sock.ev.off('messages.upsert', listener);
        activeSessions.delete(chatId);
    }, 300_000);

    activeSessions.set(chatId, { listener, timeout });
}

export default { NovaUltra, execute };
