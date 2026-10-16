const nodemailer = require('nodemailer');
const logger = require('./logger');

// Env values are strings, so "false" has to be turned into false by hand (as a string it counts as true)
function envFlag(value, fallback) {
    if (value === undefined || value === '') return fallback;
    return ['true', '1', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

const port = Number(process.env.MAIL_PORT) || 587;

const config = {
    host: process.env.MAIL_HOST,
    port,
    secure: envFlag(process.env.MAIL_SECURE, port === 465), // true - for 465, false - for other ports
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
    tls: {
        rejectUnauthorized: envFlag(process.env.MAIL_TLS_REJECT_UNAUTHORIZED, true),
    },
    // Without these a mail server that doesn't answer keeps a request waiting for minutes
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
};

const transporter = nodemailer.createTransport(config);

// Minutes between the background checks of the mail server (0 turns them off)
const checkMinutes = Number(process.env.MAIL_CHECK_MINUTES || 10);
const CHECK_INTERVAL = Number.isFinite(checkMinutes) && checkMinutes > 0 ? checkMinutes * 60 * 1000 : 0;
const HISTORY_SIZE = 144; // a day of checks at the default interval

const state = {
    current: null,   // result of the last check
    checking: null,  // promise of the check that is running
    history: [],     // { ok, at, latency } of earlier checks, oldest first
    sent: 0,
    failed: 0,
    lastSent: null,   // { at, subject }
    lastFailure: null // { at, subject, error, code }
};

// What usually causes each nodemailer error code, shown next to the raw error
const HINTS = {
    EDNS: 'The mail server host name could not be resolved. Check MAIL_HOST.',
    ECONNECTION: 'The mail server refused or dropped the connection. Is it running and is the port open?',
    ETIMEDOUT: 'The mail server did not answer in time. It may be down, overloaded or blocked by a firewall.',
    ESOCKET: 'The connection broke. This is often a TLS mismatch, check MAIL_SECURE and MAIL_PORT.',
    ETLS: 'The TLS handshake failed. Check the certificate or MAIL_TLS_REJECT_UNAUTHORIZED.',
    EAUTH: 'The mail server rejected the login. Check EMAIL_USER and EMAIL_PASS.',
    EENVELOPE: 'The mail server rejected the sender or the recipient.',
    EMESSAGE: 'The mail server rejected the message.',
    EPROTOCOL: 'The mail server answered with something unexpected.',
};

// nodemailer reports most network problems as ESOCKET, the message says what really happened
const MESSAGE_HINTS = [
    [/ECONNREFUSED/, 'Nothing accepts connections on that port. Is the mail server running and is MAIL_PORT right?'],
    [/ENOTFOUND|EAI_AGAIN/, HINTS.EDNS],
    [/ETIMEDOUT|timeout/i, HINTS.ETIMEDOUT],
    [/EHOSTUNREACH|ENETUNREACH/, 'The mail server host can not be reached from this machine.'],
    [/ECONNRESET/, 'The mail server closed the connection. It may be overloaded or blocking this IP.'],
    [/certificate|self[- ]signed/i, 'The TLS certificate was rejected. Fix the certificate or set MAIL_TLS_REJECT_UNAUTHORIZED=false.'],
    [/wrong version number|ssl3_get_record|packet length/i, 'TLS mismatch: use MAIL_SECURE=true for port 465 and false for 587 or 25.'],
];

function describeError(err) {
    const message = (err.message || String(err)).trim();
    const code = err.code || (err.responseCode ? `SMTP ${err.responseCode}` : null);
    const match = MESSAGE_HINTS.find(([pattern]) => pattern.test(message));
    return {
        error: message,
        code,
        hint: (match && match[1]) || HINTS[err.code] || null
    };
}

function isConfigured() {
    return !!config.host;
}

// Connects, upgrades to TLS and logs in like a real send would, then disconnects. No email is sent.
async function checkMail() {
    if (state.checking) return state.checking;

    state.checking = (async () => {
        const started = Date.now();
        let result;

        if (!isConfigured()) {
            result = { ok: false, error: 'MAIL_HOST is not set', code: 'CONFIG', hint: 'Set the MAIL_* variables in the server .env file.' };
        } else {
            try {
                await transporter.verify();
                result = { ok: true };
            } catch (err) {
                result = { ok: false, ...describeError(err) };
            }
        }

        result.at = new Date().toISOString();
        result.latency = Date.now() - started;

        const previous = state.current;
        if (previous && previous.ok && !result.ok) {
            logger.warn(`Mail server check failed: ${result.error}`);
        } else if (previous && !previous.ok && result.ok) {
            logger.info('Mail server is reachable again');
        } else if (!previous && !result.ok) {
            logger.warn(`Mail server check failed: ${result.error}`);
        }

        state.current = result;
        state.history.push({ ok: result.ok, at: result.at, latency: result.latency });
        if (state.history.length > HISTORY_SIZE) state.history.shift();

        return result;
    })().finally(() => {
        state.checking = null;
    });

    return state.checking;
}

// Sends through the transporter and remembers how it went, so the admin panel can show it
async function sendMail(options) {
    try {
        const info = await transporter.sendMail(options);
        state.sent++;
        state.lastSent = { at: new Date().toISOString(), subject: options.subject };
        return info;
    } catch (err) {
        state.failed++;
        state.lastFailure = { at: new Date().toISOString(), subject: options.subject, ...describeError(err) };
        throw err;
    }
}

function getMailStatus() {
    const checks = state.history.length;
    const passed = state.history.filter(check => check.ok).length;

    return {
        configured: isConfigured(),
        host: config.host || null,
        port: config.port,
        secure: config.secure,
        rejectUnauthorized: config.tls.rejectUnauthorized,
        user: config.auth.user || null,
        checkInterval: CHECK_INTERVAL,
        checking: !!state.checking,
        current: state.current,
        history: state.history,
        uptime: checks ? passed / checks : null,
        sent: state.sent,
        failed: state.failed,
        lastSent: state.lastSent,
        lastFailure: state.lastFailure
    };
}

function startMailMonitor() {
    checkMail();
    if (CHECK_INTERVAL > 0) {
        setInterval(checkMail, CHECK_INTERVAL).unref();
    }
}

module.exports = { sendMail, checkMail, getMailStatus, startMailMonitor };
