// =====================
// SMART BAG SIM SCRIPT
// =====================

let poidsRef = null;
let tolerance = 150;

let latitude = 36.8000;
let longitude = 10.1800;

let rssi = -40;
let seuil_oubli = -70;

let items = [];
let totalWeight = 0;
let lastWeightValue = 0;

let draggedItem = null;
let audioCtx = null;
let alertOscillator = null;
let alertGain = null;
let isAlertActive = false;
let lastLoggedRssi = null;
let lastLoggedWeight = null;
let lastLoggedRef = null;
let lastLoggedGps = { lat: null, lng: null };
let lastRssiValue = rssi;
let suppressAddToast = false;

const LOG_API_BASE = "http://localhost:3001/api/logs";
const DEVICE_ID = "bag-sim";
const GPS_TRAIL_LIMIT = 18;
const EVENT_LOG_LIMIT = 5;
const BAG_PRESETS = {
    school: {
        label: "School Day",
        items: [
            { label: "Math Book", weight: 300, emoji: "📘" },
            { label: "Notebook", weight: 150, emoji: "📒" },
            { label: "Pencil Case", weight: 80, emoji: "🧰" },
            { label: "Water Bottle", weight: 500, emoji: "🥤" }
        ],
        setReference: true
    },
    travel: {
        label: "Travel Mode",
        items: [
            { label: "Laptop", weight: 700, emoji: "💻" },
            { label: "Tablet", weight: 250, emoji: "📱" },
            { label: "Water Bottle", weight: 500, emoji: "🥤" }
        ],
        setReference: true
    },
    light: {
        label: "Light Commute",
        items: [
            { label: "Notebook", weight: 150, emoji: "📒" },
            { label: "Pen", weight: 40, emoji: "🖊️" },
            { label: "Tablet", weight: 250, emoji: "📱" }
        ],
        setReference: true
    }
};

const alertState = {
    weight: { level: "info", message: "Set a reference weight to monitor your bag." },
    gps: { level: "ok", message: "Bag is within the safe zone." },
    bluetooth: { level: "ok", message: "Bluetooth link is stable." }
};

const gpsTrailPoints = [];
const weightTrendData = [];
const rssiTrendData = [];
const TREND_LIMIT = 24;
const eventLog = [];

// Dragging
let draggedElement = null;
let offsetX = 0;
let offsetY = 0;

// GPS bounds
const gpsBounds = {
    latMin: 36.795,
    latMax: 36.805,
    lngMin: 10.175,
    lngMax: 10.185
};

document.addEventListener("pointerdown", primeAudioContext, { once: true });

document.addEventListener("DOMContentLoaded", () => {
    updateBagDisplay();
    updateBagHint();
    makeElementDraggable("bag");
    makeElementDraggable("phoneConnectionSection");
    updateGPSFromBagPosition();
    renderGlobalAlerts();
    renderEventLog();
    addWeightTrendSample(totalWeight);
    addRssiTrendSample(rssi);
    
    // Setup GPS attack button
    const btnGpsAttack = document.getElementById("btnGpsAttack");
    if (btnGpsAttack) {
        btnGpsAttack.addEventListener("click", () => {
            simulateGpsAttack();
        });
    }
});

/* ============================================
   DRAGGABLE ELEMENT SYSTEM
=============================================== */

function makeElementDraggable(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("mousedown", startDrag);
    el.addEventListener("touchstart", startDrag, { passive: true });
}

function startDrag(e) {
    if (["BUTTON", "SELECT", "INPUT"].includes(e.target.tagName)) return;

    if (this.id === "bag" && e.target.closest(".bag-item")) return;

    draggedElement = this;

    const rect = draggedElement.getBoundingClientRect();
    const clientX = e.type.includes("touch") ? e.touches[0].clientX : e.clientX;
    const clientY = e.type.includes("touch") ? e.touches[0].clientY : e.clientY;

    offsetX = clientX - rect.left;
    offsetY = clientY - rect.top;

    draggedElement.style.opacity = "0.9";

    document.addEventListener("mousemove", moveDrag);
    document.addEventListener("touchmove", moveDrag, { passive: false });
    document.addEventListener("mouseup", stopDrag);
    document.addEventListener("touchend", stopDrag);
}

function moveDrag(e) {
    if (!draggedElement) return;

    if (e.type.includes("touch")) e.preventDefault();

    const parentRect = draggedElement.parentElement.getBoundingClientRect();
    const clientX = e.type.includes("touch") ? e.touches[0].clientX : e.clientX;
    const clientY = e.type.includes("touch") ? e.touches[0].clientY : e.clientY;

    let x = clientX - parentRect.left - offsetX;
    let y = clientY - parentRect.top - offsetY;

    x = Math.max(0, Math.min(x, parentRect.width - draggedElement.offsetWidth));
    y = Math.max(0, Math.min(y, parentRect.height - draggedElement.offsetHeight));

    draggedElement.style.position = "absolute";
    draggedElement.style.left = x + "px";
    draggedElement.style.top = y + "px";
    draggedElement.style.transform = "none";

    if (draggedElement.id === "bag") updateGPSFromBagPosition();
}

function stopDrag() {
    if (draggedElement) draggedElement.style.opacity = "1";

    document.removeEventListener("mousemove", moveDrag);
    document.removeEventListener("touchmove", moveDrag);
    document.removeEventListener("mouseup", stopDrag);
    document.removeEventListener("touchend", stopDrag);

    draggedElement = null;
}

/* ============================================
   INVENTORY SYSTEM
=============================================== */

document.querySelectorAll(".inv-item").forEach(item => {
    item.addEventListener("dragstart", e => {
        const target = e.currentTarget;
        draggedItem = {
            label: target.dataset.label,
            weight: parseInt(target.dataset.weight),
            emoji: target.dataset.emoji || target.textContent.trim()
        };
        bagDragEnter();
    });
    item.addEventListener("dragend", () => {
        bagDragLeave();
        trashDragLeave();
    });

    item.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            addInventoryCardToBag(item);
        }
    });
});

function addInventoryCardToBag(card) {
    if (!card) return;
    const weight = parseInt(card.dataset.weight);
    const label = card.dataset.label;
    const emoji = card.dataset.emoji || "📦";
    addItemToBag(weight, label, emoji);
    openBag();
}

function applyPreset(key) {
    const preset = BAG_PRESETS[key];
    if (!preset) return;

    suppressAddToast = true;
    resetBag({ silent: true });
    preset.items.forEach(item => addItemToBag(item.weight, item.label, item.emoji));
    suppressAddToast = false;

    if (preset.setReference) setReferenceWeight({ silent: true });
    recordEvent("info", `${preset.label} preset loaded`);
    showToast(`${preset.label} preset loaded`, "info");
}

function allowDrop(e) { e.preventDefault(); }

function bagDragEnter() {
    const bag = document.getElementById("bag");
    if (bag) bag.classList.add("is-target");
}

function bagDragLeave() {
    const bag = document.getElementById("bag");
    if (bag) bag.classList.remove("is-target");
}

function trashDragEnter() {
    const trash = document.getElementById("trash");
    if (trash) trash.classList.add("highlight");
}

function trashDragLeave() {
    const trash = document.getElementById("trash");
    if (trash) trash.classList.remove("highlight");
}

function dropInBag(e) {
    e.preventDefault();
    bagDragLeave();
    if (!draggedItem) return;

    const bagInner = document.getElementById("bagInner");

    const bagObj = document.createElement("div");
    bagObj.className = "bag-item";
    bagObj.innerText = draggedItem.emoji;
    bagObj.draggable = true;
    bagObj.dataset.weight = draggedItem.weight;
    bagObj.dataset.label = draggedItem.label;
    bagObj.dataset.emoji = draggedItem.emoji;

    wireBagItemEvents(bagObj);

    bagInner.appendChild(bagObj);

    addItemToBag(draggedItem.weight, draggedItem.label, draggedItem.emoji, true);
    openBag();
    draggedItem = null;
}

function dropInTrash(e) {
    e.preventDefault();

    trashDragLeave();
    if (!draggedItem) return;

    removeItemFromBag(draggedItem.weight, draggedItem.label, draggedItem.element);
    draggedItem = null;
}

function addSelectedItem() {
    const select = document.getElementById("itemSelect");
    const weight = parseInt(select.value);
    if (!weight) return;

    const option = select.options[select.selectedIndex];
    addItemToBag(weight, option.text, option.dataset.emoji || "📦");
    openBag();
}

function addCustomWeight() {
    const w = parseInt(document.getElementById("weightInput").value);
    if (!w) return;

    addItemToBag(w, `Custom (${w}g)`, "📦");
    openBag();
}

function addItemToBag(weight, label, emoji = "📦", skipVisual = false) {
    items.push({ label, weight, emoji });
    totalWeight += weight;

    if (!skipVisual) {
        const bagInner = document.getElementById("bagInner");
        const obj = document.createElement("div");
        obj.className = "bag-item";
        obj.innerText = emoji;
        obj.draggable = true;
        obj.dataset.weight = weight;
        obj.dataset.label = label;
        obj.dataset.emoji = emoji;
        wireBagItemEvents(obj);
        bagInner.appendChild(obj);
    }

    updateItemList();
    updateWeightStatus();
    recordEvent("success", `${emoji} ${label} added (${weight}g)`, { noToast: skipVisual || suppressAddToast });
}

function wireBagItemEvents(element) {
    if (!element) return;

    element.addEventListener("dragstart", () => {
        draggedItem = {
            element,
            weight: parseInt(element.dataset.weight),
            label: element.dataset.label,
            emoji: element.dataset.emoji
        };
        trashDragEnter();
    });

    element.addEventListener("dragend", () => {
        trashDragLeave();
    });

    element.addEventListener("mousedown", e => e.stopPropagation());
    element.addEventListener("touchstart", e => e.stopPropagation());
    element.setAttribute("tabindex", "0");
    element.setAttribute("role", "button");
    element.setAttribute("aria-label", `${element.dataset.label} inside bag, ${element.dataset.weight} grams`);

    element.addEventListener("keydown", e => {
        if (e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault();
            removeItemFromBag(parseInt(element.dataset.weight), element.dataset.label, element);
        }
    });
}

function updateItemList() {
    const list = document.getElementById("itemList");
    list.innerHTML = "";

    items.forEach(i => {
        const li = document.createElement("li");
        li.textContent = `${i.label} — ${i.weight}g`;
        list.appendChild(li);
    });

    document.getElementById("totalWeight").innerText = totalWeight;
    updateWeightTrend();
    addWeightTrendSample(totalWeight);
    updateBagHint();
}

function updateWeightStatus() {
    const status = document.getElementById("weightStatus");

    if (poidsRef === null) {
        status.innerHTML = "<div class='info alert'>Add items then set a reference weight to enable monitoring.</div>";
        alertState.weight = {
            level: "info",
            message: "Reference weight not set yet."
        };
        updateBagDisplay();
        maybeLogWeight();
        renderGlobalAlerts();
        updateBagAttention("info");
        return;
    }

    const ecart = Math.abs(totalWeight - poidsRef);

    if (ecart > tolerance) {
        status.innerHTML = "<div class='danger alert'>⚠️ Object missing or incorrect!</div>";
        alertState.weight = {
            level: "danger",
            message: `Weight mismatch of ${ecart} g vs reference`
        };
    } else {
        const caution = ecart > tolerance / 2;
        if (caution) {
            status.innerHTML = "<div class='warning alert'>⚠️ Bag is getting lighter than expected.</div>";
            alertState.weight = {
                level: "warning",
                message: `Slight drift (${ecart} g) from reference`
            };
        } else {
            status.innerHTML = "<div class='success alert'>✔️ Bag weight OK.</div>";
            alertState.weight = {
                level: "ok",
                message: "Weight matches the reference."
            };
        }
    }

    updateBagDisplay();
    maybeLogWeight();
    renderGlobalAlerts();
    updateBagAttention(alertState.weight.level);
}

/* ============================================
   BAG STATUS DISPLAY
=============================================== */

function setReferenceWeight(options = {}) {
    if (totalWeight === 0) return alert("Add items first!");

    poidsRef = totalWeight;
    document.getElementById("refWeight").innerText = poidsRef + " g";

    updateBagDisplay();
    updateWeightStatus();
    resetAlert();
    if (!options.silent) recordEvent("info", `Reference set to ${poidsRef} g`);
}

function resetBag(options = {}) {
    items = [];
    totalWeight = 0;
    poidsRef = null;

    const bagInner = document.getElementById("bagInner");
    if (bagInner) bagInner.innerHTML = "";

    document.getElementById("refWeight").innerText = "Not set";
    document.getElementById("itemList").innerHTML = "";
    document.getElementById("totalWeight").innerText = "0";

    closeBag();
    resetAlert();
    updateBagHint();
    updateBagDisplay();
    updateWeightStatus();
    if (!options.silent) recordEvent("danger", "Bag reset");
}

function openBag() {
    document.getElementById("bagImage").data = "bag_open.svg";
}

function closeBag() {
    document.getElementById("bagImage").data = "bag_closed.svg";
}

function updateBagDisplay() {
    document.getElementById("bagDisplayCurrent").innerText = totalWeight + "g";
    document.getElementById("bagDisplayText").innerText = poidsRef ? poidsRef + "g" : "----";
    updateWeightBar();
    updateBagGauge();
    updateBagDetail();
}

function updateWeightBar() {
    const bar = document.getElementById("bagWeightBar");
    if (!bar || poidsRef === null) return;

    bar.style.width = Math.min((totalWeight / poidsRef) * 100, 100) + "%";
}

function updateBagGauge() {
    const gauge = document.getElementById("bagGauge");
    if (!gauge || poidsRef === null || poidsRef === 0) {
        if (gauge) gauge.style.background = "conic-gradient(#1a3a1a 0deg, rgba(255,255,255,0.08) 0deg)";
        return;
    }

    const pct = Math.min(totalWeight / poidsRef, 1);
    const deg = Math.round(pct * 360);
    const color = pct < 0.5 ? "#00ff41" : pct < 0.8 ? "#ffeb3b" : "#ff5722";
    gauge.style.background = `conic-gradient(${color} ${deg}deg, rgba(255,255,255,0.08) ${deg}deg)`;
}

function updateBagDetail() {
    const detail = document.getElementById("bagStatusDetail");
    if (!detail) return;

    if (poidsRef === null) {
        detail.textContent = "Set a reference weight to monitor.";
        return;
    }

    const delta = totalWeight - poidsRef;
    if (delta === 0) {
        detail.textContent = "Perfect match with reference.";
    } else if (delta > 0) {
        detail.textContent = `Bag is heavier by +${delta} g.`;
    } else {
        detail.textContent = `Bag is lighter by ${Math.abs(delta)} g.`;
    }
}

function updateWeightTrend() {
    const trend = document.getElementById("weightTrend");
    if (!trend) return;

    const delta = totalWeight - lastWeightValue;
    let icon = "↔";
    let cls = "trend-neutral";

    if (Math.abs(delta) >= 5) {
        if (delta > 0) {
            icon = "↗";
            cls = "trend-up";
        } else {
            icon = "↘";
            cls = "trend-down";
        }
    }

    trend.textContent = icon;
    trend.className = `trend ${cls}`;
    trend.setAttribute("aria-label", delta === 0 ? "Weight stable" : delta > 0 ? "Weight increasing" : "Weight decreasing");
    lastWeightValue = totalWeight;
}

function updateRssiTrend() {
    const trend = document.getElementById("rssiTrend");
    if (!trend) return;

    const delta = rssi - lastRssiValue;
    let icon = "↔";
    let cls = "trend-neutral";

    if (Math.abs(delta) >= 1) {
        const improving = delta > 0; // higher RSSI is better
        icon = improving ? "↗" : "↘";
        cls = improving ? "trend-up" : "trend-down";
    }

    trend.textContent = icon;
    trend.className = `trend ${cls}`;
    trend.setAttribute("aria-label", delta === 0 ? "Signal stable" : delta > 0 ? "Signal improving" : "Signal weakening");
    lastRssiValue = rssi;
}

function updateStatusChips() {
    const mappings = [
        { key: "weight", el: "chipWeight" },
        { key: "gps", el: "chipGps" },
        { key: "bluetooth", el: "chipBt" }
    ];

    mappings.forEach(({ key, el }) => {
        const chip = document.getElementById(el);
        const wrapper = chip?.closest(".status-chip");
        if (!chip || !wrapper) return;

        const { level, message } = alertState[key] || { level: "info", message: "No data" };
        chip.textContent = message;
        wrapper.dataset.level = level;
    });
}

function updateBagHint() {
    const hint = document.getElementById("bagDropHint");
    if (!hint) return;
    hint.classList.toggle("hidden", items.length > 0);
}

function removeItemFromBag(weight, label, element = null) {
    if (element) element.remove();

    totalWeight -= weight;
    if (totalWeight < 0) totalWeight = 0;

    const index = items.findIndex(i => i.label === label && i.weight === weight);
    if (index !== -1) items.splice(index, 1);

    updateItemList();
    updateWeightStatus();
    updateBagDisplay();

    if (poidsRef !== null && totalWeight !== poidsRef) triggerAlert();
    if (totalWeight === 0) closeBag();
    recordEvent("warning", `${label} removed (${weight}g)`);
}

function updateBagAttention(level = "info") {
    const bag = document.getElementById("bag");
    if (!bag) return;
    bag.classList.remove("alert-warning", "alert-danger");
    if (level === "warning") bag.classList.add("alert-warning");
    if (level === "danger") bag.classList.add("alert-danger");
}

/* ============================================
   ALERT SYSTEM
=============================================== */

function setLedState(on) {
    const led = document.getElementById("alertLed");
    if (!led) return;
    led.classList.toggle("on", on);
}

function playAlertSound() {
    if (isAlertActive) return;
    isAlertActive = true;

    const audio = document.getElementById("alertSound");
    if (audio) {
        audio.loop = true;
        audio.currentTime = 0;
        audio.play().catch(() => {});
    }
}

function stopAlertSound() {
    isAlertActive = false;

    const audio = document.getElementById("alertSound");
    if (audio) {
        audio.pause();
        audio.currentTime = 0;
    }
}

function triggerAlert() {
    setLedState(true);
    playAlertSound();
}

function resetAlert() {
    setLedState(false);
    stopAlertSound();
}

// Silence the alarm from the UI button without changing bag state
function silenceAlert() {
    resetAlert();
}

function primeAudioContext() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0;
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.01);
    } catch {}
}

/* ============================================
   GPS SYSTEM
=============================================== */

function updateGPSFromBagPosition() {
    const bag = document.getElementById("bag");
    const panel = document.querySelector(".visual-panel");
    if (!bag || !panel) return;

    const bagR = bag.getBoundingClientRect();
    const panelR = panel.getBoundingClientRect();

    const pctX = (bagR.left + bagR.width / 2 - panelR.left) / panelR.width;
    const pctY = (bagR.top + bagR.height / 2 - panelR.top) / panelR.height;

    latitude = gpsBounds.latMin + pctY * (gpsBounds.latMax - gpsBounds.latMin);
    longitude = gpsBounds.lngMin + pctX * (gpsBounds.lngMax - gpsBounds.lngMin);

    document.getElementById("gpsLat").innerText = latitude.toFixed(6);
    document.getElementById("gpsLng").innerText = longitude.toFixed(6);

    updateMiniMap(latitude, longitude);
    updateGpsStatus(distanceMeters(homePosition.lat, homePosition.lng, latitude, longitude));
    maybeLogGps(latitude, longitude);
}

function updateMiniMap(lat, lng) {
    const dot = document.getElementById("miniMapDot");
    const map = document.getElementById("miniMap");
    if (!dot || !map) return;

    const xPct = (lng - gpsBounds.lngMin) / (gpsBounds.lngMax - gpsBounds.lngMin);
    const yPct = (lat - gpsBounds.latMin) / (gpsBounds.latMax - gpsBounds.latMin);

    dot.style.left = (Math.min(Math.max(xPct, 0), 1) * map.offsetWidth) + "px";
    dot.style.top = (Math.min(Math.max(yPct, 0), 1) * map.offsetHeight) + "px";

    updateGpsTrail(Math.min(Math.max(xPct, 0), 1), Math.min(Math.max(yPct, 0), 1), map);
}

function updateGpsTrail(xPct, yPct, map) {
    gpsTrailPoints.push({ x: xPct, y: yPct });
    if (gpsTrailPoints.length > GPS_TRAIL_LIMIT) gpsTrailPoints.shift();

    const trail = document.getElementById("miniMapTrail");
    if (!trail || !map) return;

    trail.innerHTML = "";

    gpsTrailPoints.forEach((point, index) => {
        const node = document.createElement("span");
        node.className = "trail-point";
        node.style.left = (point.x * map.offsetWidth) + "px";
        node.style.top = (point.y * map.offsetHeight) + "px";

        const progress = (index + 1) / gpsTrailPoints.length;
        const size = 4 + progress * 8;
        node.style.width = size + "px";
        node.style.height = size + "px";
        node.style.opacity = Math.min(progress, 0.9);

        trail.appendChild(node);
    });
}

/* ============================================
   LOGGING SYSTEM
=============================================== */

async function logToApi(endpoint, payload) {
    try {
        await fetch(`${LOG_API_BASE}/${endpoint}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
    } catch (err) {
        console.error("Log error:", endpoint, err);
    }
}

/* ============================================
   EVENT LOG + TOASTS
=============================================== */

function recordEvent(type, message, options = {}) {
    const entry = {
        type,
        message,
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    };

    eventLog.unshift(entry);
    if (eventLog.length > EVENT_LOG_LIMIT) eventLog.pop();
    renderEventLog();

    if (!options.noToast) showToast(message, type);
}

function renderEventLog() {
    const list = document.getElementById("eventLogList");
    if (!list) return;

    if (eventLog.length === 0) {
        list.innerHTML = "<li><span class='log-meta'>No activity yet</span></li>";
        return;
    }

    list.innerHTML = eventLog.map(entry => (
        `<li><span class="log-meta">${entry.time}</span><span class="log-type" data-type="${entry.type}">${entry.message}</span></li>`
    )).join("");
}

function showToast(message, type = "info") {
    const container = document.getElementById("toastContainer");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(10px)";
        setTimeout(() => toast.remove(), 300);
    }, 3200);
}

/* ============================================
   TREND SPARKLINES
=============================================== */

function addWeightTrendSample(value) {
    pushTrendSample(weightTrendData, value);
    renderSparkline("weightSparkline", weightTrendData);
}

function addRssiTrendSample(value) {
    pushTrendSample(rssiTrendData, value);
    renderSparkline("rssiSparkline", rssiTrendData, true);
}

function pushTrendSample(list, value) {
    list.push(value);
    if (list.length > TREND_LIMIT) list.shift();
}

function renderSparkline(id, data, invert = false) {
    const el = document.getElementById(id);
    if (!el) return;

    if (data.length === 0) {
        el.innerHTML = "<span class='sparkline-empty'>No data yet</span>";
        return;
    }

    const max = Math.max(...data);
    const min = Math.min(...data);

    el.innerHTML = data.map(value => {
        const range = max - min || 1;
        const normalized = invert ? max - value : value - min;
        const height = Math.round((normalized / range) * 40) + 4;
        return `<span style="height:${height}px"></span>`;
    }).join("");
}

/* ============================================
   UPDATED GPS LOGGING WITH EXTRA FIELDS
=============================================== */

// Position de départ pour calcul distance
let homePosition = { lat: 36.8000, lng: 10.1800 };

// Sauvegarde dernière position pour calcul vitesse
let lastGpsForSpeed = { lat: null, lng: null, time: null };

function distanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000; // metres
    const toRad = deg => deg * Math.PI / 180;

    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) ** 2;

    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function maybeLogGps(lat, lng) {
    const latRounded = Number(lat.toFixed(5));
    const lngRounded = Number(lng.toFixed(5));

    // Ne pas logger si inchangé
    if (lastLoggedGps.lat === latRounded && lastLoggedGps.lng === lngRounded) return;

    // Calcul distance depuis home
    const distanceFromHome = Number(
        distanceMeters(homePosition.lat, homePosition.lng, latRounded, lngRounded).toFixed(2)
    );

    // Calcul vitesse
    let vitesse = 0;
    const now = Date.now();

    if (lastGpsForSpeed.lat !== null) {
        const dist = distanceMeters(lastGpsForSpeed.lat, lastGpsForSpeed.lng, latRounded, lngRounded);
        const dt = (now - lastGpsForSpeed.time) / 1000; // en secondes
        vitesse = dt > 0 ? Number((dist / dt).toFixed(2)) : 0;
    }

    lastGpsForSpeed = { lat: latRounded, lng: lngRounded, time: now };

    // Déterminer zone alerte
    // Alerte si plus de 80m du point initial
    const zoneAlerte = distanceFromHome > 80 ? 1 : 0;

    // Log en mémoire
    lastLoggedGps = { lat: latRounded, lng: lngRounded };

    // Envoi vers MongoDB
    logToApi("gps", {
        deviceId: DEVICE_ID,
        latitude: latRounded,
        longitude: lngRounded,
        vitesse,
        distanceFromHome,
        zoneAlerte
    });
}

/*  
====================================================
✨ UPDATED: FULL WEIGHT LOGGING WITH ALL FIELDS ✨
====================================================
*/
function maybeLogWeight() {
    if (lastLoggedWeight === totalWeight && lastLoggedRef === poidsRef) return;

    lastLoggedWeight = totalWeight;
    lastLoggedRef = poidsRef;

    const ecart = poidsRef !== null ? totalWeight - poidsRef : 0;
    const alerte = Math.abs(ecart) > tolerance ? 1 : 0;

    logToApi("poids", {
        deviceId: DEVICE_ID,
        poidsActuel: totalWeight,
        poidsRef: poidsRef ?? 0,
        ecart: ecart,
        alerte: alerte
    });
}

/* ============================================
   BLUETOOTH RSSI LOGGING
=============================================== */

function maybeLogRssi(value) {
    if (lastLoggedRssi === value) return;
    lastLoggedRssi = value;

    let signal = "fort";
    if (value <= -60 && value > -75) signal = "moyen";
    else if (value <= -75) signal = "faible";

    const alerte = value < -80 ? 1 : 0;

    logToApi("rssi", {
        deviceId: DEVICE_ID,
        rssi: value,
        signal,
        alerte
    });

    addRssiTrendSample(value);
}

/* ============================================
   BLUETOOTH SIMULATION
=============================================== */

function calculateRSSIFromDistance() {
    const phone = document.getElementById("phoneConnectionSection");
    const bag = document.getElementById("bag");
    if (!phone || !bag) return -40;

    const p = phone.getBoundingClientRect();
    const b = bag.getBoundingClientRect();

    const dx = (p.left + p.width / 2) - (b.left + b.width / 2);
    const dy = (p.top + p.height / 2) - (b.top + b.height / 2);
    const dist = Math.sqrt(dx * dx + dy * dy);

    let rssi = -40;
    if (dist > 900) rssi = -90;
    else if (dist > 600) rssi = -75 - ((dist - 600) / 300) * 15;
    else if (dist > 300) rssi = -55 - ((dist - 300) / 300) * 20;

    rssi += Math.random() * 2 - 1;
    return Math.max(-90, Math.min(-20, rssi));
}

setInterval(() => {
    rssi = Number(calculateRSSIFromDistance().toFixed(1));
    maybeLogRssi(rssi);
    updatePhoneUI();
    updateBluetoothVisualization();
}, 200);

/* ============================================
   BLUETOOTH UI
=============================================== */

function updatePhoneUI() {
    const signalDots = document.getElementById("signalDots");
    const rssiNum = document.getElementById("rssiNum");
    const statusDot = document.getElementById("statusDot");
    const statusText = document.getElementById("statusText");
    const phoneWeight = document.getElementById("phoneWeightDisplay");
    const rssiBar = document.getElementById("rssiBar");
    const rssiValueText = document.getElementById("rssiValue");

    phoneWeight.textContent = totalWeight + "g";
    rssiNum.textContent = rssi + "dBm";
    if (rssiValueText) rssiValueText.textContent = rssi + " dBm";
    updateRssiTrend();

    let signalQuality = "strong";
    if (rssi < -70) signalQuality = "lost";
    else if (rssi < -60) signalQuality = "weak";

    signalDots.classList.remove("weak", "lost");
    if (signalQuality === "weak") signalDots.classList.add("weak");
    if (signalQuality === "lost") signalDots.classList.add("lost");

    rssiBar.innerHTML = "";
    for (let i = 1; i <= 4; i++) {
        const bar = document.createElement("div");
        bar.className = "rssi-bar";

        const threshold = -20 - i * 17.5;
        if (rssi >= threshold) {
            bar.classList.add(signalQuality === "weak" ? "weak" : signalQuality === "lost" ? "critical" : "on");
        } else bar.classList.add("off");

        rssiBar.appendChild(bar);
    }

    if (signalQuality === "lost") {
        statusDot.classList.add("lost");
        statusText.textContent = "Lost";
    } else {
        statusDot.classList.remove("lost");
        statusText.textContent = "Connected";
    }

    if (signalQuality === "lost") {
        alertState.bluetooth = {
            level: "danger",
            message: "Bluetooth link lost. Move closer to the bag."
        };
    } else if (signalQuality === "weak") {
        alertState.bluetooth = {
            level: "warning",
            message: `Signal getting weak (${rssi} dBm)`
        };
    } else {
        alertState.bluetooth = {
            level: "ok",
            message: `Signal strong (${rssi} dBm)`
        };
    }

    const btAlertBox = document.getElementById("btAlert");
    if (btAlertBox) {
        const levelClass = alertState.bluetooth.level === "danger" ? "danger" : alertState.bluetooth.level === "warning" ? "warning" : "success";
        btAlertBox.innerHTML = `<div class='alert ${levelClass}'>${alertState.bluetooth.message}</div>`;
    }

    renderGlobalAlerts();
}

function updateBluetoothVisualization() {
    const waves = document.querySelectorAll(".wave-line");
    const phoneIcon = document.querySelector(".phone-icon");
    const bagIcon = document.querySelector(".bag-icon");
    const wavesContainer = document.getElementById("wavesContainer");
    const btWaves = document.getElementById("btWaves");

    let connection = "strong";
    if (rssi < -70) connection = "lost";
    else if (rssi < -60) connection = "weak";

    waves.forEach(w => {
        w.classList.toggle("lost", connection === "lost");
    });

    if (wavesContainer) wavesContainer.dataset.connection = connection;
    if (btWaves) btWaves.dataset.connection = connection;

    if (connection === "lost") {
        phoneIcon.classList.add("shake", "lost-color");
        bagIcon.classList.add("shake", "lost-color");
        showConnectionLostAlert();
    } else {
        phoneIcon.classList.remove("shake", "lost-color");
        bagIcon.classList.remove("shake", "lost-color");
    }
}

function showConnectionLostAlert() {
    const notif = document.getElementById("connectionNotification");
    if (notif) notif.style.display = rssi < -80 ? "block" : "none";
}

/* ============================================
   🚨 GPS SPOOFING ATTACK BUTTON
=============================================== */

function simulateGpsAttack() {
    // Nouvelle position falsifiée (2 km plus loin)
    const fakeLat = 36.820000;
    const fakeLng = 10.200000;

    // Mise à jour variables globales
    latitude = fakeLat;
    longitude = fakeLng;

    // Affichage dans l’UI
    document.getElementById("gpsLat").innerText = latitude.toFixed(6);
    document.getElementById("gpsLng").innerText = longitude.toFixed(6);

    // Animation du point → mouvement brusque
    animateMiniMapJump(fakeLat, fakeLng);

    // Déclencher alarme visuelle et sonore
    triggerAlert();

    // Log attack dans MongoDB via API
    logToApi("gps", {
        deviceId: DEVICE_ID,
        latitude: fakeLat,
        longitude: fakeLng,
        vitesse: 999, // vitesse impossible → montre sabotage
        distanceFromHome: distanceMeters(homePosition.lat, homePosition.lng, fakeLat, fakeLng),
        zoneAlerte: 1,
        attackType: "gps_spoofing"
    });

    flashGpsAlert();
    updateGpsStatus(distanceMeters(homePosition.lat, homePosition.lng, fakeLat, fakeLng), {
        level: "danger",
        message: "GPS spoofing detected — position jumped away!"
    });
    recordEvent("danger", "GPS spoofing attack simulated");
}

/* ============================================
   💥 Animation du mouvement brusque sur la map
=============================================== */

function animateMiniMapJump(lat, lng) {
    updateMiniMap(lat, lng);

    const dot = document.getElementById("miniMapDot");
    if (!dot) return;

    dot.classList.add("jump-alert");
    setTimeout(() => dot.classList.remove("jump-alert"), 800);
}

/* ============================================
   ⚠️ Effet visuel d’alerte GPS
=============================================== */

function flashGpsAlert() {
    const gpsBox = document.getElementById("gpsSection");

    if (!gpsBox) return;

    gpsBox.classList.add("gps-attack");

    setTimeout(() => gpsBox.classList.remove("gps-attack"), 1500);
}

function updateGpsStatus(distance, override = {}) {
    let level = "ok";
    let message = `Safe zone • ${distance.toFixed(1)} m from home`;

    if (distance > 80) {
        level = "danger";
        message = `Bag moved ${distance.toFixed(1)} m away!`;
    } else if (distance > 50) {
        level = "warning";
        message = `Bag is ${distance.toFixed(1)} m away. Keep an eye on it.`;
    }

    if (override.level) level = override.level;
    if (override.message) message = override.message;

    const alertBox = document.getElementById("gpsAlert");
    if (alertBox) {
        const alertClass = level === "danger" ? "danger" : level === "warning" ? "warning" : level === "ok" ? "success" : "info";
        alertBox.innerHTML = `<div class='alert ${alertClass}'>${message}</div>`;
    }

    const safeZone = document.getElementById("miniMapSafe");
    if (safeZone) {
        safeZone.classList.toggle("warning", level === "warning");
        safeZone.classList.toggle("danger", level === "danger");
        if (level === "ok") {
            safeZone.classList.remove("warning", "danger");
        }
    }

    alertState.gps = { level, message };
    renderGlobalAlerts();
}

function renderGlobalAlerts() {
    const container = document.getElementById("globalAlert");
    if (!container) return;

    const labels = {
        weight: "Weight",
        gps: "GPS",
        bluetooth: "Bluetooth"
    };

    container.innerHTML = Object.keys(labels).map(key => {
        const { level, message } = alertState[key] || { level: "info", message: "No data" };
        const levelAttr = level === "danger" ? "danger" : level === "warning" ? "warning" : level === "ok" ? "ok" : "info";
        return `<div class="alert-card" data-level="${levelAttr}"><strong>${labels[key]}</strong><span>${message}</span></div>`;
    }).join("");

    updateStatusChips();
}
