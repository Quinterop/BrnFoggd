console.log("bg alive");
const DEFAULT_CONFIG = {
    sites: [],        // e.g. ["reddit.com", "youtube.com"]
    maxMinutes: 30,   // per session
    maxVisits: 5,     // per day
    resetHour: 6      // 6 AM reset
};
const tabHosts = {}; // { tabId: lastHost }

// Add at top of background.js, runs on every SW wake-up
async function restoreActiveTab() {
    const { activeTab: saved } = await chrome.storage.local.get("activeTab");
    if (saved?.site && saved?.startTs && saved?.id) {
        activeTab = saved; // resume the clock from where it was
        console.log(`[restore] resumed tracking ${saved.site} from ${new Date(saved.startTs).toISOString()}`);
    }
}

chrome.runtime.onStartup.addListener(async () => {
    await restoreActiveTab();
    checkAndReset();
});

chrome.runtime.onInstalled.addListener(async () => {
    chrome.storage.local.set({ config: DEFAULT_CONFIG, state: {} });
    checkAndReset();
});


// On install, init storage
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.set({
        config: DEFAULT_CONFIG,
        state: {}  // { "reddit.com": { visits: 0, timeMs: 0, lastReset: null } }
    });
    checkAndReset();
});

// Re-schedule alarm on service worker wake-up
chrome.runtime.onStartup.addListener(checkAndReset);

async function checkAndReset() {
    const { config, state, lastReset } = await chrome.storage.local.get(["config", "state", "lastReset"]);

    const now = new Date();
    const lastResetDate = lastReset ? new Date(lastReset) : null;

    // Build today's reset threshold
    const todayReset = new Date();
    todayReset.setHours(config.resetHour, 0, 0, 0);

    // If we've passed today's reset hour and haven't reset since then → reset now
    if (now >= todayReset && (!lastResetDate || lastResetDate < todayReset)) {
        const cleared = {};
        for (const site in state) {
            cleared[site] = { visits: 0, timeMs: 0 };
        }
        await chrome.storage.local.set({ state: cleared, lastReset: now.toISOString() });
        console.log("Reset triggered on startup/wake");
    }

    scheduleReset();
}

function scheduleReset() {
    chrome.storage.local.get("config", ({ config }) => {
        const now = new Date();
        const reset = new Date();
        reset.setHours(config.resetHour, 0, 0, 0);
        if (reset <= now) reset.setDate(reset.getDate() + 1);
        chrome.alarms.create("dailyReset", { when: reset.getTime() });
    });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === "heartbeat") {
        if (!activeTab.startTs) await restoreActiveTab();
        if (activeTab.site && activeTab.id) {
            checkAndTrack(activeTab.id, `https://${activeTab.site}`, "heartbeat");
        }
    }
    if (alarm.name === "dailyReset") {
        chrome.storage.local.get("state", ({ state }) => {
            for (const site in state) {
                state[site].visits = 0;
                state[site].timeMs = 0;
            }
            chrome.storage.local.set({ state, lastReset: new Date().toISOString() });
        });
        scheduleReset();
    }
});

// ── Tab tracking ─────────────────────────────────────────
let activeTab = { id: null, site: null, startTs: null };

function getHostname(url) {
    try {
        return new URL(url).hostname.replace("www.", "");
    } catch { return null; }
}

function getOrInitSite(state, site) {
    if (!state[site]) state[site] = { visits: 0, timeMs: 0 };
    return state[site];
}

async function checkAndTrack(tabId, url, trigger = "?") {
    if (!activeTab.startTs) await restoreActiveTab();
    console.log(`[checkAndTrack] trigger=${trigger} tab=${tabId} url=${url}`);

    const { config, state } = await chrome.storage.local.get(["config", "state"]);
    const host = getHostname(url);
    if (!host || !config.sites.includes(host)) {
        delete tabHosts[tabId];
        return stopTracking();
    }

    const s = getOrInitSite(state, host);

    // Only run visit logic on new arrivals
    if (tabHosts[tabId] !== host) {
        // Visit cap — block before counting
        if (s.visits >= config.maxVisits) {
            delete tabHosts[tabId];
            await stopTracking();
            chrome.tabs.update(tabId, { url: chrome.runtime.getURL("over.html") + `?reason=visits&site=${host}` });
            return;
        }

        // Count visit + reset session time
        s.visits += 1;
        s.timeMs = 0;
        s.sessionStartedAt = Date.now();
        activeTab = { id: null, site: null, startTs: null };
        await chrome.storage.local.set({ state, activeTab });
        chrome.tabs.sendMessage(tabId, { type: "VISIT_COUNT", count: s.visits }).catch(() => { });
        console.log(`[visit] tab=${tabId} prev=${tabHosts[tabId] ?? "none"} new=${host} visits=${s.visits}`);
    }

    tabHosts[tabId] = host;

    // Time check — runs every navigation but timeMs is fresh for new visits
    const liveMs = (activeTab.site === host && activeTab.startTs)
        ? Date.now() - activeTab.startTs : 0;
    const totalMs = s.timeMs + liveMs;
    const limitMs = config.maxMinutes * 60 * 1000;

    if (totalMs >= limitMs) {
        delete tabHosts[tabId];
        await stopTracking();
        chrome.tabs.update(tabId, { url: chrome.runtime.getURL("over.html") + `?reason=time&site=${host}` });
        return;
    }

    startTracking(tabId, host);
}


function startTracking(tabId, site) {
    if (activeTab.site === site && activeTab.id === tabId) return;

    stopTracking(); // flush previous
    activeTab = { id: tabId, site, startTs: Date.now() };
    chrome.storage.local.set({ activeTab });

}

async function stopTracking() {
    if (!activeTab.site || !activeTab.startTs) return;

    const elapsed = Date.now() - activeTab.startTs;
    const { state } = await chrome.storage.local.get("state");
    const s = getOrInitSite(state, activeTab.site);
    s.timeMs += elapsed;
    await chrome.storage.local.set({ state });

    activeTab = { id: null, site: null, startTs: null };
    chrome.storage.local.set({ activeTab });  // ← add this

}


// ── Events ────────────────────────────────────────────────
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === "complete" && tab.active) {
        if (!activeTab.startTs) await restoreActiveTab();
        checkAndTrack(tabId, tab.url, "onUpdated");
    }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    if (!activeTab.startTs) await restoreActiveTab();
    chrome.tabs.get(tabId, (tab) => {
        if (tab?.url) checkAndTrack(tabId, tab.url, "onActivated");
    });
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
        if (!activeTab.startTs) await restoreActiveTab();
        stopTracking();
    }
    else {
        if (!activeTab.startTs) await restoreActiveTab();
        chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
            if (tab?.url) checkAndTrack(tab.id, tab.url, "onFocusChanged");
        });
    }
});

chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "RESCHEDULE_RESET") scheduleReset();
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
    if (!activeTab.startTs) await restoreActiveTab();
    delete tabHosts[tabId];
    if (activeTab.id === tabId) stopTracking();
});


