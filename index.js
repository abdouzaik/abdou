import { fork }     from 'child_process';
import { join, dirname, resolve } from 'path';
import fs           from 'fs-extra';
import { fileURLToPath } from 'url';
import * as accountUtils from './accounts/accountUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const colors = {
    reset: "\x1b[0m", bright: "\x1b[1m",
    fg: { red:"\x1b[31m", green:"\x1b[32m", yellow:"\x1b[33m", cyan:"\x1b[36m", white:"\x1b[37m" }
};
const logger = {
    success: m => console.log(colors.fg.green  + colors.bright + '✓ ' + m + colors.reset),
    error:   m => console.error(colors.fg.red  + colors.bright + '✗ ' + m + colors.reset),
    info:    m => console.info(colors.fg.cyan  + colors.bright + 'ℹ ' + m + colors.reset),
    warn:    m => console.warn(colors.fg.yellow+ colors.bright + '⚠ ' + m + colors.reset),
};

const maxRetries  = 3;
const retryDelay  = 5000;
const accountsDir = join(__dirname, 'accounts');

// ── خريطة العمليات الفرعية الحية ──────────────────────────────
// key = accountName, value = { child, retryCount }
const runningAccounts = new Map();

if (!fs.existsSync(accountsDir)) fs.mkdirSync(accountsDir, { recursive: true });

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ══════════════════════════════════════════════════════════════
// تشغيل حساب واحد
// ══════════════════════════════════════════════════════════════
function spawnAccount(accountName, isLoginMode = false, retry = 0) {
    if (runningAccounts.has(accountName)) {
        logger.warn(`⚠️ Account [${accountName}] already running.`);
        return;
    }

    let targetFolder;
    if (isLoginMode) {
        targetFolder = resolve(__dirname, 'node_modules', 'default');
    } else {
        targetFolder = join(accountsDir, accountName);
    }

    if (!fs.existsSync(targetFolder)) fs.mkdirSync(targetFolder, { recursive: true });

    const connectionFolder = join(targetFolder, 'ملف_الاتصال');

    if (isLoginMode) logger.info('🔐 Starting Gateway System (Login Mode)...');
    else             logger.info(`🚀 Starting Account: [ ${accountName} ]`);

    const child = fork(join(__dirname, 'main.js'), [], {
        stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
        env: {
            ...process.env,
            TARGET_FOLDER:     targetFolder,
            ACCOUNT_NAME:      accountName,
            LOGIN_MODE:        isLoginMode ? 'true' : 'false',
            CONNECTION_FOLDER: connectionFolder,
        }
    });

    runningAccounts.set(accountName, { child, retryCount: retry });

    child.on('message', async (data) => {
        if (data === 'ready') {
            if (!isLoginMode) logger.success(`✅ [${accountName}] is online!`);
            else              logger.info('✅ Gateway is ready.');

        } else if (data === 'reset') {
            logger.warn(`🔄 [${accountName}] Reloading...`);
            child.kill();
            runningAccounts.delete(accountName);
            await delay(1000);
            spawnAccount(accountName, isLoginMode, 0);

        } else if (data === 'uptime') {
            child.send(process.uptime());

        // ── طلب إنشاء حساب فرعي جديد ──
        } else if (data?.type === 'spawn_sub') {
            const { name } = data;
            logger.info(`➕ Spawning sub-account: [${name}]`);
            spawnAccount(name, false, 0);

        // ── طلب إيقاف حساب فرعي ──
        } else if (data?.type === 'kill_sub') {
            const { name } = data;
            killAccount(name);
        }
    });

    child.on('exit', async (code) => {
        runningAccounts.delete(accountName);

        if (code === 0) { logger.info(`✅ [${accountName}] closed naturally.`); return; }
        if (code === 429) {
            logger.warn(`⚠️ [${accountName}] Rate limit, waiting 10s...`);
            await delay(10000);
            return spawnAccount(accountName, isLoginMode, retry);
        }

        if (retry < maxRetries) {
            retry++;
            logger.warn(`⚠️ [${accountName}] Restarting (${retry}/${maxRetries})...`);
            await delay(retryDelay);
            spawnAccount(accountName, isLoginMode, retry);
        } else {
            logger.error(`❌ [${accountName}] Failed after ${maxRetries} retries.`);
            // الحساب الرئيسي فشل = أوقف الكل
            if (!isLoginMode && accountName === accountUtils.getMasterAccountName()) {
                process.exit(1);
            }
        }
    });

    child.on('error', (err) => {
        runningAccounts.delete(accountName);
        logger.error(`❌ [${accountName}] Process error: ${err.message}`);
        if (retry < maxRetries) {
            setTimeout(() => spawnAccount(accountName, isLoginMode, retry + 1), retryDelay);
        }
    });
}

function killAccount(name) {
    const entry = runningAccounts.get(name);
    if (!entry) return;
    entry.child.kill();
    runningAccounts.delete(name);
    logger.info(`🛑 [${name}] stopped.`);
}

// ══════════════════════════════════════════════════════════════
// البداية
// ══════════════════════════════════════════════════════════════
logger.info('Anastasia Multi-Session Manager 🪐🌀');

let masterName = accountUtils.getCurrentAccountName();
let isLoginMode = false;

if (!masterName) {
    isLoginMode = true;
    masterName  = 'default';
    logger.info('🔒 Securing accounts...');
    accountUtils.lockAllAccounts();
} else {
    const potentialPath = join(accountsDir, masterName);
    if (!fs.existsSync(potentialPath)) {
        logger.warn(`⚠️ Account [${masterName}] not found! Reverting to Login Mode.`);
        accountUtils.logoutAccount();
        accountUtils.lockAllAccounts();
        isLoginMode = true;
        masterName  = 'default';
    }
}

// شغّل الحساب الرئيسي
spawnAccount(masterName, isLoginMode, 0);

// شغّل كل الحسابات الفرعية المحفوظة تلقائياً
if (!isLoginMode) {
    const subFile = join(accountsDir, 'sub_accounts.json');
    if (fs.existsSync(subFile)) {
        try {
            const subs = JSON.parse(fs.readFileSync(subFile, 'utf8'));
            for (const subName of subs) {
                if (subName === masterName) continue;
                if (fs.existsSync(join(accountsDir, subName))) {
                    await delay(2000); // فترة بين كل تشغيل
                    spawnAccount(subName, false, 0);
                }
            }
        } catch {}
    }
}

process.on('SIGINT', () => {
    for (const [name, { child }] of runningAccounts) {
        child.kill();
    }
    process.exit();
});
