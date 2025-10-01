import { UserAgentInfo, UserAgentData, UserAgentDataBrand } from "./types";

export function extract() {
    const nav = typeof navigator !== "undefined" ? navigator : {} as Navigator;
    const ua = (nav.userAgent || "").trim();
    const uad = nav.userAgentData || null; // Chromium-only (not on iOS Safari)
    const brave = !!(nav as any).brave;

    // ---- 1) Try Client Hints (simple, robust on Chromium) ----
    const clientHints = getFromUserAgentData(uad);
    if (clientHints) {
        // If we can detect Brave via API, prefer that label.
        if (brave && clientHints.browser.name === "Chrome") {
            clientHints.browser.name = "Brave";
        }
        clientHints.source = "clientHints";
        return clientHints;
    }

    // ---- 2) Fallback: compact UA parsing for common devices ----
    const result = getFromUserAgent(ua, nav);
    if (brave && result.browser.name === "Chrome") result.browser.name = "Brave";
    result.source = "userAgent";
    return result;
}

// ---------- helpers ----------
function getFromUserAgentData(uaData: UserAgentData): UserAgentInfo | null {
    if (!uaData) return null;

    // Browser name/version from brands (low-entropy, but fine for majors)
    let brand = pickBrand(uaData.brands || []);
    const browserName = normalizeBrandName(brand?.brand || "");
    const browserVersion = brand?.version || null;

    // OS & device
    const platform = uaData.platform || ""; // "Windows", "macOS", "Android", "Chrome OS", "Linux", "iOS"
    const os = mapPlatformToOS(platform);
    const deviceType = uaData.mobile ? "Mobile" : guessDesktopVsLaptop(os); // CH can’t tell tablet vs phone; ok for “conventional”
    const engine = browserName === "Firefox"
        ? "Gecko"
        : browserName === "Safari"
            ? "WebKit"
            : "Blink"; // Chromium family default

    return {
        browser: { name: browserName, version: browserVersion },
        os: { name: os.name, version: os.version },
        device: { type: deviceType },
        engine,
        userAgent: (navigator.userAgent || ""),
        platform: uaData.platform || "",
    };
}

function getFromUserAgent(ua: string, nav: Navigator): UserAgentInfo {
    // --- OS (handles iPadOS 13+ masquerading as macOS) ---
    let osName = "Unknown", osVersion = null;

    // iPadOS 13+: MacIntel + touch points
    const isIPadOS13Plus = nav.platform === "MacIntel" && (nav.maxTouchPoints || 0) > 1;

    if (/\bWindows NT\b/.test(ua)) {
        osName = "Windows";
        const m = ua.match(/Windows NT ([\d.]+)/);
        osVersion = m ? ntToWindows(m[1]) : null;
    } else if (/\bAndroid\b/i.test(ua)) {
        osName = "Android";
        const m = ua.match(/Android (\d+(?:\.\d+)?)/i);
        osVersion = m ? m[1] : null;
    } else if (/\biPhone|iPad|iPod\b/i.test(ua)) {
        osName = "iOS";
        const m = ua.match(/OS (\d+[_\.\d]*)/i);
        osVersion = m ? m[1].replace(/_/g, ".") : null;
    } else if (isIPadOS13Plus) {
        osName = "iOS";
        osVersion = null;
    } else if (/\bMac OS X\b/.test(ua)) {
        osName = "macOS";
        const m = ua.match(/Mac OS X (\d+[_\.\d]*)/);
        osVersion = m ? m[1].replace(/_/g, ".") : null;
    } else if (/\bCrOS\b/.test(ua)) {
        osName = "Chrome OS";
    } else if (/\bLinux\b/.test(ua)) {
        osName = "Linux";
    }

    // --- Browser & version (handles iOS app names) ---
    let browserName = "Unknown", browserVersion = null, engine = "Unknown";

    // Order matters
    const rules = [
        { name: "Edge", re: /EdgA?\/([\d.]+)/ },              // Edge (Android + desktop)
        { name: "Opera", re: /OPR\/([\d.]+)/ },
        { name: "Samsung Internet", re: /SamsungBrowser\/([\d.]+)/ },
        { name: "Firefox", re: /(?:Firefox|FxiOS)\/([\d.]+)/ },
        { name: "Chrome", re: /(?:Chrome|CriOS)\/([\d.]+)/ },   // Chrome desktop + Chrome on iOS
        { name: "Safari", re: /Version\/([\d.]+).*Safari/ }
    ];
    for (const r of rules) {
        const m = ua.match(r.re);
        if (m) { browserName = r.name; browserVersion = m[1]; break; }
    }

    // iOS specifics (identify app name even though engine is WebKit)
    if (/iPhone|iPad|iPod/.test(ua)) {
        if (/CriOS/.test(ua)) browserName = "Chrome (iOS)";
        else if (/FxiOS/.test(ua)) browserName = "Firefox (iOS)";
        else if (/EdgiOS/.test(ua)) browserName = "Edge (iOS)";
        else if (/OPiOS/.test(ua)) browserName = "Opera (iOS)";
        else if (/Safari/.test(ua)) browserName = "Safari";
    }

    // Engine
    if (/Gecko\/\d/i.test(ua) && /Firefox\//i.test(ua)) engine = "Gecko";
    else if (/AppleWebKit\//i.test(ua)) engine = /Chrome|CriOS|OPR|Edg|SamsungBrowser/.test(ua) && !/iPhone|iPad|iPod/.test(ua) ? "Blink" : "WebKit";
    else if (/Trident|MSIE/.test(ua)) engine = "Trident";

    // --- Device type ---
    let deviceType = "Desktop";
    const isMobile = /\bMobi\b/i.test(ua) || /iPhone|iPod/.test(ua);
    const isTablet = /iPad/.test(ua) || (/\bAndroid\b/i.test(ua) && !/\bMobile\b/i.test(ua)) || (nav.platform === "MacIntel" && (nav.maxTouchPoints || 0) > 1);
    if (isTablet) deviceType = "Tablet";
    else if (isMobile) deviceType = "Mobile";

    return {
        browser: { name: browserName, version: browserVersion },
        os: { name: osName, version: osVersion },
        device: { type: deviceType },
        engine,
        userAgent: ua,
        platform: nav.platform || "",
    };
}

function pickBrand(brands: UserAgentDataBrand[]) {
    // Prefer recognizable brands over "Not A;Brand"
    const preferred = ["Microsoft Edge", "Opera", "Google Chrome", "Chromium"];
    for (const p of preferred) {
        const hit = brands.find(b => (b.brand || "").toLowerCase() === p.toLowerCase());
        if (hit) return hit;
    }
    // Fallback: first non-“Not” brand
    return brands.find(b => !(b.brand || "").match(/not.*brand/i)) || brands[0] || null;
}

function normalizeBrandName(name) {
    if (/edge/i.test(name)) return "Edge";
    if (/opera/i.test(name)) return "Opera";
    if (/chrome|chromium/i.test(name)) return "Chrome";
    return name || "Unknown";
}

function mapPlatformToOS(platform) {
    switch ((platform || "").toLowerCase()) {
        case "windows": return { name: "Windows", version: null };
        case "macos": return { name: "macOS", version: null };
        case "android": return { name: "Android", version: null };
        case "ios": return { name: "iOS", version: null };
        case "chrome os":
        case "chromeos": return { name: "Chrome OS", version: null };
        case "linux": return { name: "Linux", version: null };
        default: return { name: platform || "Unknown", version: null };
    }
}

function guessDesktopVsLaptop(os) {
    // For human meaning, “Desktop” is fine for non-mobile platforms.
    return /android|ios/i.test(os.name) ? "Mobile" : "Desktop";
}

function ntToWindows(nt) {
    // Windows 10 & 11 both report NT 10.0; keep it simple & human-meaningful
    const map = {
        "10.0": "10/11",
        "6.3": "8.1",
        "6.2": "8",
        "6.1": "7",
        "6.0": "Vista",
        "5.2": "Server 2003 / XP x64",
        "5.1": "XP",
        "5.0": "2000"
    };
    return map[nt] || nt;
}
