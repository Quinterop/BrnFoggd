chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "VISIT_COUNT") showBanner(msg.count);
});

function showBanner(count) {
    const existing = document.getElementById("__tl_banner");
    if (existing) existing.remove();

    const banner = document.createElement("div");
    banner.id = "__tl_banner";
    banner.innerText = `⏱ Visit ${count} today`;
    Object.assign(banner.style, {
        position: "fixed",
        top: "12px",
        right: "12px",
        zIndex: "999999",
        background: "#1a1a2e",
        color: "#fff",
        padding: "10px 16px",
        borderRadius: "8px",
        fontSize: "14px",
        fontFamily: "sans-serif",
        boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
        transition: "opacity 0.5s"
    });

    document.body.appendChild(banner);
    setTimeout(() => { banner.style.opacity = "0"; }, 3000);
    setTimeout(() => { banner.remove(); }, 3500);
}
