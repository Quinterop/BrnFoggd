console.log("bg alive");
const DEFAULT_CONFIG = {
    sites: [],        // e.g. ["reddit.com", "youtube.com"]
    maxMinutes: 30,   // per session
    maxVisits: 5,     // per day
    resetHour: 6      // 6 AM reset
};
const tabHosts = {}; // { tabId: lastHost }


// On install, init storage
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.set({
        config: DEFAULT_CONFIG,
        state: {}  // { "reddit.com": { visits: 0, timeMs: 0, lastReset: null } }
    });
    scheduleReset();
});

// Re-schedule alarm on service worker wake-up
chrome.runtime.onStartup.addListener(scheduleReset);

// ── Reset alarm ──────────────────────────────────────────
function scheduleReset() {
    chrome.storage.local.get("config", ({ config }) => {
        const now = new Date();
        const reset = new Date();
        reset.setHours(config.resetHour, 0, 0, 0);
        if (reset <= now) reset.setDate(reset.getDate() + 1);

        chrome.alarms.create("dailyReset", { when: reset.getTime() });
    });
}

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "dailyReset") {
        chrome.storage.local.get("state", ({ state }) => {
            for (const site in state) {
                state[site].visits = 0;
                state[site].timeMs = 0;
            }
            chrome.storage.local.set({ state });
        });
        scheduleReset(); // queue next day
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

async function checkAndTrack(tabId, url) {
    const { config, state } = await chrome.storage.local.get(["config", "state"]);
    const host = getHostname(url);
    if (!host || !config.sites.includes(host)) {
        delete tabHosts[tabId];
        return stopTracking();
    }

    const s = getOrInitSite(state, host);

    if (s.visits >= config.maxVisits) {
        chrome.tabs.update(tabId, { url: chrome.runtime.getURL("blocked.html") + `?reason=visits&site=${host}` });
        return stopTracking();
    }
    if (s.timeMs >= config.maxMinutes * 60 * 1000) {
        chrome.tabs.update(tabId, { url: chrome.runtime.getURL("blocked.html") + `?reason=time&site=${host}` });
        return stopTracking();
    }

    // Only count a visit when arriving from a different host
    if (tabHosts[tabId] !== host) {
        s.visits += 1;
        await chrome.storage.local.set({ state });
        chrome.tabs.sendMessage(tabId, { type: "VISIT_COUNT", count: s.visits }).catch(() => { });
    }

    tabHosts[tabId] = host;
    startTracking(tabId, host);
}


function startTracking(tabId, site) {
    stopTracking(); // flush previous
    chrome.storage.local.set({ activeTab: { site, startTs: Date.now() } });
    activeTab = { id: tabId, site, startTs: Date.now() };
    chrome.storage.local.set({ activeTab });  // ← add this

}

async function stopTracking() {
    if (!activeTab.site || !activeTab.startTs) return;

    const elapsed = Date.now() - activeTab.startTs;
    const { state } = await chrome.storage.local.get("state");
    const s = getOrInitSite(state, activeTab.site);
    s.timeMs += elapsed;
    await chrome.storage.local.set({ state });

    const { config } = await chrome.storage.local.get("config");
    if (s.timeMs >= config.maxMinutes * 60 * 1000 && activeTab.id) {
        const tab = await chrome.tabs.get(activeTab.id).catch(() => null);
        if (tab && getHostname(tab.url) === activeTab.site) {
            chrome.tabs.update(activeTab.id, {
                url: chrome.runtime.getURL("blocked.html") + `?reason=time&site=${activeTab.site}`
            });
        }
    }

    activeTab = { id: null, site: null, startTs: null };
    chrome.storage.local.set({ activeTab });  // ← add this

}


// ── Events ────────────────────────────────────────────────
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === "complete" && tab.active) {
        checkAndTrack(tabId, tab.url);
    }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
    chrome.tabs.get(tabId, (tab) => {
        if (tab.url) checkAndTrack(tabId, tab.url);
    });
});

chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) stopTracking();
    else {
        chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
            if (tab?.url) checkAndTrack(tab.id, tab.url);
        });
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    if (activeTab.id === tabId) stopTracking();
});

chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "RESCHEDULE_RESET") scheduleReset();
});

chrome.tabs.onRemoved.addListener((tabId) => {
    delete tabHosts[tabId];
    if (activeTab.id === tabId) stopTracking();
});


