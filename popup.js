function fmtMs(ms) {
    if (ms <= 0) return "0m 0s";
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

async function render() {
    const { config, state, activeTab: tracked } =
        await chrome.storage.local.get(["config", "state", "activeTab"]);

    // Get current active tab's hostname
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const host = tab?.url ? new URL(tab.url).hostname.replace("www.", "") : null;

    if (!host || !config.sites.includes(host)) {
        document.getElementById("site").innerText = "No tracked site active";
        ["timeToday", "timeLeft", "visitsLeft"].forEach(id => {
            document.getElementById(id).innerText = "—";
        });
        return;
    }

    const s = state[host] ?? { visits: 0, timeMs: 0 };

    // Add live elapsed if currently tracking this site
    const liveMs = (tracked?.site === host && tracked?.startTs)
        ? Date.now() - tracked.startTs
        : 0;

    const totalMs = s.timeMs + liveMs;
    const limitMs = config.maxMinutes * 60 * 1000;
    const leftMs = Math.max(limitMs - totalMs, 0);
    const visitsLeft = Math.max(config.maxVisits - s.visits, 0);

    document.getElementById("site").innerText = host;
    document.getElementById("timeToday").innerText = fmtMs(totalMs);
    document.getElementById("timeLeft").innerText = fmtMs(leftMs);
    document.getElementById("visitsLeft").innerText = `${visitsLeft} / ${config.maxVisits}`;

    // Warn if low
    if (leftMs < 60000 || visitsLeft <= 1) {
        ["timeLeft", "visitsLeft"].forEach(id =>
            document.getElementById(id).classList.add("warn")
        );
    }

    if (leftMs === 0 || visitsLeft === 0) {
        document.getElementById("blocked").innerText = "🚫 Limit reached for today";
    }
}

render();
