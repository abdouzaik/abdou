// PLUGINS
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
import { loadPlugins } from '../../../handlers/plugins.js';
import path from 'path';
import fs from 'fs-extra';

export async function handlePlugins(ctx, m, text) {
    const { sock, chatId, session, update, pushState, goBack, tryAdminAction, MAIN_MENU } = ctx;
    let state = session.state;
    let tmp   = session.tmp;

        if (session.state === 'PLUGINS') {
            if (text === 'رجوع')    { await goBack(); return; }
            if (text === 'الاوامر') { pushState('PLUGINS', showPluginsMenu); await showPluginsListMenu(); session.state = 'PLUGINS_LIST'; return; }
            if (text === 'التعديل') { pushState('PLUGINS', showPluginsMenu); await showPluginsEditMenu(); session.state = 'PLUGINS_EDIT_MENU'; return; }
            if (text === 'الادوات') { pushState('PLUGINS', showPluginsMenu); await showCmdTools();       session.state = 'CMDTOOLS';          return; }
            if (text === 'جديد')    { pushState('PLUGINS', showPluginsMenu); await update('📝 اكتب اسم الامر الجديد:\n`بدون .js`\n\n🔙 *رجوع*'); session.state = 'PLUGIN_NEW_NAME'; return; }
            return;
        }

        // ── PLUGINS_PAGE — صفحات قائمة الأوامر ──
        if (session.state === 'PLUGINS_PAGE') {
            if (text === 'رجوع') { await goBack(); return; }
            if (text === 'التالي' || text === 'التالي ▶️') {
                if ((session.tmp.pluginPage || 0) < (session.tmp.pluginPages?.length || 1) - 1) {
                    session.tmp.pluginPage++;
                    await showPluginPage();
                }
                return;
            }
            if (text === 'السابق' || text === '◀️ السابق') {
                if ((session.tmp.pluginPage || 0) > 0) {
                    session.tmp.pluginPage--;
                    await showPluginPage();
                }
                return;
            }
            return;
        }

        if (session.state === 'PLUGINS_LIST') {
            if (text === 'رجوع') { await goBack(); return; }
            if (text === 'عرض الكل') {
                // ── Pagination: 15 أمر لكل صفحة ──
                const files = getAllPluginFiles();
                const PAGE_SIZE = 15;
                session.tmp.pluginPages  = [];
                const allLines   = files.map(f => {
                    const { cmd, elite, lock } = getPluginInfo(f);
                    return `✦ ${cmd}${elite==='on'?' 👑':''}${lock==='on'?' 🔒':''}`;
                });
                for (let i = 0; i < allLines.length; i += PAGE_SIZE) {
                    session.tmp.pluginPages.push(allLines.slice(i, i + PAGE_SIZE));
                }
                session.tmp.pluginPage = 0;
                await showPluginPage();
                pushState('PLUGINS_LIST', showPluginsListMenu);
                session.state = 'PLUGINS_PAGE'; return;
            }
            if (text.startsWith('بحث ')) {
                const cmdName = text.slice(4).trim();
                const fp = await findPluginByCmd(cmdName);
                if (!fp) return update(`❌ ما وجدت: ${cmdName}\n\n🔙 *رجوع*`);
                session.tmp.targetFile = fp; session.tmp.targetCmd = cmdName;
                pushState('PLUGINS_LIST', showPluginsListMenu); await showPluginDetail(fp, cmdName); session.state = 'PLUGIN_DETAIL'; return;
            }
            if (text.startsWith('كود ')) {
                const cmdName = text.slice(4).trim();
                const fp = await findPluginByCmd(cmdName);
                if (!fp) return update(`❌ ما وجدت: ${cmdName}`);
                try { await sock.sendMessage(chatId, { document: await fs.promises.readFile(fp), mimetype: 'application/javascript', fileName: path.basename(fp) }); }
                catch (e) { await update(`❌ ${e?.message}`); }
                return;
            }
            return;
        }

        if (session.state === 'PLUGINS_EDIT_MENU') {
            if (text === 'رجوع') { await goBack(); return; }
            if (text.startsWith('بحث ')) {
                const cmdName = text.slice(4).trim();
                const fp = await findPluginByCmd(cmdName);
                if (!fp) return update(`❌ ما وجدت: ${cmdName}\n\n🔙 *رجوع*`);
                session.tmp.targetFile = fp; session.tmp.targetCmd = cmdName;
                pushState('PLUGINS_EDIT_MENU', showPluginsEditMenu); await showPluginDetail(fp, cmdName); session.state = 'PLUGIN_DETAIL'; return;
            }
            if (text === 'طفي الكل') {
                for (const f of getAllPluginFiles()) { if (f.includes('نظام')) continue; try { updatePluginField(f,'lock','on'); } catch (e) { if (e?.message) console.error('[catch]', e.message); } }
                await loadPlugins().catch(()=>{});
                await update('🔒 تم قفل الكل.\n\n🔙 *رجوع*'); return;
            }
            if (text === 'شغل الكل') {
                for (const f of getAllPluginFiles()) { if (f.includes('نظام')) continue; try { updatePluginField(f,'lock','off'); } catch (e) { if (e?.message) console.error('[catch]', e.message); } }
                await loadPlugins().catch(()=>{});
                await update('🔓 تم فتح الكل.\n\n🔙 *رجوع*'); return;
            }
            return;
        }

        if (session.state === 'PLUGIN_DETAIL') {
            if (text === 'رجوع') { await goBack(); return; }
            const fp = session.tmp.targetFile, tc = session.tmp.targetCmd;
            if (!fp) return;
            if (text === 'كود') {
                try { await sock.sendMessage(chatId, { document: await fs.promises.readFile(fp), mimetype: 'application/javascript', fileName: path.basename(fp) }); }
                catch (e) { await update(`❌ ${e?.message}`); }
                return;
            }
            if (text === 'قفل' || text === 'فتح') {
                try { updatePluginField(fp,'lock',text==='قفل'?'on':'off'); await loadPlugins().catch(()=>{}); } catch (e) { if (e?.message) console.error('[catch]', e.message); }
                await sleep(800); await showPluginDetail(fp, tc); return;
            }
            if (text === 'نخبة' || text === 'عام') {
                try { updatePluginField(fp,'elite',text==='نخبة'?'on':'off'); await loadPlugins().catch(()=>{}); } catch (e) { if (e?.message) console.error('[catch]', e.message); }
                await sleep(800); await showPluginDetail(fp, tc); return;
            }
            if (text === 'مجموعات') { try { updatePluginField(fp,'group','true'); updatePluginField(fp,'prv','false'); await loadPlugins().catch(()=>{}); } catch (e) { if (e?.message) console.error('[catch]', e.message); } await sleep(800); await showPluginDetail(fp, tc); return; }
            if (text === 'خاص')     { try { updatePluginField(fp,'prv','true'); updatePluginField(fp,'group','false'); await loadPlugins().catch(()=>{}); } catch (e) { if (e?.message) console.error('[catch]', e.message); } await sleep(800); await showPluginDetail(fp, tc); return; }
            if (text === 'للجميع')  { try { updatePluginField(fp,'group','false'); updatePluginField(fp,'prv','false'); await loadPlugins().catch(()=>{}); } catch (e) { if (e?.message) console.error('[catch]', e.message); } await sleep(800); await showPluginDetail(fp, tc); return; }
            if (text === 'تغيير الاسم') { pushState('PLUGIN_DETAIL', () => showPluginDetail(session.tmp.targetFile, session.tmp.targetCmd)); await update('✏️ اكتب الاسم الجديد:\n\n🔙 *رجوع*'); session.state = 'PLUGIN_RENAME'; return; }
            return;
        }

        if (session.state === 'PLUGIN_RENAME') {
            if (text === 'رجوع') { await goBack(); return; }
            try { updatePluginField(session.tmp.targetFile,'command',text.trim()); await loadPlugins().catch(()=>{}); } catch (e) { if (e?.message) console.error('[catch]', e.message); }
            await update(`☑️ ${session.tmp.targetCmd} ➔ ${text.trim()}`);
            session.tmp.targetCmd = text.trim(); await sleep(1200); await showPluginDetail(session.tmp.targetFile, session.tmp.targetCmd); session.state = 'PLUGIN_DETAIL'; return;
        }

        if (session.state === 'PLUGIN_NEW_NAME') {
            if (text === 'رجوع') { await goBack(); return; }
            const name = text.trim().replace(/\.js$/, '').replace(/[^\w\u0600-\u06FF]/g, '');
            if (!name) return update('❌ اسم غير صحيح.\n\n🔙 *رجوع*');
            session.tmp.newPluginName = name; await update(`📝 ارسل كود الامر [ *${name}* ]:\n\n🔙 *رجوع*`);
            session.state = 'PLUGIN_NEW_CODE'; return;
        }

        if (session.state === 'PLUGIN_NEW_CODE') {
            if (text === 'رجوع') { await goBack(); return; }
            const targetPath = path.join(PLUGINS_DIR, 'tools', `${session.tmp.newPluginName}.js`);
            try {
                fs.ensureDirSync(path.dirname(targetPath));
                await fs.promises.writeFile(targetPath, text, 'utf8');
                await loadPlugins().catch(()=>{});
                reactOk(sock, m);
                await update(`☑️ تم إنشاء [ ${session.tmp.newPluginName} ]`);
            } catch (e) { await update(`❌ ${e?.message}`); }
            await sleep(1000); await showPluginsMenu(); session.state = 'PLUGINS'; return;
        }

        // ══════════════════════════════════════════════════
        // DOWNLOADS
        // ══════════════════════════════════════════════════
}

export async function showPluginsMenu() {
        const count = getAllPluginFiles().length;
        await update(
`✧━── ❝ 𝐏𝐋𝐔𝐆𝐈𝐍𝐒 ❞ ──━✧

📦 الاوامر المحملة: *${count}*

✦ *الاوامر*
\`📋 عرض وبحث الاوامر\`

✦ *التعديل*
\`⚙️ تعديل وضبط الاوامر\`

✦ *الادوات*
\`🔧 تغيير اسم · فاحص · مسح كاش\`

✦ *جديد*
\`➕ إضافة امر جديد\`

🔙 *رجوع*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

export async function showPluginPage() {
        const pages = tmp.pluginPages || [];
        const page  = tmp.pluginPage  || 0;
        if (!pages.length) return update('📭 لا يوجد أوامر.\n\n🔙 *رجوع*');
        const total   = pages.reduce((s, p) => s + p.length, 0);
        const lines   = pages[page].join('\n');
        const hasNext = page < pages.length - 1;
        const hasPrev = page > 0;
        const nav = [
            hasPrev ? '◀️ *السابق*' : '',
            hasNext ? '*التالي* ▶️' : '',
        ].filter(Boolean).join(' | ');
        await update(
`✧━── ❝ 𝐏𝐋𝐔𝐆𝐈𝐍𝐒 ❞ ──━✧

*الاوامر (${total}) — صفحة ${page+1}/${pages.length}:*

${lines}

${nav}
🔙 *رجوع* | 🏠 *الرئيسية*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

export async function showPluginsListMenu() {
        await update(
`✧━── ❝ 𝐋𝐈𝐒𝐓 ❞ ──━✧

✦ *عرض الكل*
\`📋 قائمة كل الاوامر\`

✦ *بحث [اسم]*
\`🔍 تفاصيل امر معين\`

✦ *كود [اسم]*
\`💻 تحميل ملف الامر\`

🔙 *رجوع* | 🏠 *الرئيسية*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

export async function showPluginsEditMenu() {
        await update(
`✧━── ❝ 𝐄𝐃𝐈𝐓 ❞ ──━✧

✦ *بحث [اسم]*
\`✏️ تعديل امر معين\`

✦ *طفي الكل*
\`🔒 قفل جميع الاوامر\`

✦ *شغل الكل*
\`🔓 فتح جميع الاوامر\`

🔙 *رجوع* | 🏠 *الرئيسية*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

export async function showPluginDetail(fp, cmd) {
        const { elite, lock, group, prv } = getPluginInfo(fp);
        await update(
`✧━── ❝ 𝐏𝐋𝐔𝐆𝐈𝐍 ❞ ──━✧

*[ ${cmd} ]*

✦ نخبة:     ${elite==='on'?'☑️':'❌'}
✦ قفل:      ${lock==='on'?'☑️':'❌'}
✦ مجموعات:  ${group?'☑️':'❌'}
✦ خاص:      ${prv?'☑️':'❌'}

✦ *نخبة*    — تعيين للنخبة
✦ *عام*     — تعيين للعموم
✦ *قفل*     — تعطيل الامر
✦ *فتح*     — تفعيل الامر
✦ *مجموعات* — تخصيص للمجموعات
✦ *خاص*     — تخصيص للخاص
✦ *للجميع*  — متاح للكل
✦ *تغيير الاسم* — تغيير اسم الامر
✦ *كود*     — تحميل الملف

🔙 *رجوع* | 🏠 *الرئيسية*

✧━── *-𝙰𝚛𝚝𝚑𝚞𝚛_𝙱𝚘𝚝-* ──━✧`);
    }

