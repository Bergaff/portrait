// app.js - ИСПРАВЛЕННАЯ ВЕРСИЯ

const APP_VERSION = "1.0";



// Настройка: принудительная регистрация только с почтами РФ (.ru, .su, .рф, Yandex, Mail.ru и др.)
const REQUIRE_RU_EMAIL = false; // Поставь false, чтобы отключить ограничение

function isRussianEmail(email) {
    if (!email || !email.includes("@")) return false;
    const domain = email.split("@")[1].toLowerCase();
    const ruTLDs = [".ru", ".su", ".рф"];
    const ruDomains = ["yandex.ru", "mail.ru", "bk.ru", "inbox.ru", "list.ru", "rambler.ru", "ya.ru", "vk.com"];
    return ruTLDs.some(tld => domain.endsWith(tld)) || ruDomains.includes(domain);
}



async function safeJson(response) {
    const text = await response.text();
    try {
        return JSON.parse(text);
    } catch (e) {
        console.error("Non-JSON response:", text.substring(0, 300));
        throw new Error("Сервер перегружен или временно недоступен, попробуйте ещё раз");
    }
}



// ========== CITY ==========
let detectedCity = "", detectedLat = 55.7558, detectedLon = 37.6173;
let cityInitTimeout = null;

window.confirmCity = function() {
    clearTimeout(cityInitTimeout);
    localStorage.setItem("qp_city", JSON.stringify({ name: detectedCity, lat: detectedLat, lon: detectedLon }));
    map.setView([detectedLat, detectedLon], 13);
    const modal = document.getElementById("city-modal");
    if (modal) modal.style.display = "none";
    addBotMessage(`Привет! Я AI-урбанист

Город: Москва

Выберите интересующую вас область с помощью:
⬡ многоугольника или ▢ прямоугольника с левой стороны карты
→ далее нажмите Анализ

Вы можете изменить точки области или удалить неудачную через меню редактирования.`);

window.skipCity = function() {
    clearTimeout(cityInitTimeout);
    localStorage.setItem("qp_city", JSON.stringify({ name: "Москва", lat: 55.7558, lon: 37.6173 }));
    map.setView([55.7558, 37.6173], 13);
    const modal = document.getElementById("city-modal");
    if (modal) modal.style.display = "none";
    addBotMessage(`Привет! Я AI-урбанист

Город: Москва

Выберите интересующую вас область с помощью:
⬡ многоугольника или ▢ прямоугольника с левой стороны карты
→ далее нажмите Анализ

Вы можете изменить точки области или удалить неудачную через меню редактирования.`);
window.showCityInput = function() {
    clearTimeout(cityInitTimeout);
    document.getElementById("city-detecting").style.display = "none";
    document.getElementById("city-confirm").style.display = "none";
    document.getElementById("city-input-block").style.display = "block";
};

window.searchAndGoCity = async function() {
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

function isUserPro() {
    return currentUser && (localStorage.getItem("is_pro_" + currentUser.id) === "1");
}

function updateAuthUI() {
    document.getElementById("auth-btn").style.display = "none";
    document.getElementById("user-info").style.display = "flex";
    updateChatInputState();
}

function updateAuthUILoggedOut() {
    document.getElementById("auth-btn").style.display = "inline-flex";
    document.getElementById("user-info").style.display = "none";
    updateChatInputState();
}

function updateChatInputState() {
    const chatInput = document.getElementById("chat-input");
    const sendBtn = document.getElementById("send-btn");
    if (!chatInput) return;

    // Ввод разрешен ТОЛЬКО если есть юзер И он PRO
    if (isUserPro()) {
        chatInput.disabled = false;
        chatInput.placeholder = "Спросите про район...";
        if (sendBtn) sendBtn.disabled = false;
    } else {
        // Для всех остальных (неавторизованных и Free) поле заблокировано
        chatInput.disabled = true;
        chatInput.placeholder = "🔒 Ввод текста доступен в PRO. Жмите кнопки!";
        if (sendBtn) sendBtn.disabled = true;
    }
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

    if (REQUIRE_RU_EMAIL === true && !isRussianEmail(e)) {
        showAuthError("Согласно ФЗ №405, регистрация возможна только через российскую почту (.ru, .su, .рф)");
        return;
    }

    const { error } = await supabaseClient.auth.signInWithPassword({ email: e, password: p });
    if (error) showAuthError(translateError(error.message));
}

async function emailSignUp() {
    const e = document.getElementById("auth-email").value.trim();
    const p = document.getElementById("auth-password").value;
    if (!e || !p) { showAuthError("Заполните поля"); return; }
    if (p.length < 6) { showAuthError("Минимум 6 символов"); return; }

    if (REQUIRE_RU_EMAIL === true && !isRussianEmail(e)) {
        showAuthError("Согласно ФЗ №405, регистрация возможна только через российскую почту (.ru, .su, .рф)");
        return;
    }

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
    fetchUserPlan();
}

async function fetchUserPlan() {
    if (!currentUser) return;
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        const token = session?.access_token || "";
        
        const r = await fetch("/api/auth/status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                access_token: token, 
                email: currentUser.email || "" 
            })
        });
        
        const d = await r.json();
        
        if (d.is_vip) {
            localStorage.setItem("is_pro_" + currentUser.id, "1");
            localStorage.setItem("plan_" + currentUser.id, "vip");
        } else if (d.is_pro) {
            localStorage.setItem("is_pro_" + currentUser.id, "1");
            localStorage.setItem("plan_" + currentUser.id, "pro");
        } else {
            localStorage.removeItem("is_pro_" + currentUser.id);
            localStorage.setItem("plan_" + currentUser.id, "free");
        }
        
        updateChatInputState();
    } catch (e) {
        console.warn("Не удалось получить статус VIP/PRO:", e);
    }
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
    const plan = localStorage.getItem("plan_" + currentUser.id) || "free";
    let planBadge = '<span style="color:var(--muted-fg)">Free</span>';
    if (plan === "vip") planBadge = '<span style="background:linear-gradient(135deg,#feca57,#ff6b6b);color:#000;padding:2px 8px;border-radius:5px;font-weight:700;font-size:11px">👑 VIP LIFETIME</span>';
    else if (plan === "pro") planBadge = '<span style="background:var(--primary);color:#fff;padding:2px 8px;border-radius:5px;font-weight:700;font-size:11px">PRO</span>';

    info.innerHTML =
        '<div class="profile-row"><span class="profile-label">Тариф</span><span>' + planBadge + '</span></div>' +
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
        polygon: {
            shapeOptions: { color: "#7c5cff", fillOpacity: 0.15, weight: 2 },
            allowIntersection: true,
            showArea: false,
            drawError: {
                color: 'transparent',
                timeout: 1,
                message: ''
            }
        },
        rectangle: { shapeOptions: { color: "#7c5cff", fillOpacity: 0.15, weight: 2 } }
    },
    edit: { featureGroup: drawnItems }
});
map.addControl(drawControl);


// ==================== ДОРАБОТКА РИСОВАНИЯ (ФИНАЛЬНАЯ ИСПРАВЛЕННАЯ ВЕРСИЯ) ====================
const MAX_POINTS = 10;
let drawToolbar = null;
let currentHandler = null;
let currentMode = "";
let pointCount = 0;
let uiUpdater = null;
let autoFinished = false;

function updatePointCount() {
    if (!currentHandler) { pointCount = 0; return; }

    if (currentMode === "polygon") {
        // Для многоугольника: считаем из _markers
        if (currentHandler._markers && Array.isArray(currentHandler._markers)) {
            pointCount = currentHandler._markers.length;
        } else if (currentHandler._markerLayer) {
            try {
                pointCount = currentHandler._markerLayer.getLayers().length;
            } catch (e) {
                pointCount = 0;
            }
        } else {
            pointCount = 0;
        }
    } else if (currentMode === "rectangle") {
        // Для прямоугольника: ровно 2 точки после второго клика
        pointCount = (currentHandler._secondClickDone) ? 2 : (currentHandler._qpStart ? 1 : 0);
    } else {
        pointCount = 0;
    }

    if (pointCount > MAX_POINTS) pointCount = MAX_POINTS;
}

function updateToolbarUI() {
    updatePointCount();

    const counter = document.getElementById("point-counter");
    if (counter) {
        const maxPts = (currentMode === "rectangle") ? 2 : MAX_POINTS;
        counter.textContent = pointCount + "/" + maxPts;
    }

    const finishBtn = document.getElementById("btn-finish");
    if (finishBtn) {
        const canFinish = pointCount >= (currentMode === "rectangle" ? 2 : 3);
        finishBtn.style.opacity = canFinish ? "1" : "0.5";
        finishBtn.style.pointerEvents = canFinish ? "auto" : "none";
        finishBtn.style.cursor = canFinish ? "pointer" : "not-allowed";
    }

    const undoBtn = document.getElementById("btn-undo");
    if (undoBtn) {
        undoBtn.style.display = (currentMode === "rectangle") ? "none" : "inline-flex";
    }

    // Авто-завершение полигона при лимите
    if (currentMode === "polygon" && !autoFinished && pointCount >= MAX_POINTS) {
        if (currentHandler && typeof currentHandler.completeShape === "function") {
            autoFinished = true;
            setTimeout(function() {
                try {
                    if (currentHandler && typeof currentHandler.completeShape === "function") {
                        currentHandler.completeShape();
                    }
                } catch (e) {
                    console.warn("Auto-complete failed:", e);
                }
            }, 100);
        }
    }
}

function startUIUpdater() {
    if (uiUpdater) clearInterval(uiUpdater);
    uiUpdater = setInterval(updateToolbarUI, 100); // Увеличиваем частоту проверки
}

function stopUIUpdater() {
    if (uiUpdater) {
        clearInterval(uiUpdater);
        uiUpdater = null;
    }
}

function createToolbar() {
    // Если тулбар уже существует, просто показываем его
    if (drawToolbar) {
        drawToolbar.style.display = "flex";
        startUIUpdater();
        updateToolbarUI();
        return;
    }

    const mapSection = document.getElementById("map-section");
    if (!mapSection) return;

    drawToolbar = document.createElement("div");
    drawToolbar.id = "custom-draw-toolbar";
    drawToolbar.className = "draw-toolbar";

    // Отменяем всплытие событий
    drawToolbar.addEventListener("click", function(e) {
        e.stopPropagation();
    });
    drawToolbar.addEventListener("mousedown", function(e) {
        e.stopPropagation();
    });

    // КНОПКА ОТМЕНА
    const btnCancel = document.createElement("button");
    btnCancel.className = "btn-finish";
    btnCancel.style.background = "#333";
    btnCancel.innerHTML = "✕ Отмена";
    btnCancel.onclick = function(e) {
        e.stopPropagation();
        if (currentHandler) {
            try {
                currentHandler.disable();
            } catch (ex) {
                console.warn("Disable failed:", ex);
            }
        }
        killDrawing();
    };

    // КНОПКА УДАЛИТЬ ТОЧКУ
    const btnUndo = document.createElement("button");
    btnUndo.id = "btn-undo";
    btnUndo.className = "btn-finish";
    btnUndo.style.background = "#333";
    btnUndo.innerHTML = "↶ Удалить";
    btnUndo.onclick = function(e) {
        e.stopPropagation();
        if (currentMode === "polygon" && currentHandler) {
            if (typeof currentHandler.deleteLastVertex === "function") {
                currentHandler.deleteLastVertex();
                updatePointCount();
                updateToolbarUI();
            }
        }
    };

    // КНОПКА ГОТОВО
    const btnFinish = document.createElement("button");
    btnFinish.id = "btn-finish";
    btnFinish.className = "btn-finish";
    btnFinish.innerHTML = "✓ Готово <span id='point-counter'>0/10</span>";
    btnFinish.onclick = function(e) {
        e.stopPropagation();
        updatePointCount();
        const minPts = (currentMode === "rectangle") ? 2 : 3;
        if (pointCount < minPts) {
            console.warn("Not enough points:", pointCount, "min:", minPts);
            return;
        }

        if (currentMode === "rectangle" && currentHandler) {
            // Завершаем прямоугольник
            if (typeof currentHandler._completeFromClick === "function") {
                currentHandler._completeFromClick();
            } else {
                currentHandler.disable();
            }
        } else if (currentHandler) {
            // Завершаем многоугольник
            if (typeof currentHandler.completeShape === "function") {
                currentHandler.completeShape();
            } else {
                currentHandler.disable();
            }
        }
    };

    drawToolbar.appendChild(btnCancel);
    drawToolbar.appendChild(btnUndo);
    drawToolbar.appendChild(btnFinish);
    mapSection.appendChild(drawToolbar);

    startUIUpdater();
    updateToolbarUI();
}

function killDrawing() {
    stopUIUpdater();
    if (drawToolbar) {
        drawToolbar.style.display = "none";
    }
    currentHandler = null;
    currentMode = "";
    pointCount = 0;
    autoFinished = false;
}

// ==================== ПАТЧ ПРЯМОУГОЛЬНИКА (ИСПРАВЛЕННЫЙ) ====================
function patchRectangleTool() {
    if (L.Draw.Rectangle.prototype._patched) return;
    L.Draw.Rectangle.prototype._patched = true;

    L.Draw.Rectangle.prototype.addHooks = function() {
        if (!this._map) return;

        this._map.dragging.disable();
        this._map.doubleClickZoom.disable();
        this._map.getContainer().style.cursor = "crosshair";

        this._qpStart = null;
        this._qpTempLayer = null;
        this._qpLast = null;
        this._secondClickDone = false;

        // ПЕРВЫЙ КЛИК
        this._onClickFixed = function(e) {
            if (e.originalEvent && e.originalEvent.button !== 0) return;

            // Если уже завершено - игнорируем клики
            if (this._secondClickDone) return;

            if (!this._qpStart) {
                // Первый клик
                this._qpStart = e.latlng;
                this._qpTempLayer = L.rectangle([e.latlng, e.latlng], this.options.shapeOptions).addTo(this._map);

                currentMode = "rectangle";
                currentHandler = this;
                pointCount = 1;
                autoFinished = false;

                createToolbar();
                updateToolbarUI();
                console.log("Rectangle: first click at", e.latlng);
                return;
            }

            // ВТОРОЙ КЛИК - жёсткое автозавершение
            this._qpLast = e.latlng;
            this._secondClickDone = true;
            pointCount = 2;

            // Фиксируем финальные границы СРАЗУ
            if (this._qpTempLayer) {
                this._qpTempLayer.setBounds(L.latLngBounds(this._qpStart, this._qpLast));
            }

            // Отключаем mousemove, чтобы не съезжало
            if (this._onMoveFixed) {
                this._map.off("mousemove", this._onMoveFixed);
            }

            updateToolbarUI();
            console.log("Rectangle: second click at", e.latlng, "- auto completing");

            // Немедленно завершаем
            const self = this;
            setTimeout(function() {
                if (self._completeFromClick) {
                    self._completeFromClick();
                }
            }, 10);
        }.bind(this);

        // ДВИЖЕНИЕ МЫШИ (обновляем визуал, но НЕ считаем как точки)
        this._onMoveFixed = function(e) {
            if (this._qpStart && this._qpTempLayer) {
                this._qpTempLayer.setBounds(L.latLngBounds(this._qpStart, e.latlng));
            }
        }.bind(this);

        // ЗАВЕРШИТЬ ИЗ КЛИКА
        this._completeFromClick = function() {
            if (!this._qpTempLayer || !this._qpStart || !this._qpLast) {
                console.warn("Rectangle incomplete");
                return;
            }

            const bounds = L.latLngBounds(this._qpStart, this._qpLast);
            this._map.removeLayer(this._qpTempLayer);
            this._qpTempLayer = null;

            const finalRect = L.rectangle(bounds, this.options.shapeOptions);
            this._map.fire(L.Draw.Event.CREATED, { layer: finalRect, layerType: "rectangle" });
            this.disable();
        }.bind(this);

        this._map.on("click", this._onClickFixed);
        this._map.on("mousemove", this._onMoveFixed);
    };

    L.Draw.Rectangle.prototype.removeHooks = function() {
        if (!this._map) return;

        this._map.dragging.enable();
        this._map.doubleClickZoom.enable();
        this._map.off("click", this._onClickFixed);
        this._map.off("mousemove", this._onMoveFixed);

        if (this._qpTempLayer) {
            this._map.removeLayer(this._qpTempLayer);
        }

        this._map.getContainer().style.cursor = "";
        this._qpStart = null;
        this._qpTempLayer = null;
        this._qpLast = null;
        this._secondClickDone = false;
    };
}
patchRectangleTool();

// ==================== СОБЫТИЯ РИСОВАНИЯ ====================
map.on('draw:drawstart', function(e) {
    console.log("DRAW:DRAWSTART", e.layerType);

    if (e.layerType !== "polygon" && e.layerType !== "rectangle") return;

    // Чистим старые области
    drawnItems.eachLayer(function(layer) {
        map.removeLayer(layer);
    });
    drawnItems.clearLayers();
    state.drawnLayer = null;
    state.bbox = null;
    document.getElementById("actions-panel").style.display = "none";

    autoFinished = false;
    currentMode = e.layerType;
    pointCount = 0;

    // Получаем handler из события или из контрола
    currentHandler = e.handler || null;
    if (!currentHandler) {
        try {
            const toolbar = drawControl._toolbars?.draw;
            if (toolbar && toolbar._modes) {
                const mode = toolbar._modes[e.layerType];
                currentHandler = mode?.handler || null;
            }
        } catch (err) {
            console.warn("Could not get handler:", err);
        }
    }

    createToolbar();
    updateToolbarUI();
});

// События для многоугольника (при добавлении вершины)
map.on('draw:drawvertex', function(e) {
    console.log("DRAW:DRAWVERTEX");
    if (currentMode === "polygon") {
        updatePointCount();
        updateToolbarUI();
    }
});

map.on('draw:drawstop', function(e) {
    console.log("DRAW:DRAWSTOP");
    killDrawing();
});

map.on("draw:created", function(e) {
    console.log("DRAW:CREATED", e.layerType);
    drawnItems.clearLayers();
    drawnItems.addLayer(e.layer);
    state.drawnLayer = e.layer;

    const b = e.layer.getBounds();
    state.bbox = b.getSouth() + "," + b.getWest() + "," + b.getNorth() + "," + b.getEast();

    document.getElementById("actions-panel").style.display = "flex";
    state.reportCache = null;

    killDrawing();
});

map.on("draw:deleted", function(e) {
    console.log("DRAW:DELETED");
    drawnItems.eachLayer(function(layer) {
        map.removeLayer(layer);
    });
    drawnItems.clearLayers();
    state.bbox = null;
    state.drawnLayer = null;
    document.getElementById("actions-panel").style.display = "none";
    addBotMessage("Область удалена. Теперь можно выбрать новую.");
});

map.on("draw:edited", function(e) {
    console.log("DRAW:EDITED");
    const layers = e.layers && e.layers.getLayers ? e.layers.getLayers() : [];
    if (!layers.length) return;

    const layer = layers[0];
    state.drawnLayer = layer;

    const b = layer.getBounds();
    state.bbox = b.getSouth() + "," + b.getWest() + "," + b.getNorth() + "," + b.getEast();

    document.getElementById("actions-panel").style.display = "flex";
    state.reportCache = null;
});

// ========== CITY INIT ==========
function initCity() {
    const saved = localStorage.getItem("qp_city");
    if (saved) {
        const d = JSON.parse(saved);
        map.setView([d.lat, d.lon], 13);
        document.getElementById("city-modal").style.display = "none";
        const msg = "Привет! Я AI-урбанист\n\nГород: " + d.name + "\n\nВыберите интересующую вас область с помощью:\n⬡ многоугольника или ▢ прямоугольника с левой стороны карты\n→ далее нажмите Анализ\n\nВы можете изменить точки области или удалить неудачную через меню редактирования.";
        addBotMessage(msg);
        return;
    }

    document.getElementById("city-modal").style.display = "flex";

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                try {
                    const r = await fetch("https://nominatim.openstreetmap.org/reverse?lat=" + pos.coords.latitude + "&lon=" + pos.coords.longitude + "&format=json&accept-language=ru");
                    const d = await r.json();
                    const city = d.address?.city || d.address?.town || d.address?.village || "Ваш город";
                    showCityConfirm(city, pos.coords.latitude, pos.coords.longitude);
                } catch (e) {
                    skipToMoscow();
                }
            },
            () => {
                // Пользователь отказал в доступе к геолокации
                skipToMoscow();
            },
            { timeout: 7000, enableHighAccuracy: false }
        );
    } else {
        skipToMoscow();
    }
}

function skipToMoscow() {
    clearTimeout(cityInitTimeout);
    detectedCity = "Москва";
    detectedLat = 55.7558;
    detectedLon = 37.6173;
    document.getElementById("city-detecting").style.display = "none";
    document.getElementById("city-confirm").style.display = "none";
    document.getElementById("city-input-block").style.display = "none";
    map.setView([55.7558, 37.6173], 13);
    document.getElementById("city-modal").style.display = "none";
    addBotMessage(`Привет! Я AI-урбанист

Город: Москва

Выберите интересующую вас область с помощью:
⬡ многоугольника или ▢ прямоугольника с левой стороны карты
→ далее нажмите Анализ

Вы можете изменить точки области или удалить неудачную через меню редактирования.`);
}

function showCityConfirm(c, lat, lon) {
    detectedCity = c; detectedLat = lat; detectedLon = lon;
    document.getElementById("city-detecting").style.display = "none";
    document.getElementById("city-name-show").textContent = c;
    document.getElementById("city-confirm").style.display = "block";
}

// ========== SEARCH ==========
let searchTimeout;
document.getElementById("search-input").addEventListener("input", e => {
    clearTimeout(searchTimeout);
    const q = e.target.value.trim();
    const resultsContainer = document.getElementById("search-results");

    if (q.length < 2) {
        resultsContainer.innerHTML = "";
        return;
    }

    searchTimeout = setTimeout(async () => {
        try {
            const r = await fetch("/api/search?q=" + encodeURIComponent(q));
            if (!r.ok) return;
            const d = await r.json();

            resultsContainer.innerHTML = "";
            if (!d.results || !d.results.length) {
                resultsContainer.innerHTML = '<div class="search-item">Не найдено</div>';
                return;
            }

            d.results.forEach(item => {
                const div = document.createElement("div");
                div.className = "search-item";
                div.textContent = item.display_name.substring(0, 70);
                div.onclick = () => {
                    map.setView([item.lat, item.lon], 16);
                    resultsContainer.innerHTML = "";
                    document.getElementById("search-input").value = item.display_name.substring(0, 50);
                };
                resultsContainer.appendChild(div);
            });
        } catch (e) {
            console.error("Ошибка поиска:", e);
        }
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
    ).join("\n");
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
    let msg = (fromCache ? "⚡ " : "✓ ") + "Готово! Яндекс.Карты\nИндекс: " + state.scores.overall + "/100\nЗаведений: " + filtered.length;
    if (state.scores.avg_rating) msg += "\nСредний рейтинг: ★" + state.scores.avg_rating;
    if (topPlaces.length > 0) {
        msg += "\n\n⭐ Топ:";
        topPlaces.forEach(p => { msg += "\n• " + p.name + " (★" + p.rating + ")"; });
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

function getAmenityCategoryName(amenity) {
    for (const [catName, list] of Object.entries(CAT_MAP)) {
        if (list.includes(amenity)) return catName;
    }
    return "Другое";
}

function renderFilteredMarkers() {
    if (state.markersLayer) map.removeLayer(state.markersLayer);
    state.markersLayer = L.layerGroup();
    state.organizations.forEach(o => {
        if (!isInsideDrawn(o.lat, o.lon)) return;

        const poiCategory = getAmenityCategoryName(o.amenity);

        if (state.activeFilter && state.activeFilter !== "Разнообразие") {
            if (!(CAT_MAP[state.activeFilter] || []).includes(o.amenity)) return;
        }

        let name = o.name || o.amenity || "";
        if (!name || name === "Без названия" || name === "Другое") {
            name = o.amenity ? o.amenity.charAt(0).toUpperCase() + o.amenity.slice(1) : "Точка интереса";
        }

        // Каждая категория окрашивается в свой цвет из CAT_COLORS
        const color = CAT_COLORS[poiCategory] || "#7c5cff";

        L.circleMarker([o.lat, o.lon], {
            radius: 5,
            color: "#ffffff",
            fillColor: color,
            fillOpacity: 0.9,
            weight: 1
        }).bindTooltip("<b>" + o.name + "</b><br><span style='color:" + color + "'>●</span> " + poiCategory, { direction: "top" }).addTo(state.markersLayer);
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

    const dLevel = (s.poi_density || 0);
    let dLabel = "Низкая";
    if (dLevel > 150) dLabel = "Очень высокая";
    else if (dLevel > 80) dLabel = "Высокая";
    else if (dLevel > 30) dLabel = "Средняя";

    let html = '<div class="score-card score-overall combined-card">';
    html += '<div class="combined-grid">';

    html += '<div class="combined-col">';
    html += '<div class="score-label">Индекс района</div>';
    html += '<div class="score-big">' + s.overall + '/100</div>';
    html += '<div class="score-sub">' + s.total_places + ' мест · ' + s.area_km2 + ' км²</div>';
    html += '</div>';

    html += '<div class="combined-divider"></div>';

    html += '<div class="combined-col">';
    html += '<div class="score-label">Плотность POI</div>';
    html += '<div class="score-big" style="font-size:24px">' + dLevel + '</div>';
    html += '<div class="score-sub">мест/км² · ' + dLabel + '</div>';
    html += '<button class="btn-density-details" onclick="toggleDensityDetails(event)">Подробнее ▾</button>';
    html += '<div id="density-details-popup" class="density-details-popup"></div>';
    html += '</div>';

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
        html += '<div class="metric-row ' + active + '" onclick="toggleFilter(\'' + m.label + '\')">';
        html += '<span class="metric-dot" style="background:' + (CAT_COLORS[m.label] || "#7c5cff") + '"></span>';
        html += '<span class="metric-label">' + m.label + '</span>';
        html += '<div class="metric-bar-bg"><div class="metric-bar-fill" style="width:' + m.value + '%;background:' + color + '"></div></div>';
        html += '<span class="metric-value">' + m.value + '</span></div>';
    });
    html += '</div></div>';
    panel.innerHTML = html;
}

function toggleDensityDetails(event) {
    if (event) event.stopPropagation();
    const popup = document.getElementById("density-details-popup");
    if (!popup) return;

    if (popup.style.display === "block") {
        popup.style.display = "none";
        return;
    }

    const area = (state.scores && state.scores.area_km2) || 1;
    const cats = state.categories || {};
    const entries = Object.entries(cats).sort((a, b) => b[1] - a[1]);

    let html = '<div class="density-popup-title">Плотность по категориям</div>';
    if (entries.length === 0) {
        html += '<div class="density-popup-empty">Нет данных</div>';
    } else {
        entries.forEach(([name, count]) => {
            const density = Math.round((count / area) * 10) / 10;
            html += '<div class="density-popup-row"><span>' + name + '</span>' +
                '<span class="density-popup-value">' + density + '/км² <small>(' + count + ')</small></span></div>';
        });
    }
    popup.innerHTML = html;
    popup.style.display = "block";
}

document.addEventListener("click", (e) => {
    const popup = document.getElementById("density-details-popup");
    if (popup && popup.style.display === "block" &&
        !e.target.closest("#density-details-popup") && !e.target.closest(".btn-density-details")) {
        popup.style.display = "none";
    }
});

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
        const timeoutId = setTimeout(() => controller.abort(), 75000);
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
        let data;
        try { data = await safeJson(r); }
        catch (jsonErr) { addBotMessage("✗ " + jsonErr.message); return; }
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
        let msg = "✓ Индекс: " + data.scores.overall + "/100\nИменованных мест: " + namedCount;
        if (hiddenCount > 0) msg += "\n(скрыто " + hiddenCount + " безымянных)";
        msg += "\n\nКликайте по метрикам слева для фильтра";
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
        const ok = confirm("💎 Премиум-анализ (~$0.4-1 за запрос).\nНа этапе тестирования бесплатно.\nЗапустить?");
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
        let d;
        try { d = await safeJson(r); }
        catch (jsonErr) { addBotMessage("✗ " + jsonErr.message); return; }
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
            let d;
            try { d = await safeJson(r); }
            catch (jsonErr) { clearInterval(scrapingPollInterval); addBotMessage("✗ " + jsonErr.message); return; }
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


function checkGuestActionAllowed() {
    if (currentUser) return true; // Авторизованные проходят лимит анонима

    let guestRequests = parseInt(localStorage.getItem("qp_guest_requests") || "0");
    if (guestRequests >= 3) {
        addBotMessage("🔒 Вы исчерпали 3 бесплатные попытки без регистрации. Войдите или зарегистрируйтесь, чтобы продолжить!");
        toggleAuth();
        return false;
    }
    guestRequests++;
    localStorage.setItem("qp_guest_requests", guestRequests.toString());
    return true;
}

function togglePasswordVisibility() {
    const pwInput = document.getElementById("auth-password");
    const eyeIcon = document.getElementById("pw-eye-icon");
    if (!pwInput) return;

    if (pwInput.type === "password") {
        pwInput.type = "text";
        if (eyeIcon) eyeIcon.setAttribute("data-lucide", "eye-off");
    } else {
        pwInput.type = "password";
        if (eyeIcon) eyeIcon.setAttribute("data-lucide", "eye");
    }
    lucide.createIcons();
}






async function sendMessage() {
    if (state.chatBusy) return;

    if (!currentUser && !checkGuestActionAllowed()) return;

    if (currentUser && !isUserPro()) {
        addBotMessage("🔒 Произвольный ввод вопросов AI доступен только в PRO-версии. Вы можете нажимать быстрые кнопки выше!");
        return;
    }

    const i = document.getElementById("chat-input"), t = i.value.trim();
    if (!t) return;
    // ... далее текущий код sendMessage() без изменений
    i.value = ""; setChatBusy(true); addUserMessage(t); addLoading(); trackRequest();
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 75000);
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
        let d;
        try { d = await safeJson(r); }
        catch (jsonErr) { removeLoading(); addBotMessage("✗ " + jsonErr.message); return; }
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
    if (!checkGuestActionAllowed()) return;
    setChatBusy(true); addUserMessage(q); addLoading(); trackRequest();
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 75000);
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
        let d;
        try { d = await safeJson(r); }
        catch (jsonErr) { removeLoading(); addBotMessage("✗ " + jsonErr.message); return; }
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
            .replace(/\n/g, "<br>");
}

// ==================== MOBILE PANEL ====================
const mobilePanelBtn = document.getElementById("mobile-panel-btn");
const mobileOverlay = document.getElementById("mobile-overlay");
const mobileClose = document.getElementById("mobile-close");
const mobileBody = document.getElementById("mobile-body");
const mobileContent = document.getElementById("mobile-content");

// Элементы, которые перемещаем между sidebar и mobile
const movableIds = ["scores-panel", "actions-panel", "quick-questions", "chat-section"];

function isMobile() {
    return window.innerWidth <= 920 || ('ontouchstart' in window && window.innerWidth < 1024);
}

function moveToMobile() {
    movableIds.forEach(id => {
        const el = document.getElementById(id);
        if (el && sidebar.contains(el)) {
            mobileBody.appendChild(el);
        }
    });
}

function moveBackToSidebar() {
    movableIds.forEach(id => {
        const el = document.getElementById(id);
        if (el && mobileBody.contains(el)) {
            sidebar.appendChild(el);
        }
    });
}

function openMobilePanel() {
    if (!isMobile()) return;
    moveToMobile();
    mobileOverlay.classList.add("active");
    document.body.style.overflow = "hidden";
    lucide.createIcons();
}

function closeMobilePanel() {
    mobileOverlay.classList.remove("active");
    document.body.style.overflow = "";
    setTimeout(moveBackToSidebar, 300);
}

// Обработчики
if (mobilePanelBtn) {
    mobilePanelBtn.addEventListener("click", openMobilePanel);
}

if (mobileClose) {
    mobileClose.addEventListener("click", closeMobilePanel);
}

if (mobileOverlay) {
    mobileOverlay.addEventListener("click", (e) => {
        if (e.target === mobileOverlay) closeMobilePanel();
    });
}

// Свайп вниз для закрытия
let touchStartY = 0;
if (mobileContent) {
    mobileContent.addEventListener("touchstart", (e) => {
        touchStartY = e.touches[0].clientY;
    }, {passive: true});

    mobileContent.addEventListener("touchmove", (e) => {
        if (mobileBody.scrollTop > 0) return;
        const diff = e.touches[0].clientY - touchStartY;
        if (diff > 80) closeMobilePanel();
    }, {passive: true});
}

// Escape для закрытия
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && mobileOverlay?.classList.contains("active")) {
        closeMobilePanel();
    }
});

// При ресайзе на десктоп возвращаем всё назад
window.addEventListener("resize", () => {
    if (!isMobile() && mobileOverlay?.classList.contains("active")) {
        closeMobilePanel();
    }
});

// Запуск инициализации города
setTimeout(() => {
    initCity();
    lucide.createIcons();
}, 100);

