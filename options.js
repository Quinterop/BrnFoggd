let config = {};

chrome.storage.local.get("config", ({ config: saved }) => {
    config = saved ?? DEFAULT_CONFIG
    document.getElementById("maxMinutes").value = config.maxMinutes;
    document.getElementById("maxVisits").value = config.maxVisits;
    document.getElementById("resetHour").value = config.resetHour;
    renderSites();
});

function renderSites() {
    const list = document.getElementById("siteList");
    list.innerHTML = "";
    config.sites.forEach((site, i) => {
        const li = document.createElement("li");
        li.innerHTML = `<span>${site}</span>`;
        const btn = document.createElement("button");
        btn.innerText = "✕";
        btn.onclick = () => {
            config.sites.splice(i, 1);
            renderSites();
        };
        li.appendChild(btn);
        list.appendChild(li);
    });
}

document.getElementById("addSite").onclick = () => {
    const input = document.getElementById("newSite");
    const val = input.value.trim().replace("www.", "").toLowerCase();
    if (val && !config.sites.includes(val)) {
        config.sites.push(val);
        renderSites();
    }
    input.value = "";
};

document.getElementById("save").onclick = () => {
    config.maxMinutes = parseInt(document.getElementById("maxMinutes").value);
    config.maxVisits = parseInt(document.getElementById("maxVisits").value);
    config.resetHour = parseInt(document.getElementById("resetHour").value);

    chrome.storage.local.set({ config }, () => {
        // Re-schedule reset alarm with new hour
        chrome.runtime.sendMessage({ type: "RESCHEDULE_RESET" });
        const status = document.getElementById("status");
        status.innerText = "Saved ✓";
        setTimeout(() => { status.innerText = ""; }, 2000);
    });
};
