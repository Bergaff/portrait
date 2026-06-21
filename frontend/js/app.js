const APP_VERSION = "1.0";

// ========== ТЕМА ==========
function toggleTheme() {
    const cur = document.body.getAttribute("data-theme") || "dark";
    const newTheme = cur === "dark" ? "light" : "dark";
    document.body.setAttribute("data-theme", newTheme);
    localStorage.setItem("qp_theme", newTheme);
    if (window.currentTileLayer) map.removeLayer(window.currentTileLayer);
    const tileUrl = newTheme === "light"
        ? "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        : "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
    window.currentTileLayer = L.tileLayer(tileUrl, {
        attribution: "OpenStreetMap, CARTO", maxZoom: 19
    }).addTo(map);
    setTimeout(() => lucide.createIcons(), 50);
}
const savedTheme = localStorage.getItem("qp_theme") || "dark";
document.body.setAttribute("data-theme", savedTheme);

// ========== SUPABASE ==========
const { createClient } = supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { detectSessionInUrl: true, flowType: 'pkce', persistSession: true, autoRefreshToken: true }
});
let currentUser = null;
let userStats = { requests: 0 };

async function initAuth() {
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session) { currentUser = session.user; updateAuthUI(); loadUserStats(); }
        else { updateAuthUILoggedOut(); }
    } catch (e) {
        console.warn("Supabase недоступен:", e);
        updateAuthUILoggedOut();
        if (!localStorage.getItem("qp_supabase_warned")) {
            setTimeout(() => addBotMessage("⚠ Сервис авторизации временно недоступен. Анализ работает без входа."), 1500);
            localStorage.setItem("qp_supabase_warned", "1");
        }
    }
}
supabaseClient.auth.onAuthStateChange((event, session) => {
    if (session && session.user) {
        currentUser = session.user; updateAuthUI();
        document.getElementById("auth-modal").style.display = "none";
        loadUserStats();
    } else { currentUser = null; updateAuthUILoggedOut(); }
});
initAuth();

function updateAuthUI() {
    document.getElementById("auth-btn").style.display = "none";
    document.getElementById("user-info").style.display = "flex";
}
function updateAuthUILoggedOut() {
    document.getElementById("auth-btn").style.display = "inline-flex";
    document.getElementById("user-info").style.display = "none";
}
async function socialLogin(provider) {
    showAuthError("Открываем " + provider + "...");
    const { error } = await supabaseClient.auth.signInWithOAuth({
        provider, options: { redirectTo: window.location.origin }
    });
    if (error) showAuthError(error.message);
}

// ========== YANDEX & MAILRU ==========
const YANDEX_CLIENT_ID = "00a282071c984f6c8015bdbe0852a5b8";
const MAILRU_CLIENT_ID = "019e459104e27d97893914d68e0920e4";

function loginYandexDirect() {
    const r = window.location.origin + "/";
    window.location.href = "https://oauth.yandex.ru/authorize?response_type=token&client_id=" + YANDEX_CLIENT_ID +
        "&redirect_uri=" + encodeURIComponent(r) + "&state=yandex&force_confirm=yes";
}
function loginMailruDirect() {
    const r = window.location.origin + "/";
    window.location.href = "https://oauth.mail.ru/login?client_id=" + MAILRU_CLIENT_ID +
        "&response_type=code&scope=" + encodeURIComponent("userinfo openid email profile") +
        "&redirect_uri=" + encodeURIComponent(r) + "&state=mailru";
}

function processOAuthCallback() {
    const sp = new URLSearchParams(window.location.search);
    const hp = new URLSearchParams(window.location.hash.substring(1));
    const code = sp.get("code");
    const error = sp.get("error");
    if (error) {
        showAuthError("Ошибка: " + error);
        window.history.replaceState({}, document.title, window.location.pathname);
        return;
    }
    if (code && sp.get("state") === "mailru") {
        saveMapPosition();
        window.history.replaceState({}, document.title, window.location.pathname);
        showAuthError("Входим через Mail.ru...");
        fetch("/api/auth/mailru", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ access_token: "code_" + code })
        }).then(r => r.json()).then(d => {
            if (d.email && d.temp_password) {
                return supabaseClient.auth.signInWithPassword({ email: d.email, password: d.temp_password });
            } else showAuthError("Ошибка: " + (d.detail || "unknown"));
        }).then(() => window.location.reload())
        .catch(e => { console.error(e); showAuthError("Ошибка входа"); });
        return;
    }
    const at = hp.get("access_token");
    if (at && hp.get("state") === "yandex") {
        saveMapPosition();
        window.location.hash = "";
        showAuthError("Входим через Яндекс...");
        fetch("/api/auth/yandex", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ access_token: at })
        }).then(r => r.json()).then(d => {
            if (d.email && d.temp_password) {
                return supabaseClient.auth.signInWithPassword({ email: d.email, password: d.temp_password });
            } else showAuthError("Ошибка: " + (d.detail || "unknown"));
        }).then(() => window.location.reload())
        .catch(e => { console.error(e); showAuthError("Ошибка входа"); });
    }
}

function saveMapPosition() {
    if (window.map) {
        const c = map.getCenter();
        const z = map.getZoom();
        localStorage.setItem("qp_map_pos", JSON.stringify({ lat: c.lat, lon: c.lng, zoom: z }));
    }
}
processOAuthCallback();
window.addEventListener("hashchange", processOAuthCallback);

// ========== EMAIL AUTH ==========
async function emailSignIn() {
    const e = document.getElementById("auth-email").value.trim();
    const p = document.getElementById("auth-password").value;
    if (!e || !p) { showAuthError("Заполните поля"); return; }
    const { error } = await supabaseClient.auth.signInWithPassword({ email: e, password: p });
    if (error) showAuthError(translateError(error.message));
}
async function emailSignUp() {
    const e = document.getElementById("auth-email").value.trim();
    const p = document.getElementById("auth-password").value;
    if (!e || !p) { showAuthError("Заполните поля"); return; }
    if (p.length < 6) { showAuthError("Минимум 6 символов"); return; }
    const { error } = await supabaseClient.auth.signUp({ email: e, password: p });
    if (error) showAuthError(translateError(error.message));
    else showAuthError("✓ Проверьте почту");
}
function translateError(m) {
    if (m.includes("rate limit")) return "Подождите час";
    if (m.includes("Invalid login")) return "Неверный email/пароль";
    if (m.includes("already registered")) return "Email занят";
    return m;
}
function confirmSignOut() { document.getElementById("confirm-modal").style.display = "flex"; }
function closeConfirm() { document.getElementById("confirm-modal").style.display = "none"; }
async function doSignOut() { closeConfirm(); await supabaseClient.auth.signOut(); }
function showAuthError(m) { const e = document.getElementById("auth-error"); if (e) e.textContent = m; }
function toggleAuth() {
    const m = document.getElementById("auth-modal");
    m.style.display = m.style.display === "none" ? "flex" : "none";
    showAuthError("");
}

// ========== PROFILE ==========
function loadUserStats() {
    const s = localStorage.getItem("stats_" + currentUser?.id);
    if (s) userStats = JSON.parse(s);
}
function saveStats() { if (currentUser) localStorage.setItem("stats_" + currentUser.id, JSON.stringify(userStats)); }
function trackRequest() { userStats.requests++; saveStats(); }
function openProfile() {
    if (!currentUser) { toggleAuth(); return; }
    const d = new Date(currentUser.created_at).toLocaleDateString("ru-RU");
    const p = currentUser.app_metadata?.provider || "email";

    const container = document.getElementById("profile-content");
    container.innerHTML = "";

    const info = document.createElement("div");
    info.innerHTML =
        '<div class="profile-row"><span class="profile-label">Email</span><span>' + (currentUser.email || "—") + '</span></div>' +
        '<div class="profile-row"><span class="profile-label">Способ входа</span><span style="text-transform:capitalize">' + p + '</span></div>' +
        '<div class="profile-row"><span class="profile-label">Регистрация</span><span>' + d + '</span></div>' +
        '<div class="profile-row"><span class="profile-label">Запросов</span><span>' + userStats.requests + '</span></div>';
    container.appendChild(info);

    const history = JSON.parse(localStorage.getItem(getHistoryKey()) || "[]");

    const histHeader = document.createElement("div");
    histHeader.style.cssText = "margin-top:16px;display:flex;justify-content:space-between;align-items:center;margin-bottom:8px";
    histHeader.innerHTML = '<span class="profile-label" style="font-weight:600">История анализов (' + history.length + ')</span>';

    if (history.length > 0) {
        const clearBtn = document.createElement("button");
        clearBtn.className = "btn-ghost";
        clearBtn.style.cssText = "font-size:11px;padding:3px 8px";
        clearBtn.textContent = "Очистить всё";
        clearBtn.onclick = clearHistory;
        histHeader.appendChild(clearBtn);
    }
    container.appendChild(histHeader);

    if (history.length === 0) {
        const empty = document.createElement("div");
        empty.className = "history-empty";
        empty.textContent = "Пока нет сохранённых анализов";
        container.appendChild(empty);
    } else {
        const list = document.createElement("div");
        list.className = "history-list";

        history.forEach((item, idx) => {
            const dt = new Date(item.date);
            const dtStr = dt.toLocaleDateString("ru-RU") + " " + dt.toLocaleTimeString("ru-RU", {hour:'2-digit', minute:'2-digit'});
            const modeIcon = item.mode === "free" ? "⚡" : item.mode === "pro+ai" ? "🤖" : "💎";
            const shapeIcon = (item.shape && item.shape.type === "polygon") ? "⬡" : "▢";

            const histItem = document.createElement("div");
            histItem.className = "history-item";

            const itemContent = document.createElement("div");
            itemContent.className = "history-item-content";
            itemContent.style.cssText = "flex:1;cursor:pointer;min-width:0";
            itemContent.innerHTML =
                '<div class="history-item-title">' + modeIcon + ' ' + shapeIcon + ' Индекс: ' + (item.score || "?") + '/100, мест: ' + (item.places || 0) + '</div>' +
                '<div class="history-item-meta"><span>' + dtStr + '</span><span>' + (item.mode || "free") + '</span></div>';
            itemContent.onclick = function() { loadFromHistory(idx); };

            const delBtn = document.createElement("button");
            delBtn.className = "history-item-del";
            delBtn.title = "Удалить запись";
            delBtn.innerHTML = "×";
            delBtn.onclick = function(e) { deleteHistoryItem(idx, e); };

            histItem.appendChild(itemContent);
            histItem.appendChild(delBtn);
            list.appendChild(histItem);
        });

        container.appendChild(list);
    }

    document.getElementById("profile-modal").style.display = "flex";
}
function closeProfile() { document.getElementById("profile-modal").style.display = "none"; }

// ========== ИСТОРИЯ ЗАПРОСОВ ==========
function getHistoryKey() {
    return currentUser ? "qp_history_" + currentUser.id : "qp_history_guest";
}

function saveToHistory(mode, placesCount, score) {
    if (!state.bbox) return;
    const key = getHistoryKey();
    let history = [];
    try {
        history = JSON.parse(localStorage.getItem(key) || "[]");
    } catch (e) {}

    const center = state.drawnLayer ? state.drawnLayer.getBounds().getCenter() : null;

    let shapeData = null;
    if (state.drawnLayer) {
        try {
            const isRectangle = state.drawnLayer instanceof L.Rectangle;
            const latlngs = state.drawnLayer.getLatLngs();
            const points = (latlngs[0] || latlngs).map(p => ({ lat: p.lat, lng: p.lng }));
            shapeData = {
                type: isRectangle ? "rectangle" : "polygon",
                points: points
            };
        } catch (e) {
            console.warn("Cant save shape", e);
        }
    }

    history.unshift({
        bbox: state.bbox,
        center: center ? [center.lat, center.lng] : null,
        shape: shapeData,
        mode: mode,
        places: placesCount,
        score: score,
        scores: state.scores,
        organizations: state.organizations.slice(0, 100),
        scrapedData: state.scrapedData.slice(0, 100),
        orgText: state.orgText.substring(0, 5000),
        categories: state.categories,
        date: new Date().toISOString()
    });

    history = history.slice(0, 20);
    localStorage.setItem(key, JSON.stringify(history));
}

function loadFromHistory(idx) {
    const key = getHistoryKey();
    const history = JSON.parse(localStorage.getItem(key) || "[]");
    if (!history[idx]) return;
    const h = history[idx];

    state.bbox = h.bbox;
    state.scores = h.scores || {};
    state.organizations = h.organizations || [];
    state.scrapedData = h.scrapedData || [];
    state.orgText = h.orgText || "";
    state.categories = h.categories || {};
    state.reportCache = null;

    drawnItems.clearLayers();
    let shape = null;

    if (h.shape && h.shape.points && h.shape.points.length >= 2) {
        const latlngs = h.shape.points.map(p => [p.lat, p.lng]);
        const style = { color: "#7c5cff", fillOpacity: 0.15, weight: 2 };

        if (h.shape.type === "polygon") {
            shape = L.polygon(latlngs, style);
        } else {
            const bounds = L.latLngBounds(latlngs);
            shape = L.rectangle(bounds, style);
        }
    } else if (h.bbox) {
        const parts = h.bbox.split(",").map(parseFloat);
        shape = L.rectangle([[parts[0], parts[1]], [parts[2], parts[3]]], {
            color: "#7c5cff", fillOpacity: 0.15, weight: 2
        });
    }

    if (shape) {
        drawnItems.addLayer(shape);
        state.drawnLayer = shape;
        map.fitBounds(shape.getBounds());
    }

    if (state.heatLayer) { map.removeLayer(state.heatLayer); }
    if (state.markersLayer) { map.removeLayer(state.markersLayer); }
    if (state.scrapedMarkersLayer) { map.removeLayer(state.scrapedMarkersLayer); }

    if (state.organizations.length > 0) {
        state.heatLayer = L.heatLayer(
            state.organizations.filter(o => o.lat && o.lon).map(o => [o.lat, o.lon, 1]),
            { radius: 22, blur: 18, gradient: { 0.2: "#7c5cff", 0.5: "#a472ff", 0.7: "#d68aff", 1: "#ff8eb8" } }
        ).addTo(map);
    }
    if (h.mode && h.mode.startsWith("pro")) renderApifyMarkers();
    else renderFilteredMarkers();

    showScores(state.scores);
    document.getElementById("actions-panel").style.display = "flex";
    document.getElementById("report-btn").style.display = "inline-flex";
    document.getElementById("quick-questions").style.display = "flex";

    closeProfile();
    addBotMessage("📂 Загружено из истории: " + new Date(h.date).toLocaleString("ru-RU"));
}

function clearHistory() {
    if (!confirm("Удалить всю историю?")) return;
    localStorage.removeItem(getHistoryKey());
    openProfile();
}

function deleteHistoryItem(idx, event) {
    if (event) event.stopPropagation();
    const key = getHistoryKey();
    let history = JSON.parse(localStorage.getItem(key) || "[]");
    if (!history[idx]) return;
    history.splice(idx, 1);
    localStorage.setItem(key, JSON.stringify(history));
    openProfile();
}

// ========== STATE ==========
let state = {
    bbox: null, organizations: [], scores: {}, categories: {}, orgText: "",
    chatHistory: [], heatLayer: null, markersLayer: null, scrapedMarkersLayer: null,
    pieChart: null, barChart: null, radarChart: null,
    activeFilter: null, reportCache: null, chatBusy: false,
    scrapedData: [], scrapeRunId: null, scrapeEnriched: false, drawnLayer: null
};
let scrapingPollInterval = null;

// ========== RESIZER ==========
let isResizing = false;
const resizer = document.getElementById("resizer");
const sidebar = document.getElementById("sidebar");
if (resizer && sidebar) {
    resizer.addEventListener("mousedown", e => {
        isResizing = true;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        e.preventDefault();
        resizer.classList.add("active");
    });
    document.addEventListener("mousemove", e => {
        if (!isResizing) return;
        const w = document.getElementById("app").offsetWidth;
        let nw = w - e.clientX;
        nw = Math.max(360, Math.min(760, nw));
        sidebar.style.width = nw + "px";
        if (window.map && window.map.invalidateSize) window.map.invalidateSize();
    });
    document.addEventListener("mouseup", () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
            resizer.classList.remove("active");
            if (window.map && window.map.invalidateSize) window.map.invalidateSize();
        }
    });
}

// ========== MAP ==========
const map = L.map("map").setView([55.7558, 37.6173], 13);
const initTheme = document.body.getAttribute("data-theme") || "dark";
const initTileUrl = initTheme === "light"
    ? "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
window.currentTileLayer = L.tileLayer(initTileUrl, {
    attribution: "OpenStreetMap, CARTO", maxZoom: 19
}).addTo(map);
window.map = map;
const savedPos = localStorage.getItem("qp_map_pos");
if (savedPos) {
    try {
        const p = JSON.parse(savedPos);
        map.setView([p.lat, p.lon], p.zoom);
        localStorage.removeItem("qp_map_pos");
    } catch (e) {}
}

L.drawLocal.draw.toolbar.buttons.polygon = "Выбрать область многоугольником";
L.drawLocal.draw.toolbar.buttons.rectangle = "Выбрать область прямоугольником";
L.drawLocal.draw.handlers.polygon.tooltip.start = "Кликайте, чтобы рисовать многоугольник";
L.drawLocal.draw.handlers.polygon.tooltip.cont = "Кликайте, чтобы продолжить рисование";
L.drawLocal.draw.handlers.polygon.tooltip.end = "Кликните первую точку, чтобы завершить";
L.drawLocal.draw.handlers.rectangle.tooltip.start = "Кликните дважды: первая и вторая точка";
L.drawLocal.edit.toolbar.buttons.edit = "Редактировать область";
L.drawLocal.edit.toolbar.buttons.editDisabled = "Нет областей для редактирования";
L.drawLocal.edit.toolbar.buttons.remove = "Удалить область";
L.drawLocal.edit.toolbar.buttons.removeDisabled = "Нет областей для удаления";
L.drawLocal.draw.toolbar.actions.title = "Отменить рисование";
L.drawLocal.draw.toolbar.actions.text = "Отмена";
L.drawLocal.draw.toolbar.finish.title = "Завершить рисование";
L.drawLocal.draw.toolbar.finish.text = "Готово";
L.drawLocal.draw.toolbar.undo.title = "Удалить последнюю точку";
L.drawLocal.draw.toolbar.undo.text = "Удалить последнюю точку";
const drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);
const drawControl = new L.Control.Draw({
    draw: {
        polyline: false, circle: false, circlemarker: false, marker: false,
        polygon: { shapeOptions: { color: "#7c5cff", fillOpacity: 0.15, weight: 2 } },
        rectangle: { shapeOptions: { color: "#7c5cff", fillOpacity: 0.15, weight: 2 } }
    },
    edit: { featureGroup: drawnItems }
});
map.addControl(drawControl);
map.on("draw:created", e => {
    drawnItems.clearLayers();
    drawnItems.addLayer(e.layer);
    state.drawnLayer = e.layer;
    const b = e.layer.getBounds();
    state.bbox = b.getSouth() + "," + b.getWest() + "," + b.getNorth() + "," + b.getEast();
    document.getElementById("actions-panel").style.display = "flex";
    state.reportCache = null;
});

// ========== ДОРАБОТКА РИСОВАНИЯ ПОЛИГОНА И ПРЯМОУГОЛЬНИКА ==========
const MAX_POINTS = 10;
let drawToolbar = null;
let currentHandler = null;
let currentMode = "";
let pointCount = 0;

function getMaxPoints() {
    return currentMode === "rectangle" ? 2 : MAX_POINTS;
}
function getMinFinishPoints() {
    return currentMode === "rectangle" ? 2 : 3;
}

function updateUI() {
  if (!drawToolbar) return;
  const counter = document.getElementById("point-counter");
  if (counter) counter.textContent = pointCount + "/" + getMaxPoints();

  const btnFinish = document.getElementById("btn-finish-polygon");
  const btnCancel = document.getElementById("btn-cancel-polygon");
  const btnUndo = document.getElementById("btn-undo-polygon");

  if (btnFinish) {
    if (pointCount >= getMinFinishPoints()) {
      btnFinish.style.opacity = "1";
      btnFinish.style.pointerEvents = "auto";
    } else {
      btnFinish.style.opacity = "0.4";
      btnFinish.style.pointerEvents = "none";
    }
  }

  if (btnCancel) {
    btnCancel.style.opacity = "1";
    btnCancel.style.pointerEvents = "auto";
  }

  if (btnUndo) {
      btnUndo.style.display = currentMode === "rectangle" ? "none" : "flex";
  }
}

function createToolbar() {
    if (drawToolbar) {
        drawToolbar.style.display = "flex";
        if (typeof lucide !== "undefined") lucide.createIcons();
        updateUI();
        return drawToolbar;
    }

    drawToolbar = document.createElement("div");
    drawToolbar.id = "custom-draw-toolbar";
    drawToolbar.style.cssText = "position:absolute;bottom:32px;left:50%;transform:translateX(-50%);z-index:99999;display:flex;gap:8px;padding:10px 14px;background:var(--card,#222);border:1px solid var(--border,#444);border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,0.4);pointer-events:auto;";

    const baseBtn = "padding:8px 16px;border-radius:8px;border:1px solid var(--border,#444);background:var(--secondary,#333);color:var(--foreground,#fff);font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:6px;font-family:inherit;transition:all 0.15s;";

    const btnCancel = document.createElement("button");
    btnCancel.style.cssText = baseBtn;
    btnCancel.innerHTML = "✕ Отмена";
    btnCancel.onmouseenter = function() { this.style.background = "var(--accent)"; };
    btnCancel.onmouseleave = function() { this.style.background = "var(--secondary)"; };
    btnCancel.onclick = function(e) {
        e.stopPropagation();
        if (currentHandler && currentHandler.disable) currentHandler.disable();
    };

    const btnUndo = document.createElement("button");
    btnUndo.id = "btn-undo-polygon";
    btnUndo.style.cssText = baseBtn;
    btnUndo.innerHTML = "↶ Удалить точку";
    btnUndo.onmouseenter = function() { this.style.background = "var(--accent)"; };
    btnUndo.onmouseleave = function() { this.style.background = "var(--secondary)"; };
    btnUndo.onclick = function(e) {
        e.stopPropagation();
        if (currentHandler && currentMode === "polygon" && typeof currentHandler.deleteLastVertex === "function") {
            currentHandler.deleteLastVertex();
            pointCount = Math.max(0, pointCount - 1);
            updateUI();
        }
    };

    const btnFinish = document.createElement("button");
    btnFinish.id = "btn-finish-polygon";
    btnFinish.style.cssText = "padding:8px 16px;border-radius:8px;border:none;background:var(--primary);color:white;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:6px;font-family:inherit;transition:opacity 0.15s;opacity:0.4;pointer-events:none;";
    btnFinish.innerHTML = "✓ Готово <span id='point-counter' style='opacity:0.7;font-size:11px;margin-left:4px'>0/" + getMaxPoints() + "</span>";
    btnFinish.onmouseenter = function() { if (pointCount >= getMinFinishPoints()) this.style.opacity = "0.9"; };
    btnFinish.onmouseleave = function() { this.style.opacity = pointCount >= getMinFinishPoints() ? "1" : "0.4"; };
    btnFinish.onclick = function(e) {
        e.stopPropagation();
        if (!currentHandler || pointCount < getMinFinishPoints()) return;
        if (currentMode === "rectangle") {
            if (typeof currentHandler._fireCreatedEvent === "function") currentHandler._fireCreatedEvent();
            currentHandler.disable();
        } else if (typeof currentHandler.completeShape === "function") {
            currentHandler.completeShape();
        }
    };

    drawToolbar.appendChild(btnCancel);
    drawToolbar.appendChild(btnUndo);
    drawToolbar.appendChild(btnFinish);

    const mapSection = document.getElementById("map-section");
    (mapSection || document.body).appendChild(drawToolbar);

    drawToolbar.style.display = "flex";
    if (typeof lucide !== "undefined") lucide.createIcons();
    return drawToolbar;
}

function hideToolbar() {
    if (drawToolbar) drawToolbar.style.display = "none";
}

function clearAnalysisUI() {
    if (state.heatLayer) { map.removeLayer(state.heatLayer); state.heatLayer = null; }
    if (state.markersLayer) { map.removeLayer(state.markersLayer); state.markersLayer = null; }
    if (state.scrapedMarkersLayer) { map.removeLayer(state.scrapedMarkersLayer); state.scrapedMarkersLayer = null; }
    state.organizations = [];
    state.scores = {};
    state.categories = {};
    state.orgText = "";
    state.scrapedData = [];
    state.scrapeRunId = null;
    state.scrapeEnriched = false;
    state.reportCache = null;
    state.activeFilter = null;
    document.getElementById("actions-panel").style.display = "none";
    document.getElementById("report-btn").style.display = "none";
    document.getElementById("quick-questions").style.display = "none";
    const sp = document.getElementById("scores-panel");
    if (sp) { sp.style.display = "none"; sp.innerHTML = ""; }
}

// ПАТЧ: прямоугольник по двум кликам (без удержания мыши)
function patchRectangleTool() {
    if (!L.Draw || !L.Draw.Rectangle || L.Draw.Rectangle.prototype._qpPatched) return;
    const RP = L.Draw.Rectangle.prototype;
    RP._qpPatched = true;

    const origAdd = RP.addHooks;
    const origRemove = RP.removeHooks;

    RP.addHooks = function() {
        origAdd.call(this);
        if (!this._map) return;
        this._qpStartLatLng = null;
        this._qpClickHandler = this._qpClickHandler || this._onQPClick.bind(this);
        this._qpMoveHandler = this._qpMoveHandler || this._onQPMove.bind(this);
        if (this._map.dragging) this._map.dragging.disable();
        if (this._map.doubleClickZoom) this._map.doubleClickZoom.disable();
        this._map.on("click", this._qpClickHandler, this);
        this._map.on("mousemove", this._qpMoveHandler, this);
        this._map.getContainer().style.cursor = "crosshair";
    };

    RP.removeHooks = function() {
        origRemove.call(this);
        if (!this._map) return;
        this._map.off("click", this._qpClickHandler, this);
        this._map.off("mousemove", this._qpMoveHandler, this);
        if (this._map.dragging) this._map.dragging.enable();
        if (this._map.doubleClickZoom) this._map.doubleClickZoom.enable();
        this._map.getContainer().style.cursor = "";
        this._qpStartLatLng = null;
    };

    RP._onQPClick = function(e) {
        if (e.originalEvent && e.originalEvent.button !== 0) return;
        if (!this._qpStartLatLng) {
            this._qpStartLatLng = e.latlng;
            currentMode = "rectangle";
            currentHandler = this;
            pointCount = 1;
            createToolbar();
            updateUI();
            if (typeof this._drawShape === "function") this._drawShape(e.latlng);
            return;
        }
        pointCount = 2;
        updateUI();
        if (typeof this._drawShape === "function") this._drawShape(e.latlng);
    };

    RP._onQPMove = function(e) {
        if (!this._qpStartLatLng) return;
        if (typeof this._drawShape === "function") this._drawShape(e.latlng);
    };
}
patchRectangleTool();

map.on(L.Draw.Event.DRAWSTART, function(e) {
    if (e.layerType !== "polygon" && e.layerType !== "rectangle") return;
    currentHandler = e.handler;
    currentMode = e.layerType;
    pointCount = 0;
    createToolbar();
    updateUI();
    setTimeout(function() {
        document.querySelectorAll(".leaflet-draw-actions, .leaflet-draw-edit").forEach(function(el) {
            el.style.display = "none";
        });
    }, 50);
});

map.on(L.Draw.Event.DRAWVERTEX, function(e) {
    if (!currentHandler || currentMode !== "polygon") return;
    if (e.layers && typeof e.layers.getLayers === "function") {
        pointCount = e.layers.getLayers().length;
    } else if (currentHandler._markers) {
        pointCount = currentHandler._markers.length;
    } else {
        pointCount = Math.max(0, pointCount + 1);
    }
    updateUI();
    if (pointCount >= MAX_POINTS && typeof currentHandler.completeShape === "function") {
        setTimeout(function() {
            if (currentHandler && typeof currentHandler.completeShape === "function") {
                currentHandler.completeShape();
            }
        }, 50);
    }
});

map.on(L.Draw.Event.DRAWSTOP, function() {
    hideToolbar();
    currentHandler = null;
    currentMode = "";
    pointCount = 0;
    setTimeout(function() {
        document.querySelectorAll(".leaflet-draw-actions").forEach(function(el) {
            el.style.display = "none";
        });
    }, 10);
});

map.on("draw:deleted", function(e) {
  drawnItems.clearLayers();
  state.bbox = null;
  state.drawnLayer = null;

  if (drawControl && drawControl._toolbars && drawControl._toolbars.edit && drawControl._toolbars.edit._modes && drawControl._toolbars.edit._modes.remove) {
     try {
       drawControl._toolbars.edit._modes.remove.handler.removeAllLayers();
     } catch(err) { console.log(err); }
  }

  document.getElementById("actions-panel").style.display = "none";
  addBotMessage("Область удалена. Теперь можно выбрать новую.");
});

map.on("draw:edited", function(e) {
    const layers = e.layers && e.layers.getLayers ? e.layers.getLayers() : [];
    if (!layers.length) return;
    const layer = layers[0];
    state.drawnLayer = layer;
    const b = layer.getBounds();
    state.bbox = b.getSouth() + "," + b.getWest() + "," + b.getNorth() + "," + b.getEast();
    document.getElementById("actions-panel").style.display = "flex";
    state.reportCache = null;
});

setInterval(function() {
    document.querySelectorAll(".leaflet-draw-actions").forEach(function(el) {
        el.style.display = "none";
    });
}, 200);

console.log("✅ Полигон/прямоугольник: тулбар, лимит точек и click-click прямоугольник готовы");

// ========== CITY ==========
let detectedCity = "", detectedLat = 55.7558, detectedLon = 37.6173;
let cityInitTimeout = null;

function initCity() {
    const saved = localStorage.getItem("qp_city");
    if (saved) {
        const d = JSON.parse(saved);
        map.setView([d.lat, d.lon], 13);
        document.getElementById("city-modal").style.display = "none";
        addBotMessage("Привет! Я AI-урбанист

Город: " + d.name + "

Выберите интересующую вас область с помощью:
⬡ многоугольника или ▢ прямоугольника с левой стороны карты
→ далее нажмите «Анализ»

Вы можете изменить точки области или удалить неудачную через меню редактирования.");
        return;
    }
    document.getElementById("city-modal").style.display = "flex";
    cityInitTimeout = setTimeout(() => { if (!detectedCity) showCityInput(); }, 12000);
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            async pos => {
                try {
                    const r = await fetch("https://nominatim.openstreetmap.org/reverse?lat=" + pos.coords.latitude + "&lon=" + pos.coords.longitude + "&format=json&accept-language=ru");
                    const d = await r.json();
                    const c = d.address?.city || d.address?.town || d.address?.village || "Ваш город";
                    clearTimeout(cityInitTimeout);
                    showCityConfirm(c, pos.coords.latitude, pos.coords.longitude);
                } catch (e) { clearTimeout(cityInitTimeout); detectByIP(); }
            },
            () => { clearTimeout(cityInitTimeout); detectByIP(); },
            { timeout: 8000 }
        );
    } else detectByIP();
}
async function detectByIP() {
    try {
        const r = await fetch("https://ipapi.co/json/");
        if (r.ok) {
            const d = await r.json();
            if (d.city && d.latitude) { clearTimeout(cityInitTimeout); showCityConfirm(d.city, d.latitude, d.longitude); return; }
        }
    } catch (e) {}
    clearTimeout(cityInitTimeout);
    showCityInput();
}
function showCityConfirm(c, lat, lon) {
    detectedCity = c; detectedLat = lat; detectedLon = lon;
    document.getElementById("city-detecting").style.display = "none";
    document.getElementById("city-name-show").textContent = c;
    document.getElementById("city-confirm").style.display = "block";
}
function showCityInput() {
    clearTimeout(cityInitTimeout);
    document.getElementById("city-detecting").style.display = "none";
    document.getElementById("city-confirm").style.display = "none";
    document.getElementById("city-input-block").style.display = "block";
}
window.confirmCity = function() {
  clearTimeout(cityInitTimeout);
  localStorage.setItem("qp_city", JSON.stringify({ name: detectedCity, lat: detectedLat, lon: detectedLon }));
  map.setView([detectedLat, detectedLon], 13);
  
  const modal = document.getElementById("city-modal");
  if (modal) {
    modal.style.display = "none";
  }
  
  const msg = 
    "Привет! Я AI-урбанист

" +
    "Город: " + detectedCity + "

" +
    "Выберите интересующую вас область с помощью:
" +
    "⬡ многоугольника или ▢ прямоугольника с левой стороны карты
" +
    "→ далее нажмите Анализ

" +
    "Вы можете изменить точки области или удалить неудачную через меню редактирования.";
  
  addBotMessage(msg);
};

window.skipCity = function() {
  clearTimeout(cityInitTimeout);
  
  localStorage.setItem("qp_city", JSON.stringify({ name: "Москва", lat: 55.7558, lon: 37.6173 }));
  map.setView([55.7558, 37.6173], 13);
  
  const modal = document.getElementById("city-modal");
  if (modal) {
    modal.style.display = "none";
  }
  
  const msg = 
    "Привет! Я AI-урбанист

" +
    "Город: Москва

" +
    "Выберите интересующую вас область с помощью:
" +
    "⬡ многоугольника или ▢ прямоугольника с левой стороны карты
" +
    "→ далее нажмите Анализ

" +
    "Вы можете изменить точки области или удалить неудачную через меню редактирования.";
  
  addBotMessage(msg);
};

window.showCityInput = window.showCityInput || function() {
  clearTimeout(cityInitTimeout);
  document.getElementById("city-detecting").style.display = "none";
  document.getElementById("city-confirm").style.display = "none";
  document.getElementById("city-input-block").style.display = "block";
};

window.searchAndGoCity = window.searchAndGoCity || async function() {
  const q = document.getElementById("city-input").value.trim();
  if (!q) return;
  try {
    const r = await fetch("/api/search?q=" + encodeURIComponent(q));
    const d = await r.json();
    if (d.results?.length > 0) {
      detectedLat = d.results[0].lat;
      detectedLon = d.results[0].lon;
      detectedCity = d.results[0].display_name.split(",")[0];
    }
  } catch (e) {}
  window.confirmCity();
};

// ========== SEARCH ==========
let searchTimeout;
document.getElementById("search-input").addEventListener("input", e => {
    clearTimeout(searchTimeout);
    const q = e.target.value.trim();
    if (q.length < 2) { document.getElementById("search-results").innerHTML = ""; return; }
    searchTimeout = setTimeout(async () => {
        try {
            const r = await fetch("/api/search?q=" + encodeURIComponent(q));
            const d = await r.json();
            const c = document.getElementById("search-results");
            c.innerHTML = "";
            if (!d.results?.length) { c.innerHTML = '<div class="search-item">Не найдено</div>'; return; }
            d.results.forEach(item => {
                const div = document.createElement("div");
                div.className = "search-item";
                div.textContent = item.display_name.substring(0, 70);
                div.onclick = () => {
                    map.setView([item.lat, item.lon], 16);
                    c.innerHTML = "";
                    document.getElementById("search-input").value = item.display_name.substring(0, 50);
                };
                c.appendChild(div);
            });
        } catch (e) {}
    }, 400);
});

function processApifyResults(items, fromCache) {
    const filtered = items.filter(o => o.lat && o.lon && isInsideDrawn(o.lat, o.lon));
    if (filtered.length === 0) {
        addBotMessage("⚠ В выделенной области ничего не найдено");
        return;
    }

    state.organizations = filtered.map(x => ({
        name: x.name,
        amenity: mapApifyCategory(x.category),
        category_raw: x.category,
        rating: x.rating,
        reviews_count: x.reviews_count,
        lat: x.lat,
        lon: x.lon
    }));
    state.scrapedData = filtered;
    state.scores = calculateApifyScores(filtered);
    state.categories = countApifyCategories(filtered);
    state.orgText = filtered.slice(0, 30).map(x =>
        "- " + x.name + " [" + (x.category || "?") + "] ★" + (x.rating || "?")
    ).join("
");
    state.activeFilter = null;

    state.heatLayer = L.heatLayer(filtered.map(o => [o.lat, o.lon, 1]), {
        radius: 22, blur: 18,
        gradient: { 0.2: "#7c5cff", 0.5: "#a472ff", 0.7: "#d68aff", 1: "#ff8eb8" }
    }).addTo(map);

    renderApifyMarkers();
    showScores(state.scores);

    const topPlaces = filtered
        .filter(x => x.rating >= 4.5 && x.reviews_count >= 10)
        .sort((a, b) => (b.reviews_count || 0) - (a.reviews_count || 0))
        .slice(0, 3);

    let msg = (fromCache ? "⚡ " : "✓ ") + "Готово! Яндекс.Карты
Индекс: " + state.scores.overall + "/100
Заведений: " + filtered.length;
    if (state.scores.avg_rating) msg += "
Средний рейтинг: ★" + state.scores.avg_rating;
    if (topPlaces.length > 0) {
        msg += "

⭐ Топ:";
        topPlaces.forEach(p => { msg += "
• " + p.name + " (★" + p.rating + ")"; });
    }
    addBotMessage(msg);

    document.getElementById("report-btn").style.display = "inline-flex";
    const scrapeBtn = document.getElementById("scrape-btn");
    if (scrapeBtn) scrapeBtn.style.display = "inline-flex";
    document.getElementById("quick-questions").style.display = "flex";
}

function renderApifyMarkers() {
    if (state.markersLayer) map.removeLayer(state.markersLayer);
    state.markersLayer = L.layerGroup();
    state.organizations.forEach(o => {
        if (!isInsideDrawn(o.lat, o.lon)) return;
        if (state.activeFilter && state.activeFilter !== "Разнообразие") {
            if (!(CAT_MAP[state.activeFilter] || []).includes(o.amenity)) return;
        }
        let color = "#888";
        if (o.rating >= 4.5) color = "#1dd1a1";
        else if (o.rating >= 4.0) color = "#7bd389";
        else if (o.rating >= 3.5) color = "#feca57";
        else if (o.rating > 0) color = "#ff6b6b";
        const radius = Math.min(11, 4 + Math.log10((o.reviews_count || 1) + 1) * 3);
        let tt = "<b>" + o.name + "</b>";
        if (o.rating) tt += "<br>★ " + o.rating + " (" + (o.reviews_count || 0) + " отз.)";
        if (o.category_raw) tt += "<br><i>" + o.category_raw + "</i>";
        L.circleMarker([o.lat, o.lon], {
            radius: radius, color: "#fff", weight: 1.5,
            fillColor: color, fillOpacity: 0.85
        }).bindTooltip(tt, { direction: "top" }).addTo(state.markersLayer);
    });
    state.markersLayer.addTo(map);
}

function mapApifyCategory(yandexCat) {
    const c = (yandexCat || "").toLowerCase();
    if (c.includes("ресторан") || c.includes("кафе") || c.includes("бар") || c.includes("кофейн")) return "cafe";
    if (c.includes("аптек")) return "pharmacy";
    if (c.includes("клиник") || c.includes("больниц")) return "clinic";
    if (c.includes("стомат")) return "dentist";
    if (c.includes("супермаркет") || c.includes("продукт")) return "supermarket";
    if (c.includes("магаз") || c.includes("одежд")) return "clothes";
    if (c.includes("салон") || c.includes("парикмахер")) return "beauty";
    if (c.includes("фитнес") || c.includes("спортзал")) return "gym";
    if (c.includes("школ")) return "school";
    if (c.includes("банк")) return "bank";
    if (c.includes("автосерв") || c.includes("автомойк")) return "car_repair";
    if (c.includes("кино") || c.includes("театр")) return "cinema";
    if (c.includes("админист") || c.includes("мфц") || c.includes("полиц")) return "townhall";
    return "другое";
}

function countApifyCategories(items) {
    const result = {};
    items.forEach(x => {
        const a = mapApifyCategory(x.category);
        for (const [catName, list] of Object.entries(CAT_MAP)) {
            if (list.includes(a)) {
                result[catName] = (result[catName] || 0) + 1;
                break;
            }
        }
    });
    return result;
}

function calculateApifyScores(items) {
    const parts = state.bbox.split(",").map(parseFloat);
    const area = Math.max((parts[2]-parts[0])*111*(parts[3]-parts[1])*111*0.6, 0.01);
    const total = Math.max(items.length, 1);
    const cats = countApifyCategories(items);
    const ratings = items.filter(x => x.rating > 0).map(x => x.rating);
    const avgRating = ratings.length ? Math.round(ratings.reduce((a,b)=>a+b,0)/ratings.length * 10) / 10 : 0;

    const food = Math.min(100, Math.round((cats["Еда"]||0)/total*280));
    const health = Math.min(100, Math.round((cats["Здоровье"]||0)/area/5*100));
    const sport = Math.min(100, Math.round((cats["Спорт"]||0)/area/3*100));
    const edu = Math.min(100, Math.round((cats["Образование"]||0)/area/2*100));
    const shop = Math.min(100, Math.round((cats["Шопинг"]||0)/total*220));
    const fun = Math.min(100, Math.round((cats["Досуг"]||0)/area/3*100));
    const density = Math.min(100, Math.round(total/area/150*100));
    const div = Math.min(100, Math.round(Object.keys(cats).length/10*100));
    const ratingBonus = avgRating > 3 ? Math.round((avgRating - 3) * 5) : 0;
    const overall = Math.min(100, Math.round(density*0.15+food*0.15+health*0.15+sport*0.1+edu*0.1+shop*0.15+div*0.15+ratingBonus));

    return {
        overall, density, food, health, sport, education: edu,
        shopping: shop, entertainment: fun, diversity: div,
        area_km2: Math.round(area*1000)/1000,
        total_places: items.length,
        avg_rating: avgRating,
        poi_density: Math.round(items.length / area * 10) / 10
    };
}

// ========== FILTERS ==========
const CAT_MAP = {
    "Еда": ["cafe", "restaurant", "fast_food", "bar", "pub", "ice_cream"],
    "Здоровье": ["pharmacy", "clinic", "dentist", "hospital", "doctors", "veterinary", "optician"],
    "Шопинг": ["clothes", "supermarket", "convenience", "electronics", "mobile_phone", "shoes", "books", "gift", "florist", "jewelry", "kiosk"],
    "Красота": ["beauty", "hairdresser", "massage", "nail_salon"],
    "Спорт": ["gym", "fitness_centre", "sports_centre", "swimming_pool", "yoga"],
    "Образование": ["school", "kindergarten", "university", "library", "language_school"],
    "Досуг": ["cinema", "theatre", "museum", "playground", "nightclub", "park"],
    "Авто": ["car_repair", "car_wash", "fuel", "parking"],
    "Финансы": ["bank", "atm"],
    "Услуги": ["laundry", "dry_cleaning", "tailor", "post_office"]
};
const CAT_COLORS = {
    "Еда": "#feca57", "Здоровье": "#ff6b6b", "Шопинг": "#48dbfb",
    "Красота": "#f093fb", "Спорт": "#1dd1a1", "Образование": "#54a0ff",
    "Досуг": "#a29bfe", "Авто": "#fd9644", "Финансы": "#20bf6b",
    "Услуги": "#778ca3", "Разнообразие": "#7c5cff"
};
function toggleFilter(c) {
    state.activeFilter = state.activeFilter === c ? null : c;
    renderFilteredMarkers();
    showScores(state.scores);
}
function renderFilteredMarkers() {
    if (state.markersLayer) map.removeLayer(state.markersLayer);
    state.markersLayer = L.layerGroup();
    state.organizations.forEach(o => {
        if (!isInsideDrawn(o.lat, o.lon)) return;
        if (state.activeFilter && state.activeFilter !== "Разнообразие") {
            if (!(CAT_MAP[state.activeFilter] || []).includes(o.amenity)) return;
        }
        const color = state.activeFilter ? (CAT_COLORS[state.activeFilter] || "#7c5cff") : "#7c5cff";
        L.circleMarker([o.lat, o.lon], { radius: 5, color, fillColor: color, fillOpacity: 0.85, weight: 1 })
            .bindTooltip(o.name + " (" + o.amenity + ")").addTo(state.markersLayer);
    });
    state.markersLayer.addTo(map);
}

function isInsideDrawn(lat, lon) {
    if (!state.drawnLayer) return true;
    const pt = L.latLng(lat, lon);
    if (state.drawnLayer instanceof L.Rectangle) {
        return state.drawnLayer.getBounds().contains(pt);
    }
    const raw = state.drawnLayer.getLatLngs();
    const latlngs = Array.isArray(raw[0]) ? raw[0] : raw;
    if (!latlngs || latlngs.length < 3) {
        return state.drawnLayer.getBounds().contains(pt);
    }
    let inside = false;
    for (let i = 0, j = latlngs.length - 1; i < latlngs.length; j = i++) {
        const xi = latlngs[i].lat, yi = latlngs[i].lng;
        const xj = latlngs[j].lat, yj = latlngs[j].lng;
        const intersect = ((yi > lon) !== (yj > lon)) &&
            (lat < (xj - xi) * (lon - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

// ========== SCORES ==========
function showScores(s) {
    const panel = document.getElementById("scores-panel");
    panel.style.display = "flex";
    let html = '<div class="score-card score-overall">';
    html += '<div class="score-label">Индекс района</div>';
    html += '<div class="score-big">' + s.overall + '/100</div>';
    html += '<div class="score-sub">' + s.total_places + ' мест · ' + s.area_km2 + ' км²</div>';
    html += '</div>';

    html += '<div class="score-card density-card">';
    html += '<div class="score-label">Плотность POI</div>';
    html += '<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:4px">';
    html += '<div><div class="score-big" style="font-size:24px">' + (s.poi_density || 0) + '</div>';
    html += '<div class="score-sub">мест на км²</div></div>';
    const dLevel = (s.poi_density || 0);
    let dLabel = "Низкая", dColor = "var(--muted-fg)";
    if (dLevel > 150) { dLabel = "Очень высокая"; dColor = "var(--primary)"; }
    else if (dLevel > 80) { dLabel = "Высокая"; dColor = "var(--success)"; }
    else if (dLevel > 30) { dLabel = "Средняя"; dColor = "var(--warning)"; }
    html += '<div style="color:' + dColor + ';font-size:12px;font-weight:600">' + dLabel + '</div>';
    html += '</div></div>';

    if (s.avg_rating) {
        html += '<div class="score-card">';
        html += '<div class="score-label">Средний рейтинг</div>';
        html += '<div class="score-big" style="font-size:24px">★' + s.avg_rating + '</div>';
        html += '<div class="score-sub">по данным Яндекс.Карт</div>';
        html += '</div>';
    }

  const metrics = [
      { label: "Еда", value: s.food }, { label: "Здоровье", value: s.health },
      { label: "Шопинг", value: s.shopping }, { label: "Спорт", value: s.sport },
      { label: "Образование", value: s.education }, { label: "Досуг", value: s.entertainment },
      { label: "Разнообразие", value: s.diversity }
  ];
    html += '<div class="score-card"><div class="score-label">Метрики</div><div class="metrics-grid">';
    metrics.forEach(m => {
        const color = m.value >= 60 ? "var(--success)" : m.value >= 30 ? "var(--warning)" : "var(--destructive)";
        const active = state.activeFilter === m.label ? "active" : "";
        html += '<div class="metric-row ' + active + '" onclick="toggleFilter('' + m.label + '')">';
        html += '<span class="metric-dot" style="background:' + (CAT_COLORS[m.label] || "#7c5cff") + '"></span>';
        html += '<span class="metric-label">' + m.label + '</span>';
        html += '<div class="metric-bar-bg"><div class="metric-bar-fill" style="width:' + m.value + '%;background:' + color + '"></div></div>';
        html += '<span class="metric-value">' + m.value + '</span></div>';
    });
    html += '</div></div>';
    panel.innerHTML = html;
}

// ========== REPORT ==========
async function generateReport() {
    const btn = document.getElementById("report-btn");
    if (state.reportCache) {
        document.getElementById("report-text").innerHTML = markdownToHtml(state.reportCache);
        renderCharts();
        document.getElementById("report-modal").style.display = "flex";
        return;
    }
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader" class="spinning"></i> Генерация...';
    lucide.createIcons();
    trackRequest();

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 95000);

        const r = await fetch("/api/report", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                org_text: state.orgText || "",
                scores: state.scores || {},
                scraped_data: state.scrapedData || []
            }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!r.ok) {
            const txt = await r.text();
            addBotMessage("✗ Ошибка " + r.status + ": " + txt.substring(0, 200));
            return;
        }
        const data = await r.json();
        if (!data.report) { addBotMessage("✗ Пустой ответ"); return; }
        state.reportCache = data.report;
        document.getElementById("report-text").innerHTML = markdownToHtml(data.report);
        renderCharts();
        document.getElementById("report-modal").style.display = "flex";
    } catch (e) {
        if (e.name === 'AbortError') {
            addBotMessage("✗ Превышено время ожидания (>90 сек). AI перегружен, попробуйте ещё раз.");
        } else {
            addBotMessage("✗ " + e.message);
        }
    }
    finally {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="file-text"></i> Полный отчёт';
        lucide.createIcons();
    }
}

function renderCharts() {
    const cats = state.categories, s = state.scores;
    const colors = ["#7c5cff", "#a472ff", "#d68aff", "#ff8eb8", "#feca57", "#48dbfb", "#1dd1a1", "#54a0ff", "#fd9644", "#20bf6b"];
    if (state.pieChart) state.pieChart.destroy();
    state.pieChart = new Chart(document.getElementById("pieChart"), {
        type: "doughnut",
        data: { labels: Object.keys(cats), datasets: [{ data: Object.values(cats), backgroundColor: colors, borderWidth: 0 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "right", labels: { color: "#ccc", font: { size: 10 } } } } }
    });
    const bl = ["Еда", "Здоровье", "Шопинг", "Спорт", "Образование", "Досуг", "Разнообразие"];
    const bv = [s.food, s.health, s.shopping, s.sport, s.education, s.entertainment, s.diversity];
    if (state.barChart) state.barChart.destroy();
    state.barChart = new Chart(document.getElementById("barChart"), {
        type: "bar",
        data: { labels: bl, datasets: [{ data: bv, backgroundColor: colors, borderRadius: 4 }] },
        options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, scales: { x: { max: 100, ticks: { color: "#888" } }, y: { ticks: { color: "#ccc" } } }, plugins: { legend: { display: false } } }
    });
    if (state.radarChart) state.radarChart.destroy();
    state.radarChart = new Chart(document.getElementById("radarChart"), {
        type: "radar",
        data: { labels: bl, datasets: [{ label: "Район", data: bv, backgroundColor: "rgba(124,92,255,0.2)", borderColor: "#7c5cff", borderWidth: 2, pointBackgroundColor: "#7c5cff", pointRadius: 3 }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { r: { min: 0, max: 100, ticks: { color: "#666", backdropColor: "transparent" } } }, plugins: { legend: { display: false } } }
    });
}
function closeReport() { document.getElementById("report-modal").style.display = "none"; }

// ========== PDF ==========
async function exportPDF() {
    const btn = document.getElementById("pdf-btn");
    btn.disabled = true; btn.innerHTML = "PDF...";
    try {
        const el = document.getElementById("report-export-area");
        el.style.maxHeight = "none"; el.style.overflow = "visible";
        await new Promise(r => setTimeout(r, 200));
        const canvas = await html2canvas(el, { scale: 1.5, backgroundColor: "#1a1a2e", useCORS: true });
        el.style.maxHeight = "88vh"; el.style.overflow = "auto";
        const pdf = new jspdf.jsPDF("p", "mm", "a4");
        const w = 210, m = 8, cw = w - m * 2;
        const px = canvas.width / cw, ph = (297 - m * 2) * px;
        const pages = Math.ceil(canvas.height / ph);
        for (let i = 0; i < pages; i++) {
            if (i > 0) pdf.addPage();
            const pc = document.createElement("canvas");
            pc.width = canvas.width;
            pc.height = Math.min(ph, canvas.height - i * ph);
            pc.getContext("2d").drawImage(canvas, 0, i * ph, canvas.width, pc.height, 0, 0, canvas.width, pc.height);
            pdf.addImage(pc.toDataURL("image/jpeg", 0.92), "JPEG", m, m, cw, pc.height / px);
        }
        pdf.save("quarter-report.pdf");
    } catch (e) { addBotMessage("✗ PDF: " + e.message); }
    finally { btn.disabled = false; btn.innerHTML = '<i data-lucide="download"></i> PDF'; lucide.createIcons(); }
}

// ========== ЕДИНОЕ ОКНО НАСТРОЕК АНАЛИЗА ==========
function openAnalyzeModal(mode) {
    if (!state.bbox) {
        addBotMessage("⚠ Сначала выделите область на карте");
        return;
    }

    const isPro = mode === 'pro';
    const cats = ["Еда", "Здоровье", "Шопинг", "Красота", "Спорт", "Образование", "Досуг", "Авто", "Финансы", "Услуги"];

    const container = document.getElementById("analyze-modal-content");
    container.innerHTML = "";

    const closeBtn = document.createElement("button");
    closeBtn.className = "modal-close";
    closeBtn.textContent = "×";
    closeBtn.onclick = closeAnalyzeModal;
    container.appendChild(closeBtn);

    const h2 = document.createElement("h2");
    h2.textContent = isPro ? "💎 Премиум-анализ" : "⚡ Быстрый анализ";
    container.appendChild(h2);

    const p = document.createElement("p");
    p.textContent = isPro ? "Свежие данные с Яндекс.Карт" : "Данные из OpenStreetMap (бесплатно)";
    container.appendChild(p);

    if (isPro) {
        const depthSection = document.createElement("div");
        depthSection.className = "opt-section";
        depthSection.innerHTML = '<h3>Глубина анализа</h3>';

        const toggle = document.createElement("div");
        toggle.className = "opt-toggle";

        const btnBasic = document.createElement("button");
        btnBasic.className = "opt-toggle-btn active";
        btnBasic.id = "depth-basic";
        btnBasic.innerHTML = 'Обычный<span class="opt-desc">Названия + рейтинги (1-3 мин)</span>';
        btnBasic.onclick = function() { selectDepth("basic"); };

        const btnAi = document.createElement("button");
        btnAi.className = "opt-toggle-btn";
        btnAi.id = "depth-ai";
        btnAi.innerHTML = 'AI-анализ отзывов<span class="opt-desc">Саммари отзывов (5-10 мин)</span>';
        btnAi.onclick = function() { selectDepth("ai"); };

        toggle.appendChild(btnBasic);
        toggle.appendChild(btnAi);
        depthSection.appendChild(toggle);
        container.appendChild(depthSection);
    }

    const catSection = document.createElement("div");
    catSection.className = "opt-section";
    catSection.innerHTML = '<h3>Категории</h3>';

    const grid = document.createElement("div");
    grid.className = "opt-cat-grid";

    cats.forEach((c, i) => {
        const label = document.createElement("label");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.name = "cat-opt";
        cb.value = c;
        cb.checked = i < 5;
        label.appendChild(cb);
        label.appendChild(document.createTextNode(" " + c));
        grid.appendChild(label);
    });

    catSection.appendChild(grid);
    container.appendChild(catSection);

    const runBtn = document.createElement("button");
    runBtn.className = "btn-primary";
    runBtn.textContent = "Запустить анализ";
    runBtn.onclick = function() { runAnalysis(mode); };
    container.appendChild(runBtn);

    document.getElementById("analyze-modal").style.display = "flex";
    window._analyzeDepth = "basic";
}

function closeAnalyzeModal() {
    document.getElementById("analyze-modal").style.display = "none";
}

function selectDepth(d) {
    window._analyzeDepth = d;
    const basic = document.getElementById("depth-basic");
    const ai = document.getElementById("depth-ai");
    if (basic) basic.classList.toggle("active", d === "basic");
    if (ai) ai.classList.toggle("active", d === "ai");
}

async function runAnalysis(mode) {
    const checked = Array.from(document.querySelectorAll('input[name="cat-opt"]:checked')).map(x => x.value);
    if (checked.length === 0) { alert("Выберите хотя бы одну категорию"); return; }

    closeAnalyzeModal();

    state.reportCache = null;
    state.scrapedData = [];
    state.scrapeRunId = null;
    state.organizations = [];
    if (state.heatLayer) { map.removeLayer(state.heatLayer); state.heatLayer = null; }
    if (state.markersLayer) { map.removeLayer(state.markersLayer); state.markersLayer = null; }
    if (state.scrapedMarkersLayer) { map.removeLayer(state.scrapedMarkersLayer); state.scrapedMarkersLayer = null; }
    trackRequest();

    if (mode === 'free') {
        await runFreeAnalysis(checked);
    } else {
        await runProAnalysis(checked, window._analyzeDepth === 'ai');
    }
}

async function runFreeAnalysis(categories) {
    const btn = document.getElementById("analyze-btn");
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader" class="spinning"></i> Анализ...';
    lucide.createIcons();
    addBotMessage("🔄 Загружаю данные из OpenStreetMap...");

    try {
        const r = await fetch("/api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bbox: state.bbox })
        });
        const data = await r.json();
        if (data.error) { addBotMessage("⚠ " + data.error); return; }

        state.organizations = data.organizations;
        state.scores = data.scores;
        state.categories = data.categories;
        state.orgText = data.org_text;
        state.activeFilter = null;

        if (state.heatLayer) map.removeLayer(state.heatLayer);
        const filtered = data.organizations.filter(o => isInsideDrawn(o.lat, o.lon));
        if (filtered.length > 0) {
            state.heatLayer = L.heatLayer(filtered.map(o => [o.lat, o.lon, 1]), {
                radius: 22, blur: 18,
                gradient: { 0.2: "#7c5cff", 0.5: "#a472ff", 0.7: "#d68aff", 1: "#ff8eb8" }
            }).addTo(map);
        }
        renderFilteredMarkers();
        showScores(data.scores);

        const namedCount = data.organizations.length;
        const hiddenCount = data.scores.total_places - namedCount;
        let msg = "✓ Индекс: " + data.scores.overall + "/100
Именованных мест: " + namedCount;
        if (hiddenCount > 0) msg += "
(скрыто " + hiddenCount + " безымянных)";
        msg += "

Кликайте по метрикам слева для фильтра";
        addBotMessage(msg);

        saveToHistory("free", filtered.length, data.scores.overall);
        document.getElementById("report-btn").style.display = "inline-flex";
        document.getElementById("quick-questions").style.display = "flex";
    } catch (e) { addBotMessage("✗ " + e.message); }
    finally {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="activity"></i> Анализ <span class="btn-tag tag-free">FREE</span>';
        lucide.createIcons();
    }
}

async function runProAnalysis(categories, enrichData) {
    const isPro = currentUser && (localStorage.getItem("is_pro_" + currentUser.id) === "1");
    if (!isPro && !currentUser) {
        addBotMessage("💎 Премиум-анализ доступен после входа.");
        toggleAuth();
        return;
    }
    if (!isPro) {
        const ok = confirm("💎 Премиум-анализ (~$0.4-1 за запрос).
На этапе тестирования бесплатно.
Запустить?");
        if (!ok) return;
    }

    const btn = document.getElementById("analyze-pro-btn");
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader" class="spinning"></i> Парсим...';
    lucide.createIcons();

    const msg = enrichData ? "🤖 AI-анализ отзывов (5-10 мин)..." : "🔄 Парсинг Яндекс.Карт (1-3 мин)...";
    addBotMessage(msg);

    try {
        const r = await fetch("/api/scrape/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                bbox: state.bbox,
                categories: categories,
                max_results: enrichData ? 60 : 100,
                enrich_data: enrichData
            })
        });
        const d = await r.json();
        if (!d.run_id) { addBotMessage("✗ Ошибка: " + (d.detail || "unknown")); return; }
        if (d.from_cache) addBotMessage("⚡ Из кеша (" + (d.cache_age_min || 0) + " мин)");
        state.scrapeRunId = d.run_id;
        state.scrapeEnriched = enrichData;
        pollProAnalyze(d.run_id);
    } catch (e) { addBotMessage("✗ " + e.message); }
    finally {
        setTimeout(() => {
            btn.disabled = false;
            btn.innerHTML = '<i data-lucide="sparkles"></i> Премиум-анализ <span class="btn-tag tag-pro">PRO</span>';
            lucide.createIcons();
        }, 2000);
    }
}

function pollProAnalyze(runId) {
    let attempts = 0;
    const max = state.scrapeEnriched ? 80 : 36;
    if (scrapingPollInterval) clearInterval(scrapingPollInterval);
    const interval = runId.startsWith("cached_") ? 100 : 10000;
    scrapingPollInterval = setInterval(async () => {
        attempts++;
        if (attempts > max) { clearInterval(scrapingPollInterval); addBotMessage("⏱ Таймаут"); return; }
        try {
            const r = await fetch("/api/scrape/status/" + runId);
            const d = await r.json();
            if (d.status === "SUCCEEDED") {
                clearInterval(scrapingPollInterval);
                processApifyResults(d.data || [], d.from_cache);
                saveToHistory(state.scrapeEnriched ? "pro+ai" : "pro", (d.data || []).length, state.scores.overall);
            } else if (["FAILED", "ABORTED", "TIMED-OUT"].includes(d.status)) {
                clearInterval(scrapingPollInterval);
                addBotMessage("✗ Парсинг не удался");
            } else {
                if (attempts === 3) addBotMessage("⏳ Парсим...");
                if (attempts === 12) addBotMessage("⏳ Ещё парсим...");
                if (attempts === 30) addBotMessage("⏳ AI обрабатывает...");
            }
        } catch (e) {}
    }, interval);
}

function renderScrapedMarkers() {
    if (state.scrapedMarkersLayer) map.removeLayer(state.scrapedMarkersLayer);
    state.scrapedMarkersLayer = L.layerGroup();
    state.scrapedData.forEach(o => {
        if (!o.lat || !o.lon) return;
        if (!isInsideDrawn(o.lat, o.lon)) return;
        let color = "#888";
        if (o.rating >= 4.5) color = "#1dd1a1";
        else if (o.rating >= 4.0) color = "#7bd389";
        else if (o.rating >= 3.5) color = "#feca57";
        else if (o.rating > 0) color = "#ff6b6b";
        const radius = Math.min(12, 4 + Math.log10((o.reviews_count || 1) + 1) * 3);
        let tt = "<b>" + o.name + "</b>";
        if (o.rating) tt += "<br>★ " + o.rating + " (" + (o.reviews_count || 0) + " отз.)";
        L.circleMarker([o.lat, o.lon], { radius, color: "#fff", weight: 2, fillColor: color, fillOpacity: 0.85 })
            .bindTooltip(tt, { direction: "top" }).addTo(state.scrapedMarkersLayer);
    });
    state.scrapedMarkersLayer.addTo(map);
}

// ========== CHAT ==========
function addBotMessage(t) {
    state.chatHistory.push({ role: "assistant", content: t });
    const c = document.getElementById("chat-messages");
    const d = document.createElement("div");
    d.className = "message msg-assistant";
    d.innerHTML = markdownToHtml(t);
    c.appendChild(d);
    c.scrollTop = c.scrollHeight;
}
function addUserMessage(t) {
    state.chatHistory.push({ role: "user", content: t });
    const c = document.getElementById("chat-messages");
    const d = document.createElement("div");
    d.className = "message msg-user";
    d.textContent = t;
    c.appendChild(d);
    c.scrollTop = c.scrollHeight;
}
function addLoading() {
    removeLoading();
    const c = document.getElementById("chat-messages");
    const d = document.createElement("div");
    d.className = "message msg-loading"; d.id = "loading-msg";
    d.innerHTML = '<div class="dot"></div><div class="dot"></div><div class="dot"></div>';
    c.appendChild(d); c.scrollTop = c.scrollHeight;
}
function removeLoading() { const el = document.getElementById("loading-msg"); if (el) el.remove(); }
function setChatBusy(b) {
    state.chatBusy = b;
    document.querySelectorAll(".btn-chip").forEach(x => { x.disabled = b; x.style.opacity = b ? "0.4" : "1"; });
    const s = document.getElementById("send-btn"); if (s) s.disabled = b;
}
async function sendMessage() {
    if (state.chatBusy) return;
    const i = document.getElementById("chat-input"), t = i.value.trim();
    if (!t) return;
    i.value = ""; setChatBusy(true); addUserMessage(t); addLoading(); trackRequest();
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 95000);
        const r = await fetch("/api/chat", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                question: t,
                org_text: state.orgText || "",
                scores: state.scores || {},
                history: state.chatHistory.slice(-6)
            }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        const d = await r.json();
        removeLoading();
        addBotMessage(d.answer || "Пустой ответ");
    } catch (e) {
        removeLoading();
        if (e.name === 'AbortError') addBotMessage("⏱ Таймаут AI");
        else addBotMessage("✗ " + e.message);
    }
    finally { setChatBusy(false); }
}

async function askQuick(q) {
    if (!q || state.chatBusy) return;
    setChatBusy(true); addUserMessage(q); addLoading(); trackRequest();
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 95000);
        const r = await fetch("/api/chat", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                question: q,
                org_text: state.orgText || "",
                scores: state.scores || {},
                history: state.chatHistory.slice(-6)
            }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        const d = await r.json();
        removeLoading();
        addBotMessage(d.answer || "Пустой ответ");
    } catch (e) {
        removeLoading();
        if (e.name === 'AbortError') addBotMessage("⏱ Таймаут AI");
        else addBotMessage("✗ " + e.message);
    }
    finally { setChatBusy(false); }
}

document.getElementById("chat-input").addEventListener("keypress", e => { if (e.key === "Enter" && !state.chatBusy) sendMessage(); });
document.addEventListener("click", e => { if (!e.target.closest(".search-box")) document.getElementById("search-results").innerHTML = ""; });

function markdownToHtml(t) {
    if (!t) return "";
    return t.replace(/^## (.+)$/gm, "<h2>$1</h2>")
            .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
            .replace(/\*(.*?)\*/g, "<em>$1</em>")
            .replace(/
/g, "<br>");
}

setTimeout(() => lucide.createIcons(), 100);
