// ========== ВЕРСИЯ ==========
const APP_VERSION = "1.0";

// ========== ТЕМА ==========
function toggleTheme() {
    const cur = document.body.getAttribute("data-theme") || "dark";
    const newTheme = cur === "dark" ? "light" : "dark";
    document.body.setAttribute("data-theme", newTheme);
    localStorage.setItem("qp_theme", newTheme);
    // Перерисовываем карту с новыми тайлами
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
        // Показываем плашку только один раз
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
    let h = '<div class="profile-row"><span class="profile-label">Email</span><span>' + (currentUser.email || "—") + '</span></div>';
    h += '<div class="profile-row"><span class="profile-label">Способ входа</span><span style="text-transform:capitalize">' + p + '</span></div>';
    h += '<div class="profile-row"><span class="profile-label">Регистрация</span><span>' + d + '</span></div>';
    h += '<div class="profile-row"><span class="profile-label">Запросов</span><span>' + userStats.requests + '</span></div>';
    document.getElementById("profile-content").innerHTML = h;
    document.getElementById("profile-modal").style.display = "flex";
}
function closeProfile() { document.getElementById("profile-modal").style.display = "none"; }

// ========== STATE ==========
let state = {
    bbox: null, organizations: [], scores: {}, categories: {}, orgText: "",
    chatHistory: [], heatLayer: null, markersLayer: null, scrapedMarkersLayer: null,
    pieChart: null, barChart: null, radarChart: null,
    activeFilter: null, reportCache: null, chatBusy: false,
    scrapedData: [], scrapeRunId: null, scrapeEnriched: false, drawnLayer: null
};

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
    state.drawnLayer = e.layer; // сохраняем для проверки point-in-polygon
    const b = e.layer.getBounds();
    state.bbox = b.getSouth() + "," + b.getWest() + "," + b.getNorth() + "," + b.getEast();
    document.getElementById("actions-panel").style.display = "flex";
    state.reportCache = null;
});

// ========== CITY ==========
let detectedCity = "", detectedLat = 55.7558, detectedLon = 37.6173;
let cityInitTimeout = null;

function initCity() {
    const saved = localStorage.getItem("qp_city");
    if (saved) {
        const d = JSON.parse(saved);
        map.setView([d.lat, d.lon], 13);
        document.getElementById("city-modal").style.display = "none";
        addBotMessage("Привет! Я AI-урбанист\n\nГород: " + d.name + "\n\nВыделите область на карте → нажмите «Анализировать»");
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
function confirmCity() {
    clearTimeout(cityInitTimeout);
    localStorage.setItem("qp_city", JSON.stringify({ name: detectedCity, lat: detectedLat, lon: detectedLon }));
    map.setView([detectedLat, detectedLon], 13);
    document.getElementById("city-modal").style.display = "none";
    addBotMessage("Привет! Я AI-урбанист\n\nГород: " + detectedCity + "\n\nВыделите область → «Анализировать»");
}
function skipCity() {
    clearTimeout(cityInitTimeout);
    localStorage.setItem("qp_city", JSON.stringify({ name: "Москва", lat: 55.7558, lon: 37.6173 }));
    map.setView([55.7558, 37.6173], 13);
    document.getElementById("city-modal").style.display = "none";
    addBotMessage("Привет! Выделите область на карте.");
}
async function searchAndGoCity() {
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
    confirmCity();
}
initCity();

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

// ========== ANALYZE ==========
async function analyzeArea() {
    if (!state.bbox) return;
    const btn = document.getElementById("analyze-btn");
    btn.disabled = true; btn.innerHTML = '<i data-lucide="loader"></i> Анализ...';
    lucide.createIcons();
    state.reportCache = null;
    state.scrapedData = []; state.scrapeRunId = null;
    if (state.scrapedMarkersLayer) { map.removeLayer(state.scrapedMarkersLayer); state.scrapedMarkersLayer = null; }
    trackRequest();
    try {
        const r = await fetch("/api/analyze", {
            method: "POST", headers: { "Content-Type": "application/json" },
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
        const totalCount = data.scores.total_places;
        const hiddenCount = totalCount - namedCount;
        let msg = "✓ Индекс: " + data.scores.overall + "/100\nИменованных мест: " + namedCount;
        if (hiddenCount > 0) msg += "\n(скрыто " + hiddenCount + " безымянных)";
        msg += "\n\nКликайте по метрикам слева для фильтра\nНажмите «Парсить отзывы» для данных с Яндекс.Карт";
        addBotMessage(msg);
        document.getElementById("report-btn").style.display = "inline-flex";
        document.getElementById("scrape-btn").style.display = "inline-flex";
        document.getElementById("quick-questions").style.display = "flex";
    } catch (e) { addBotMessage("✗ " + e.message); }
    finally {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="activity"></i> Анализировать';
        lucide.createIcons();
    }
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
        if (!isInsideDrawn(o.lat, o.lon)) return; // ФИЛЬТР по области
        if (state.activeFilter && state.activeFilter !== "Разнообразие") {
            if (!(CAT_MAP[state.activeFilter] || []).includes(o.amenity)) return;
        }
        const color = state.activeFilter ? (CAT_COLORS[state.activeFilter] || "#7c5cff") : "#7c5cff";
        L.circleMarker([o.lat, o.lon], { radius: 5, color, fillColor: color, fillOpacity: 0.85, weight: 1 })
            .bindTooltip(o.name + " (" + o.amenity + ")").addTo(state.markersLayer);
    });
    state.markersLayer.addTo(map);
}

// Проверка: точка внутри нарисованной области?
function isInsideDrawn(lat, lon) {
    if (!state.drawnLayer) return true;
    const pt = L.latLng(lat, lon);
    // Для прямоугольника
    if (state.drawnLayer.getBounds && !state.drawnLayer.getLatLngs) {
        return state.drawnLayer.getBounds().contains(pt);
    }
    // Для полигона — ray casting
    const latlngs = state.drawnLayer.getLatLngs()[0] || state.drawnLayer.getLatLngs();
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

// ========== REPORT ==========
async function generateReport() {
    const btn = document.getElementById("report-btn");
    if (state.reportCache) {
        document.getElementById("report-text").innerHTML = markdownToHtml(state.reportCache);
        renderCharts();
        document.getElementById("report-modal").style.display = "flex";
        return;
    }
    btn.disabled = true; btn.innerHTML = '<i data-lucide="loader"></i> Генерация...'; lucide.createIcons();
    trackRequest();
    try {
        const r = await fetch("/api/report", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ org_text: state.orgText, scores: state.scores, scraped_data: state.scrapedData || [] })
        });
        if (!r.ok) { addBotMessage("✗ Ошибка " + r.status); return; }
        const data = await r.json();
        if (!data.report) { addBotMessage("✗ Пустой ответ"); return; }
        state.reportCache = data.report;
        document.getElementById("report-text").innerHTML = markdownToHtml(data.report);
        renderCharts();
        document.getElementById("report-modal").style.display = "flex";
    } catch (e) { addBotMessage("✗ " + e.message); }
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

// ========== SCRAPER ==========
let scrapingPollInterval = null;
function openScrapeModal() {
    if (!state.bbox) { addBotMessage("⚠ Сначала выделите область"); return; }
    const cats = ["Еда", "Здоровье", "Шопинг", "Красота", "Спорт", "Образование", "Досуг", "Авто", "Финансы", "Услуги"];
    let html = '<button class="modal-close" onclick="closeProfile()">×</button>';
    html += '<h2>Парсинг отзывов</h2><p>Реальные заведения с Яндекс.Карт</p>';
    html += '<div style="text-align:left;background:var(--secondary);padding:12px;border-radius:10px;margin-bottom:12px">';
    cats.forEach((c, i) => {
        html += '<label style="display:flex;align-items:center;padding:4px 0;cursor:pointer;font-size:13px">';
        html += '<input type="checkbox" name="scrape-cat" value="' + c + '" ' + (i < 3 ? 'checked' : '') + ' style="margin-right:10px"> ' + c + '</label>';
    });
    html += '</div>';
    html += '<label style="display:flex;align-items:center;padding:10px;background:var(--primary-soft);border-radius:10px;margin-bottom:12px;cursor:pointer">';
    html += '<input type="checkbox" id="enrich-data" style="margin-right:10px">';
    html += '<span style="text-align:left"><b>AI-анализ отзывов</b><br><span style="font-size:11px;color:var(--muted-fg)">Дольше, но отчёт детальнее</span></span></label>';
    html += '<button class="btn-primary" onclick="startScraping()">Запустить</button>';
    document.getElementById("profile-content").innerHTML = html;
    document.getElementById("profile-modal").style.display = "flex";
}
async function startScraping() {
    const checked = Array.from(document.querySelectorAll('input[name="scrape-cat"]:checked')).map(x => x.value);
    if (checked.length === 0) { alert("Выберите категорию"); return; }
    const enrich = document.getElementById("enrich-data")?.checked || false;
    closeProfile();
    addBotMessage(enrich ? "🔄 AI-анализ отзывов запущен (5-10 мин)" : "🔄 Парсинг запущен (1-3 мин)");
    try {
        const r = await fetch("/api/scrape/start", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bbox: state.bbox, categories: checked, max_results: enrich ? 60 : 100, enrich_data: enrich })
        });
        const d = await r.json();
        if (!d.run_id) { addBotMessage("✗ Ошибка: " + (d.detail || "unknown")); return; }
        state.scrapeRunId = d.run_id; state.scrapeEnriched = enrich;
        pollScrapeStatus(d.run_id);
    } catch (e) { addBotMessage("✗ " + e.message); }
}
function pollScrapeStatus(runId) {
    let attempts = 0;
    const max = state.scrapeEnriched ? 80 : 36;
    if (scrapingPollInterval) clearInterval(scrapingPollInterval);
    scrapingPollInterval = setInterval(async () => {
        attempts++;
        if (attempts > max) { clearInterval(scrapingPollInterval); addBotMessage("⏱ Таймаут"); return; }
        try {
            const r = await fetch("/api/scrape/status/" + runId);
            const d = await r.json();
            if (d.status === "SUCCEEDED") {
                clearInterval(scrapingPollInterval);
                state.scrapedData = d.data || [];
                state.reportCache = null;
                renderScrapedMarkers();
                let msg = "✓ Готово! " + (d.total || 0) + " заведений";
                if (d.with_summary) msg += " (AI-саммари: " + d.with_summary + ")";
                msg += "\n\nОткройте отчёт — теперь он с конкретикой по местам.";
                addBotMessage(msg);
            } else if (["FAILED", "ABORTED", "TIMED-OUT"].includes(d.status)) {
                clearInterval(scrapingPollInterval);
                addBotMessage("✗ " + d.status);
            } else {
                if (attempts === 3) addBotMessage("⏳ Парсим...");
                if (attempts === 12) addBotMessage("⏳ Ещё парсим...");
                if (attempts === 30) addBotMessage("⏳ AI обрабатывает...");
            }
        } catch (e) {}
    }, 10000);
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
        const r = await fetch("/api/chat", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question: t, org_text: state.orgText, scores: state.scores, history: state.chatHistory.slice(-6) })
        });
        const d = await r.json();
        removeLoading(); addBotMessage(d.answer);
    } catch (e) { removeLoading(); addBotMessage("✗ " + e.message); }
    finally { setChatBusy(false); }
}
async function askQuick(q) {
    if (!q || state.chatBusy) return;
    setChatBusy(true); addUserMessage(q); addLoading(); trackRequest();
    try {
        const r = await fetch("/api/chat", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question: q, org_text: state.orgText, scores: state.scores, history: state.chatHistory.slice(-6) })
        });
        const d = await r.json();
        removeLoading(); addBotMessage(d.answer);
    } catch (e) { removeLoading(); addBotMessage("✗ " + e.message); }
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

// Re-render lucide icons after dynamic changes
setTimeout(() => lucide.createIcons(), 100);
