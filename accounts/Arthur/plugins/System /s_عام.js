// GENERAL
import {
    sleep, react, reactWait, reactOk, reactFail, reactInput,
    normalizeJid, getBotJid, checkElite,
    resolveTarget, pinMessage,
    readJSON, writeJSON, readJSONSync, writeJSONSync, atomicWrite,
    readProt, writeProt, readStats, writeStats,
    readBanned, isBanned, addBan, removeBan,
    getAllPluginFiles, getPluginInfo, updatePluginField, findPluginByCmd,
    quickLint, checkPluginSyntax,
    isGroupAdmin, isBotGroupAdmin, getGroupAdminInfo,
    grpFile, DATA_DIR, PLUGINS_DIR, BOT_DIR, PROT_FILE, STATS_FILE,
    BAN_FILE, PLUGINS_CFG_FILE, _eliteProPath, activeSessions,
    configObj,
} from './_utils.js';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { loadPlugins } from '../../handlers/plugins.js';
import path from 'path';
import fs from 'fs-extra';

export async function handleGeneral(ctx, m, text) {
    const { sock, chatId, session, update, pushState, goBack, tryAdminAction, MAIN_MENU } = ctx;
    let state = session.state;
    let tmp   = session.tmp;

        if (session.state === 'STATS') {
            if (text === 'رجوع') { await goBack(); return; }
            if (text === 'مسح') { writeStats({ commands:{}, users:{}, total:0 }); _statsCache = null; await update('☑️ تم المسح.'); await sleep(800); await showStats(ctx); }
            return;
        }

        // ══════════════════════════════════════════════════
        // PROT
        // ══════════════════════════════════════════════════
        if (session.state === 'PROT') {
            if (text === 'رجوع') { await goBack(); return; }
            const protMap = {
                'انتي كراش':'antiCrash',
                'انتي حذف':'antiDelete',
                'انتي سب':'antiInsult',
            };
            const key = protMap[text];
            if (key) {
                const p = readProt(); p[key] = p[key]==='on'?'off':'on'; writeProt(p);
                reactOk(sock, m);
                await sleep(800); await showProtMenu(ctx);
            }
            return;
        }

        // ══════════════════════════════════════════════════
        // CMDTOOLS
        // ══════════════════════════════════════════════════
        if (session.state === 'CMDTOOLS') {
            if (text === 'رجوع') { await goBack(); return; }
            if (text === 'تغيير اسم')  { pushState('CMDTOOLS', () => showCmdTools(ctx)); await update('✏️ اكتب اسم الامر الحالي:\n\n🔙 *رجوع*'); session.state = 'RENAME_WAIT'; return; }
            if (text === 'فاحص الكود') { pushState('CMDTOOLS', () => showCmdTools(ctx)); await update('🔍 اكتب اسم الامر:\n\n🔙 *رجوع*'); session.state = 'CODE_CHECK_WAIT'; return; }
            if (text === 'مسح كاش') {
                reactWait(sock, m);
                try { if (global._pluginsCache) global._pluginsCache = {}; await loadPlugins().catch(()=>{}); reactOk(sock, m); await update('☑️ تم المسح.'); }
                catch (e) { reactFail(sock, m); await update(`❌ ${e?.message}`); }
                await sleep(800); await showCmdTools(ctx); return;
            }
            return;
        }

        if (session.state === 'RENAME_WAIT') {
            if (text === 'رجوع') { await goBack(); return; }
            const fp = await findPluginByCmd(text);
            if (!fp) return update(`❌ ما وجدت: ${text}`);
            session.tmp.targetFile = fp; session.tmp.targetCmd = text;
            await update(`☑️ [ ${text} ] — اكتب الاسم الجديد:\n\n🔙 *رجوع*`);
            pushState('RENAME_WAIT', () => showCmdTools(ctx)); session.state = 'RENAME_NEW'; return;
        }

        if (session.state === 'RENAME_NEW') {
            if (text === 'رجوع') { await goBack(); return; }
            try { updatePluginField(session.tmp.targetFile,'command',text.trim()); await loadPlugins().catch(()=>{}); } catch (e) { if (e?.message) console.error('[catch]', e.message); }
            await update(`☑️ ${session.tmp.targetCmd} ➔ ${text.trim()}`);
            await sleep(1200); await showCmdTools(ctx); session.state = 'CMDTOOLS'; return;
        }

        if (session.state === 'CODE_CHECK_WAIT') {
            if (text === 'رجوع') { await goBack(); return; }
            const fp = await findPluginByCmd(text);
            if (!fp) return update(`❌ ما وجدت: ${text}`);
            reactWait(sock, m);
            const lintIssues = quickLint(fp);
            const checkRes   = await checkPluginSyntax(fp);
            let report = `✧━── ❝ 𝐂𝐇𝐄𝐂𝐊 ❞ ──━✧\n\n*فحص [ ${text} ]*\n\n`;
            if (checkRes.ok && !lintIssues.length) {
                report += '☑️ *الكود سليم*\n';
            } else {
                report += '⚠️ *مشاكل:*\n';
                if (!checkRes.ok) {
                    report += `🔴 Syntax Error\n`;
                    if (checkRes.line)     report += `السطر: ${checkRes.line}\n`;
                    if (checkRes.codeLine) report += `\`${checkRes.codeLine}\`\n`;
                    report += `\`${checkRes.error?.slice(0, 200)}\`\n`;
                }
                lintIssues.forEach(i => { report += `🟡 ${i}\n`; });
            }
            report += '\n🔙 *رجوع*\n\n✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧';
            checkRes.ok && !lintIssues.length ? reactOk(sock, m) : reactFail(sock, m);
            await update(report);
            session.state = 'CMDTOOLS'; return;
        }

        // ══════════════════════════════════════════════════
        // ADMIN
        // ══════════════════════════════════════════════════
}

export async function showStats(ctx) {
        const { update, sock, chatId, session } = ctx || {};
        const s = readStats();
        const topCmds = Object.entries(s.commands||{})
            .sort((a,b) => b[1]-a[1]).slice(0,5)
            .map(([k,v],i) => `${i+1}. ${k}: *${v}*`).join('\n') || 'لا يوجد';

        // ── دمج ثلاثي: twice map + participants + config owner ──
        let twiceMap = {};
        try {
            const ePath = path.join(BOT_DIR, '../../handlers/elite-pro.json');
            twiceMap = readJSON(ePath, {}).twice || {};
        } catch (e) { if (e?.message) console.error('[showStats/twice]', e.message); }

        let participants = [];
        if (chatId.endsWith('@g.us')) {
            try {
                const meta = await sock.groupMetadata(chatId);
                participants = meta.participants || [];
            } catch (e) { if (e?.message) console.error('[showStats/meta]', e.message); }
        }

        // رقم الهاتف الصالح: 7-15 رقم (LID أطول من ذلك)
        const isValidPhone = (numStr) => numStr.length >= 7 && numStr.length <= 15;

        const resolveJid = (raw) => {
            // 1. phone JID مباشرة — تحقق أن الرقم صالح (مش LID)
            if (raw.endsWith('@s.whatsapp.net')) {
                const num = normalizeJid(raw);
                if (isValidPhone(num)) return { jid: raw, resolved: true };
                return { jid: null, resolved: false }; // LID متنكر كـ phone
            }

            // 2. LID → twice map (الأموثق)
            if (raw.endsWith('@lid') && twiceMap[raw]) {
                const phoneJid = twiceMap[raw];
                const num = normalizeJid(phoneJid);
                if (isValidPhone(num)) return { jid: phoneJid, resolved: true };
            }

            // 3. LID → participants
            if (raw.endsWith('@lid')) {
                const lidNum = normalizeJid(raw);
                const found  = participants.find(p =>
                    normalizeJid(p.lid || '') === lidNum || normalizeJid(p.id) === lidNum
                );
                if (found?.id?.endsWith('@s.whatsapp.net')) {
                    const num = normalizeJid(found.id);
                    if (isValidPhone(num)) return { jid: found.id, resolved: true };
                }
            }

            // 4. fallback رقم نظيف — قبول فقط لو طول صالح
            const num = raw.split('@')[0].split(':')[0].replace(/\D/g, '');
            if (isValidPhone(num)) return { jid: num + '@s.whatsapp.net', resolved: true };

            // 5. LID غير محلول — نتجاهله في المنشنات
            return { jid: null, resolved: false };
        };

        const userEntries = Object.entries(s.users||{}).sort((a,b) => b[1]-a[1]).slice(0,5);
        const resolvedUsers = [];
        for (const [raw, count] of userEntries) {
            const { jid, resolved } = resolveJid(raw);
            if (resolved && jid) {
                resolvedUsers.push({ jid, display: normalizeJid(jid), count, mention: true });
            } else {
                // LID غير محلول — نعرضه بدون منشن
                const rawNum = normalizeJid(raw);
                resolvedUsers.push({ jid: null, display: rawNum.slice(0,8) + '…', count, mention: false });
            }
        }

        const topUsers = resolvedUsers
            .map((u, i) => u.mention
                ? `${i+1}. @${u.display} • *${u.count}* رسالة`
                : `${i+1}. ${u.display} • *${u.count}* رسالة`)
            .join('\n') || 'لا يوجد';
        const mentions = resolvedUsers
            .filter(u => u.mention && u.jid)
            .map(u => u.jid);

        const up = process.uptime();
        const h = Math.floor(up/3600), mm = Math.floor((up%3600)/60), ss = Math.floor(up%60);
        await update({
            text:
`✧━── ❝ 𝐒𝐓𝐀𝐓𝐒 ❞ ──━✧

📨 الاوامر: *${s.total||0}*
⏱️ التشغيل: *${h}h ${mm}m ${ss}s*

🏆 *اكثر الاوامر:*
${topCmds}

👤 *اكثر المستخدمين:*
${topUsers}

✦ *مسح* — تصفير الإحصاءات
🔙 *رجوع*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`,
            mentions,
        });
    }

export async function showProtMenu(ctx) {
        const { update, sock, chatId, session } = ctx || {};
        const p = readProt(), s = k => p[k]==='on'?'☑️ مفعّل':'⛔ معطّل';
        await update(
`✧━── ❝ 𝐏𝐑𝐎𝐓𝐄𝐂𝐓𝐈𝐎𝐍 ❞ ──━✧

✦ *انتي كراش* — ${s('antiCrash')}
\`💥 حماية من رسائل التجميد والكراش\`

✦ *انتي حذف* — ${s('antiDelete')}
\`🗑️ إظهار الرسائل المحذوفة مع نوعها\`

✦ *انتي سب* — ${s('antiInsult')}
\`🤬 حذف الكلمات البذيئة + تحذير\`

اكتب اسم الميزة لتشغيلها أو إيقافها
🔙 *رجوع*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

    
export async function showCmdTools(ctx) {
        const { update, sock, chatId, session } = ctx || {};
        await update(
`✧━── ❝ 𝐂𝐌𝐃 𝐓𝐎𝐎𝐋𝐒 ❞ ──━✧

✦ *تغيير اسم*
\`✏️ اكتبه ثم اكتب الاسم الجديد للأمر\`

✦ *فاحص الكود*
\`🔍 فحص أخطاء السينتاكس لأي بلاجن\`

✦ *مسح كاش*
\`🗑️ مسح الكاش وإعادة تحميل الأوامر\`

🔙 *رجوع*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

