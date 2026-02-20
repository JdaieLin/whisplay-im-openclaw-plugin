import { promises as fs } from "node:fs";
import path from "node:path";

const CHANNEL_ID = "whisplay-im";
const GATEWAY_LOG_DIR = "/tmp/openclaw";
const GATEWAY_LOG_FILE_PATTERN = /^openclaw-\d{4}-\d{2}-\d{2}\.log$/;
const PAIRING_CACHE_LIMIT = 256;

const pairingRelaySeen = new Map();

function getPairingSeenSet(accountId) {
    const key = String(accountId ?? "default");
    let seen = pairingRelaySeen.get(key);
    if (!seen) {
        seen = new Set();
        pairingRelaySeen.set(key, seen);
    }
    return seen;
}

function rememberPairingKey(seen, value) {
    seen.add(value);
    if (seen.size <= PAIRING_CACHE_LIMIT) {
        return;
    }
    const overflow = seen.size - PAIRING_CACHE_LIMIT;
    const iterator = seen.values();
    for (let index = 0; index < overflow; index += 1) {
        const first = iterator.next();
        if (first.done) {
            break;
        }
        seen.delete(first.value);
    }
}

async function findLatestGatewayLogFile() {
    let entries;
    try {
        entries = await fs.readdir(GATEWAY_LOG_DIR, { withFileTypes: true });
    } catch {
        return null;
    }

    const candidates = entries
        .filter((entry) => entry.isFile() && GATEWAY_LOG_FILE_PATTERN.test(entry.name))
        .map((entry) => path.join(GATEWAY_LOG_DIR, entry.name));

    if (candidates.length === 0) {
        return null;
    }

    const stats = await Promise.all(
        candidates.map(async (filePath) => {
            try {
                const stat = await fs.stat(filePath);
                return { filePath, mtimeMs: stat.mtimeMs };
            } catch {
                return null;
            }
        }),
    );

    const sorted = stats
        .filter(Boolean)
        .sort((left, right) => right.mtimeMs - left.mtimeMs);

    return sorted[0]?.filePath ?? null;
}

async function readTailText(filePath, maxBytes = 128 * 1024) {
    let stat;
    try {
        stat = await fs.stat(filePath);
    } catch {
        return "";
    }

    if (!stat.isFile() || stat.size <= 0) {
        return "";
    }

    const start = Math.max(0, stat.size - maxBytes);
    const length = stat.size - start;
    const handle = await fs.open(filePath, "r");
    try {
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, start);
        return buffer.toString("utf8");
    } finally {
        await handle.close();
    }
}

function extractPairingAlerts(logText, options = {}) {
    if (!logText) {
        return [];
    }

    const lines = logText.split(/\r?\n/).filter(Boolean);
    const alerts = [];

    const recentThresholdMs =
        typeof options.notBeforeMs === "number" && Number.isFinite(options.notBeforeMs)
            ? options.notBeforeMs
            : Date.now() - 15 * 60 * 1000;

    for (const line of lines) {
        if (!line.includes("pairing-required") && !line.toLowerCase().includes("setup code")) {
            continue;
        }

        const timeMatch = line.match(/"time":"([^"]+)"/);
        if (timeMatch) {
            const ts = Date.parse(timeMatch[1]);
            if (Number.isFinite(ts) && ts < recentThresholdMs) {
                continue;
            }
        }

        const requestMatch = line.match(/"requestId":"([0-9a-f-]{16,})"/i);
        if (requestMatch) {
            const requestId = requestMatch[1];
            alerts.push({
                dedupeKey: `request:${requestId}`,
                message:
                    `Gateway detected a new pairing request.\n` +
                    `requestId: ${requestId}\n` +
                    `Please approve this request in OpenClaw console under Devices/Approvals.`,
            });
            continue;
        }

        const setupMatch = line.match(/setup code[^A-Za-z0-9]*([A-Z0-9-]{4,})/i);
        if (setupMatch) {
            const setupCode = setupMatch[1];
            alerts.push({
                dedupeKey: `setup:${setupCode}`,
                message: `Gateway pairing code: ${setupCode}`,
            });
            continue;
        }
    }

    return alerts;
}

function resolveAccountSection(cfg, accountId) {
    const section = cfg?.channels?.[CHANNEL_ID] ?? {};
    const accountKey = accountId ?? "default";
    const accountSection =
        section?.accounts && typeof section.accounts === "object" && section.accounts[accountKey]
            ? section.accounts[accountKey]
            : {};
    return {
        ...section,
        ...(accountSection && typeof accountSection === "object" ? accountSection : {}),
        accountId: accountKey,
    };
}

function normalizeBaseUrl(ip) {
    const raw = String(ip ?? "").trim();
    if (!raw) {
        return "";
    }
    if (raw.startsWith("http://") || raw.startsWith("https://")) {
        return raw.replace(/\/$/, "");
    }
    return `http://${raw.replace(/\/$/, "")}`;
}

function buildHeaders(token) {
    const headers = { "Content-Type": "application/json" };
    const t = String(token ?? "").trim();
    if (t) {
        headers.Authorization = `Bearer ${t}`;
    }
    return headers;
}

async function sendReply(baseUrl, token, reply) {
    const response = await fetch(`${baseUrl}/whisplay-im/send`, {
        method: "POST",
        headers: buildHeaders(token),
        body: JSON.stringify({ reply }),
    });

    if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`whisplay-im send failed: HTTP ${response.status}${body ? ` ${body}` : ""}`);
    }

    return { ok: true, channel: CHANNEL_ID };
}

async function relayGatewayPairingHints({ accountId, baseUrl, token, log, notBeforeMs }) {
    const logFile = await findLatestGatewayLogFile();
    if (!logFile) {
        return;
    }

    const tail = await readTailText(logFile);
    if (!tail) {
        return;
    }

    const alerts = extractPairingAlerts(tail, { notBeforeMs });
    if (alerts.length === 0) {
        return;
    }

    const seen = getPairingSeenSet(accountId);
    for (const alert of alerts) {
        if (seen.has(alert.dedupeKey)) {
            continue;
        }
        await sendReply(baseUrl, token, alert.message);
        rememberPairingKey(seen, alert.dedupeKey);
        log?.info?.(`[${accountId}] relayed gateway pairing hint: ${alert.dedupeKey}`);
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

const whisplayImChannel = {
    id: CHANNEL_ID,
    meta: {
        id: CHANNEL_ID,
        label: "Whisplay IM",
        selectionLabel: "Whisplay IM (HTTP bridge)",
        docsPath: "/channels/whisplay-im",
        blurb: "Whisplay IM bridge channel via poll/send endpoints.",
        aliases: ["whisplayim"],
    },
    capabilities: {
        chatTypes: ["direct"],
        reactions: false,
        threads: false,
        media: false,
        nativeCommands: false,
        blockStreaming: true,
    },
    reload: { configPrefixes: ["channels.whisplay-im"] },
    configSchema: {
        schema: {
            type: "object",
            additionalProperties: false,
            properties: {
                enabled: { type: "boolean" },
                ip: { type: "string" },
                token: { type: "string" },
                waitSec: { type: "integer" },
                accounts: {
                    type: "object",
                    additionalProperties: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                            name: { type: "string" },
                            enabled: { type: "boolean" },
                            ip: { type: "string" },
                            token: { type: "string" },
                            waitSec: { type: "integer" }
                        }
                    }
                }
            }
        }
    },
    config: {
        listAccountIds: (cfg) => {
            const section = cfg?.channels?.[CHANNEL_ID] ?? {};
            const accounts = section?.accounts && typeof section.accounts === "object" ? section.accounts : {};
            const keys = Object.keys(accounts).filter(Boolean);
            return keys.length > 0 ? keys : ["default"];
        },
        defaultAccountId: (cfg) => {
            const section = cfg?.channels?.[CHANNEL_ID] ?? {};
            const accounts = section?.accounts && typeof section.accounts === "object" ? section.accounts : {};
            return Object.prototype.hasOwnProperty.call(accounts, "default")
                ? "default"
                : (Object.keys(accounts)[0] ?? "default");
        },
        resolveAccount: (cfg, accountId) => {
            const effective = resolveAccountSection(cfg, accountId);
            return {
                accountId: effective.accountId,
                enabled: effective?.enabled !== false,
                ip: typeof effective?.ip === "string" ? effective.ip : "",
                token: typeof effective?.token === "string" ? effective.token : "",
                waitSec:
                    typeof effective?.waitSec === "number" && Number.isFinite(effective.waitSec)
                        ? effective.waitSec
                        : 30,
                configured: typeof effective?.ip === "string" && effective.ip.trim().length > 0,
            };
        },
        isConfigured: (account) => Boolean(account?.configured),
        describeAccount: (account) => ({
            accountId: account?.accountId ?? "default",
            enabled: account?.enabled !== false,
            configured: Boolean(account?.configured),
            ip: account?.ip ? "[set]" : "[missing]",
            token: account?.token ? "[set]" : "[empty]",
            waitSec: account?.waitSec ?? 30,
        }),
    },
    messaging: {
        normalizeTarget: (raw) => {
            const value = String(raw ?? "").trim();
            if (!value) {
                return undefined;
            }
            return value.replace(/^whisplay-im:/i, "");
        },
        targetResolver: {
            looksLikeId: (raw) => String(raw ?? "").trim().length > 0,
            hint: "<device-or-session-id>",
        },
    },
    outbound: {
        deliveryMode: "direct",
        sendText: async ({ cfg, accountId, text }) => {
            const account = resolveAccountSection(cfg, accountId);
            const baseUrl = normalizeBaseUrl(account.ip);
            if (!baseUrl) {
                throw new Error("whisplay-im is not configured: missing ip");
            }

            return sendReply(baseUrl, account.token, text);
        },
        sendMedia: async ({ cfg, accountId, text, mediaUrl }) => {
            const caption = String(text ?? "").trim();
            const media = String(mediaUrl ?? "").trim();
            const composed = media ? (caption ? `${caption}\n\n${media}` : media) : caption;
            const result = await whisplayImChannel.outbound.sendText({
                cfg,
                accountId,
                text: composed,
            });
            return result;
        },
    },
    status: {
        defaultRuntime: {
            accountId: "default",
            running: false,
            configured: false,
            lastStartAt: null,
            lastStopAt: null,
            lastInboundAt: null,
            lastOutboundAt: null,
            lastError: null,
            mode: "poll",
        },
        buildAccountSnapshot: ({ account, runtime }) => ({
            accountId: account?.accountId ?? "default",
            enabled: account?.enabled !== false,
            configured: Boolean(account?.configured),
            running: runtime?.running ?? false,
            lastStartAt: runtime?.lastStartAt ?? null,
            lastStopAt: runtime?.lastStopAt ?? null,
            lastInboundAt: runtime?.lastInboundAt ?? null,
            lastOutboundAt: runtime?.lastOutboundAt ?? null,
            lastError: runtime?.lastError ?? null,
            mode: "poll",
        }),
    },
    gateway: {
        startAccount: async (ctx) => {
            const account = resolveAccountSection(ctx.cfg, ctx.accountId);
            const baseUrl = normalizeBaseUrl(account.ip);
            if (!baseUrl) {
                throw new Error("whisplay-im is not configured: missing ip");
            }

            const isAborted = () => Boolean(ctx.abortSignal && ctx.abortSignal.aborted);
            ctx.setStatus({
                accountId: ctx.accountId,
                configured: true,
                running: true,
                mode: "poll",
                lastStartAt: Date.now(),
                lastError: null,
            });

            try {
                const relayStartAtMs = Date.now();
                const pairingWatcher = (async () => {
                    while (!isAborted()) {
                        try {
                            await relayGatewayPairingHints({
                                accountId: ctx.accountId,
                                baseUrl,
                                token: account.token,
                                log: ctx.log,
                                notBeforeMs: relayStartAtMs,
                            });
                        } catch (error) {
                            ctx.log?.warn?.(
                                `[${ctx.accountId}] pairing hint relay failed: ${error instanceof Error ? error.message : String(error)}`,
                            );
                        }
                        await sleep(5000);
                    }
                })();

                while (!isAborted()) {
                    try {
                        const waitSec =
                            typeof account.waitSec === "number" && Number.isFinite(account.waitSec)
                                ? account.waitSec
                                : 30;
                        const requestInit = {
                            method: "GET",
                            headers: buildHeaders(account.token),
                        };
                        if (ctx.abortSignal) {
                            requestInit.signal = ctx.abortSignal;
                        }
                        const response = await fetch(
                            `${baseUrl}/whisplay-im/poll?waitSec=${encodeURIComponent(String(waitSec))}`,
                            requestInit,
                        );
                        if (!response.ok) {
                            const body = await response.text().catch(() => "");
                            throw new Error(`poll failed: HTTP ${response.status}${body ? ` ${body}` : ""}`);
                        }
                        const payload = await response.json().catch(() => ({}));
                        if (payload && typeof payload === "object" && (payload.message || payload.messages)) {
                            ctx.setStatus({
                                ...ctx.getStatus(),
                                accountId: ctx.accountId,
                                running: true,
                                configured: true,
                                mode: "poll",
                                lastInboundAt: Date.now(),
                                lastError: null,
                            });
                        }
                    } catch (error) {
                        if (isAborted()) {
                            break;
                        }
                        ctx.setStatus({
                            ...ctx.getStatus(),
                            accountId: ctx.accountId,
                            running: true,
                            configured: true,
                            mode: "poll",
                            lastError: error instanceof Error ? error.message : String(error),
                        });
                        await sleep(2000);
                    }
                }
                await pairingWatcher.catch(() => { });
            } finally {
                ctx.setStatus({
                    ...ctx.getStatus(),
                    accountId: ctx.accountId,
                    running: false,
                    lastStopAt: Date.now(),
                });
            }
        },
    },
};

const plugin = {
    id: CHANNEL_ID,
    name: "Whisplay IM",
    description: "Whisplay IM bridge channel plugin",
    register(api) {
        api.registerChannel({ plugin: whisplayImChannel });
    },
};

export default plugin;
