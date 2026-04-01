function fmtMs(ms) {
    if (ms <= 0) return "0m 0s";
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

async function render() {
    const { config, state, activeTab: tracked } =
        await chrome.storage.local.get(["config", "state", "activeTab"]);

    const container = document.getElementById("siteList");
    container.innerHTML = "";

    if (!config.sites.length) {
        container.innerHTML = `<div class="none">No sites configured</div>`;
        return;
    }

    for (const site of config.sites) {
        const s = state?.[site] ?? { visits: 0, timeMs: 0 };

        // Add live elapsed if this site is currently being tracked
        const liveMs = (tracked?.site === site && tracked?.startTs && tracked.startTs >= (s.sessionStartedAt ?? 0))
            ? Date.now() - tracked.startTs : 0;

        const totalMs = s.timeMs + liveMs;
        const limitMs = config.maxMinutes * 60 * 1000;
        const leftMs = Math.max(limitMs - totalMs, 0);
        const visitsLeft = Math.max(config.maxVisits - s.visits, 0);
        const isActive = tracked?.site === site;

        const card = document.createElement("div");
        card.className = "site-card";
        card.innerHTML = `
      <div class="site-name">${site}${isActive ? " 🟢" : ""}</div>
      <div class="row"><span>Time today</span>   <span class="val">${fmtMs(totalMs)}</span></div>
      <div class="row"><span>Session left</span> <span class="val ${leftMs < 60000 ? "warn" : ""}">${fmtMs(leftMs)}</span></div>
      <div class="row"><span>Visits left</span>  <span class="val ${visitsLeft <= 1 ? "warn" : ""}">${visitsLeft} / ${config.maxVisits}</span></div>
    `;
        container.appendChild(card);
    }
}

document.getElementById("reset").onclick = async () => {
    const { state } = await chrome.storage.local.get("state");
    for (const site in state) {
        state[site].visits = 0;
        state[site].timeMs = 0;
    }
    await chrome.storage.local.set({ state, activeTab: null });
    render();
};

render();
