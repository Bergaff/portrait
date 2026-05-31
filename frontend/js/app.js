// ========== SUPABASE ==========
// ========== ВЕРСИЯ ==========
const APP_VERSION = "0.022";

// ========== SUPABASE ==========
const { createClient } = supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
        detectSessionInUrl: true,
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true
    }
});
let currentUser = null;
let userStats = { requests: 0 };

// Проверяем сессию при загрузке
async function initAuth() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
        currentUser = session.user;
        updateAuthUI(session.user);
        loadUserStats();
    } else {
        updateAuthUILoggedOut();
    }
}

supabaseClient.auth.onAuthStateChange((event, session) => {
    console.log("Auth event:", event, session);
    if (session && session.user) {
        currentUser = session.user;
        updateAuthUI(session.user);
        document.getElementById("auth-modal").style.display = "none";
        loadUserStats();
    } else {
        currentUser = null;
        updateAuthUILoggedOut();
    }
});

initAuth();

function updateAuthUI(user) {
    document.getElementById("auth-btn").style.display = "none";
    document.getElementById("user-info").style.display = "flex";
}
function updateAuthUILoggedOut() {
    document.getElementById("auth-btn").style.display = "block";
    document.getElementById("user-info").style.display = "none";
}
async function socialLogin(provider) {
    showAuthError("Открываем " + provider + "...");
    const { error } = await supabaseClient.auth.signInWithOAuth({
        provider,
        options: {
            redirectTo: window.location.origin
        }
    });
    if (error) {
        showAuthError(error.message);
    }
}
// ========== ПРЯМАЯ АВТОРИЗАЦИЯ (ЯНДЕКС & MAIL.RU) ==========
const YANDEX_CLIENT_ID = "00a282071c984f6c8015bdbe0852a5b8";
const MAILRU_CLIENT_ID = "019e459104e27d97893914d68e0920e4";

function loginYandexDirect() {
    const redirectUri = window.location.origin + "/";
    const authUrl = "https://oauth.yandex.ru/authorize?response_type=token&client_id=" + YANDEX_CLIENT_ID + "&redirect_uri=" + encodeURIComponent(redirectUri) + "&state=yandex";
    window.location.href = authUrl;
}

function loginMailruDirect() {
    const redirectUri = window.location.origin + "/";
    const authUrl = "https://connect.mail.ru/oauth/authorize?client_id=" + MAILRU_CLIENT_ID +
        "&response_type=code&redirect_uri=" + encodeURIComponent(redirectUri) + "&state=mailru";
    window.location.href = authUrl;
}

// Единый обработчик возврата от провайдеров
function processOAuthCallback() {
    const searchParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.substring(1));

    // Mail.ru (code в search)
    const code = searchParams.get("code");
    const error = searchParams.get("error");

    if (error) {
        showAuthError("Ошибка авторизации: " + error);
        window.history.replaceState({}, document.title, window.location.pathname);
        return;
    }

    if (code && searchParams.get("state") === "mailru") {
        window.history.replaceState({}, document.title, window.location.pathname);
        showAuthError("Входим через Mail.ru...");
        fetch("/api/auth/mailru", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ access_token: "code_" + code })
        })
        .then(r => r.json())
        .then(data => {
            if (data.email && data.temp_password) {
                return supabaseClient.auth.signInWithPassword({
                    email: data.email, password: data.temp_password
                });
            } else { showAuthError("Ошибка: " + (data.detail || "неизвестная")); }
        })
        .then(() => window.location.reload())
        .catch(e => { console.error(e); showAuthError("Ошибка входа"); });
        return;
    }

    // Яндекс (token в hash)
    const accessToken = hashParams.get("access_token");
    const provider = hashParams.get("state");

    if (accessToken && provider === "yandex") {
        window.location.hash = "";
        showAuthError("Входим через Яндекс...");
        fetch("/api/auth/yandex", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ access_token: accessToken })
        })
        .then(r => r.json())
        .then(data => {
            if (data.email && data.temp_password) {
                return supabaseClient.auth.signInWithPassword({
                    email: data.email, password: data.temp_password
                });
            } else { showAuthError("Ошибка: " + (data.detail || "неизвестная")); }
        })
        .then(() => window.location.reload())
        .catch(e => { console.error(e); showAuthError("Ошибка входа"); });
    }
}

// Запускаем обработчик сразу
processOAuthCallback();
window.addEventListener("hashchange", processOAuthCallback);

async function emailSignIn() {
    const email = document.getElementById("auth-email").value.trim();
    const pw = document.getElementById("auth-password").value;
    if (!email || !pw) { showAuthError("Заполните поля"); return; }
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password: pw });
    if (error) showAuthError(translateError(error.message));
}
async function emailSignUp() {
    const email = document.getElementById("auth-email").value.trim();
    const pw = document.getElementById("auth-password").value;
    if (!email || !pw) { showAuthError("Заполните поля"); return; }
    if (pw.length < 6) { showAuthError("Минимум 6 символов"); return; }
    const { error } = await supabaseClient.auth.signUp({ email, password: pw });
    if (error) showAuthError(translateError(error.message));
    else showAuthError("✅ Проверьте почту!");
}
async function resetPassword() {
    const email = document.getElementById("auth-email").value.trim();
    if (!email) { showAuthError("Введите email"); return; }
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email);
    if (error) showAuthError(error.message); else showAuthError("✅ Письмо отправлено");
}
function translateError(msg) {
    if (msg.includes("rate limit")) return "Подождите час";
    if (msg.includes("Invalid login")) return "Неверный email/пароль";
    if (msg.includes("already registered")) return "Email занят";
    return msg;
}
function confirmSignOut() { document.getElementById("confirm-modal").style.display = "flex"; }
function closeConfirm() { document.getElementById("confirm-modal").style.display = "none"; }
async function doSignOut() { closeConfirm(); await supabaseClient.auth.signOut(); }
function showAuthError(msg) { const el = document.getElementById("auth-error"); if (el) el.textContent = msg; }
function toggleAuth() {
    const m = document.getElementById("auth-modal");
    m.style.display = m.style.display === "none" ? "flex" : "none";
    showAuthError("");
}

// ========== ПРОФИЛЬ ==========
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
    let h = '<div class="profile-section">';
    h += '<div class="profile-row"><span class="profile-label">Email:</span><span class="profile-value">'+(currentUser.email||"—")+'</span></div>';
    h += '<div class="profile-row"><span class="profile-label">Вход:</span><span class="profile-value" style="text-transform:capitalize;">'+p+'</span></div>';
    h += '<div class="profile-row"><span class="profile-label">Дата:</span><span class="profile-value">'+d+'</span></div>';
    h += '<div class="profile-row"><span class="profile-label">Запросов:</span><span class="profile-value">'+userStats.requests+'</span></div>';
    h += '</div><div class="profile-subscription">';
    h += '<div class="sub-badge sub-free">Бесплатный план</div>';
    h += '<button class="btn-primary" style="margin:12px 0 0;padding:10px 20px;font-size:13px;" onclick="upgradeToPro()">⭐ PRO</button>';
    h += '</div>';
    document.getElementById("profile-content").innerHTML = h;
    document.getElementById("profile-modal").style.display = "flex";
}
function closeProfile() { document.getElementById("profile-modal").style.display = "none"; }
function upgradeToPro() { alert("Скоро!"); }

// ========== СОСТОЯНИЕ ==========
let state = {
    bbox:null, organizations:[], scores:{}, categories:{}, orgText:"",
    chatHistory:[], heatLayer:null, markersLayer:null,
    pieChart:null, barChart:null, radarChart:null,
    activeFilter:null, reportCache:null, chatBusy:false
};

// ========== RESIZER ЧАТА ==========
let isResizing = false;
const resizer = document.getElementById("resizer");
const chatPanel = document.getElementById("chat-panel");

resizer.addEventListener("mousedown", (e) => {
    isResizing = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
    resizer.classList.add("active");
});

document.addEventListener("mousemove", (e) => {
    if (!isResizing) return;
    const appWidth = document.getElementById("app").offsetWidth;
    let newWidth = appWidth - e.clientX;
    newWidth = Math.max(380, Math.min(760, newWidth)); // от 380 до 760px
    chatPanel.style.width = newWidth + "px";
    chatPanel.style.minWidth = newWidth + "px";
});

document.addEventListener("mouseup", () => {
    if (isResizing) {
        isResizing = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        resizer.classList.remove("active");
    }
});

// ========== КАРТА ==========
const map = L.map("map").setView([55.7558, 37.6173], 13);
L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: "OpenStreetMap, CARTO", maxZoom: 19
}).addTo(map);
const drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);
const drawControl = new L.Control.Draw({
    draw: {
        polyline:false, circle:false, circlemarker:false, marker:false,
        polygon:{shapeOptions:{color:"#667eea",fillOpacity:0.15,weight:2}},
        rectangle:{shapeOptions:{color:"#667eea",fillOpacity:0.15,weight:2}}
    },
    edit:{featureGroup:drawnItems}
});
map.addControl(drawControl);
map.on("draw:created", function(e) {
    drawnItems.clearLayers(); drawnItems.addLayer(e.layer);
    const b = e.layer.getBounds();
    state.bbox = b.getSouth()+","+b.getWest()+","+b.getNorth()+","+b.getEast();
    document.getElementById("analyze-btn").style.display = "block";
    state.reportCache = null;
});

// ========== ГОРОД — запоминаем в localStorage ==========
// ========== ГОРОД — запоминаем в localStorage ==========
let detectedCity = "", detectedLat = 55.7558, detectedLon = 37.6173;
let cityInitTimeout = null;

function initCity() {
    const saved = localStorage.getItem("qp_city");
    if (saved) {
        const data = JSON.parse(saved);
        map.setView([data.lat, data.lon], 13);
        document.getElementById("city-modal").style.display = "none";
        addBotMessage("Привет! Я AI-урбанист 🏘️\n\nГород: " + data.name + "\n\n📍 Выделите область на карте (квадрат или полигон)\n📊 Нажмите «Анализировать»\n🎯 Кликайте по категориям для фильтра на карте");
        return;
    }

    document.getElementById("city-modal").style.display = "flex";

    // Устанавливаем таймаут на 15 секунд - если не определили город, показываем кнопку "Пропустить"
    cityInitTimeout = setTimeout(() => {
        if (!detectedCity) {
            showCityInput(); // Показываем ввод города, если не удалось определить
        }
    }, 15000);

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                try {
                    const r = await fetch(
                        "https://nominatim.openstreetmap.org/reverse?lat="+pos.coords.latitude+"&lon="+pos.coords.longitude+"&format=json&accept-language=ru",
                        {headers:{"User-Agent":"QuarterPortrait/1.0"}}
                    );
                    const d = await r.json();
                    const city = d.address?.city || d.address?.town || d.address?.village || "Ваш город";
                    clearTimeout(cityInitTimeout);
                    showCityConfirm(city, pos.coords.latitude, pos.coords.longitude);
                } catch(e) {
                    clearTimeout(cityInitTimeout);
                    detectByIP();
                }
            },
            () => {
                clearTimeout(cityInitTimeout);
                detectByIP();
            },
            {timeout: 8000}
        );
    } else {
        detectByIP();
    }
}

async function detectByIP() {
    try {
        const r = await fetch("https://ipapi.co/json/");
        if (r.ok) {
            const d = await r.json();
            if (d.city && d.latitude) {
                clearTimeout(cityInitTimeout);
                showCityConfirm(d.city, d.latitude, d.longitude);
                return;
            }
        }
    } catch(e) {}
    clearTimeout(cityInitTimeout);
    showCityInput();
}

function showCityConfirm(city, lat, lon) {
    detectedCity = city; detectedLat = lat; detectedLon = lon;
    document.getElementById("city-detecting").style.display = "none";
    document.getElementById("city-name-show").textContent = city;
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
    localStorage.setItem("qp_city", JSON.stringify({name:detectedCity, lat:detectedLat, lon:detectedLon}));
    map.setView([detectedLat, detectedLon], 13);
    document.getElementById("city-modal").style.display = "none";
    addBotMessage("Привет! Я AI-урбанист 🏘️\n\nГород: " + detectedCity + "\n\n📍 Выделите область на карте (квадрат или полигон)\n📊 Нажмите «Анализировать»\n🎯 Кликайте по категориям для фильтра на карте");
}

function skipCity() {
    clearTimeout(cityInitTimeout);
    localStorage.setItem("qp_city", JSON.stringify({name:"Москва", lat:55.7558, lon:37.6173}));
    map.setView([55.7558, 37.6173], 13);
    document.getElementById("city-modal").style.display = "none";
    addBotMessage("Привет! Я AI-урбанист 🏘️\n\n📍 Выделите область на карте\n📊 Нажмите «Анализировать»\n🎯 Кликайте по категориям для фильтра");
}
async function searchAndGoCity() {
    const q = document.getElementById("city-input").value.trim();
    if (!q) return;
    try {
        const r = await fetch("/api/search?q=" + encodeURIComponent(q));
        const data = await r.json();
        if (data.results?.length > 0) {
            detectedLat = data.results[0].lat;
            detectedLon = data.results[0].lon;
            detectedCity = data.results[0].display_name.split(",")[0];
        }
    } catch(e) {}
    confirmCity();
}
initCity();

// ========== ПОИСК ==========
let searchTimeout;
document.getElementById("search-input").addEventListener("input", function(e) {
    clearTimeout(searchTimeout);
    const q = e.target.value.trim();
    if (q.length < 2) { document.getElementById("search-results").innerHTML = ""; return; }
    searchTimeout = setTimeout(async () => {
        try {
            const r = await fetch("/api/search?q=" + encodeURIComponent(q));
            const data = await r.json();
            const c = document.getElementById("search-results");
            c.innerHTML = "";
            if (!data.results?.length) { c.innerHTML='<div class="search-item" style="color:#666">Не найдено</div>'; return; }
            data.results.forEach(item => {
                const div = document.createElement("div");
                div.className = "search-item";
                div.textContent = item.display_name.substring(0, 70);
                div.onclick = () => { map.setView([item.lat, item.lon], 16); c.innerHTML=""; document.getElementById("search-input").value=item.display_name.substring(0,50); };
                c.appendChild(div);
            });
        } catch(e) {}
    }, 400);
});

// ========== АНАЛИЗ ==========
async function analyzeArea() {
    if (!state.bbox) return;
    const btn = document.getElementById("analyze-btn");
    btn.disabled=true; btn.textContent="Анализируем...";
    state.reportCache=null; trackRequest();
    try {
        const r = await fetch("/api/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({bbox:state.bbox})});
        const data = await r.json();
        if (data.error) { addBotMessage("⚠️ " + data.error); return; }
        state.organizations=data.organizations; state.scores=data.scores;
        state.categories=data.categories; state.orgText=data.org_text; state.activeFilter=null;
        if (state.heatLayer) map.removeLayer(state.heatLayer);
        if (data.organizations.length > 0) {
            state.heatLayer = L.heatLayer(data.organizations.map(o=>[o.lat,o.lon,1]),{radius:20,blur:15,gradient:{0.2:"#667eea",0.5:"#764ba2",0.7:"#f093fb",1:"#f5576c"}}).addTo(map);
        }
        renderFilteredMarkers(); showScores(data.scores);
        addBotMessage("✅ Индекс: "+data.scores.overall+"/100\nНайдено "+data.scores.total_places+" мест\n\n🎯 Кликайте по категориям слева для фильтра");
        document.getElementById("report-btn").style.display="block";
        document.getElementById("quick-questions").style.display="flex";
    } catch(e) { addBotMessage("❌ "+e.message); }
    finally { btn.disabled=false; btn.textContent="Анализировать район"; }
}

// ========== ФИЛЬТРЫ ==========
const CAT_MAP = {
    "Еда":["cafe","restaurant","fast_food","bar","pub","ice_cream"],
    "Здоровье":["pharmacy","clinic","dentist","hospital","doctors","veterinary","optician"],
    "Шопинг":["clothes","supermarket","convenience","electronics","mobile_phone","shoes","books","gift","florist","jewelry","kiosk"],
    "Красота":["beauty","hairdresser","massage","nail_salon","tattoo"],
    "Спорт":["gym","fitness_centre","sports_centre","swimming_pool","yoga","dance"],
    "Образование":["school","kindergarten","university","library","college","language_school"],
    "Досуг":["cinema","theatre","museum","playground","nightclub","arts_centre","park"],
    "Авто":["car_repair","car_wash","fuel","parking"],
    "Финансы":["bank","atm","bureau_de_change"],
    "Услуги":["laundry","dry_cleaning","tailor","locksmith","post_office"],
    "Разнообразие":[]
};
const CAT_COLORS = {
    "Еда":"#feca57","Здоровье":"#ff6b6b","Шопинг":"#48dbfb","Красота":"#f093fb",
    "Спорт":"#1dd1a1","Образование":"#54a0ff","Досуг":"#a29bfe","Авто":"#fd9644",
    "Финансы":"#20bf6b","Услуги":"#778ca3","Разнообразие":"#667eea"
};
function toggleFilter(cat) { state.activeFilter=(state.activeFilter===cat)?null:cat; renderFilteredMarkers(); showScores(state.scores); }
function renderFilteredMarkers() {
    if (state.markersLayer) map.removeLayer(state.markersLayer);
    state.markersLayer = L.layerGroup();
    state.organizations.forEach(o => {
        if (state.activeFilter && state.activeFilter!=="Разнообразие") {
            if (!(CAT_MAP[state.activeFilter]||[]).includes(o.amenity)) return;
        }
        const color = state.activeFilter?(CAT_COLORS[state.activeFilter]||"#667eea"):"#667eea";
        L.circleMarker([o.lat,o.lon],{radius:5,color,fillColor:color,fillOpacity:0.85,weight:1}).bindTooltip(o.name+" ("+o.amenity+")").addTo(state.markersLayer);
    });
    state.markersLayer.addTo(map);
}

// ========== МЕТРИКИ ==========
function showScores(s) {
    const panel = document.getElementById("scores-panel");
    panel.style.display = "block";
    const metrics = [
        {label:"Еда",value:s.food},{label:"Здоровье",value:s.health},
        {label:"Шопинг",value:s.shopping},{label:"Спорт",value:s.sport},
        {label:"Образование",value:s.education},{label:"Досуг",value:s.entertainment},
        {label:"Разнообразие",value:s.diversity}
    ];
    let html = '<div class="score-badge"><div class="score-big">'+s.overall+'/100</div><div class="score-sub">ИНДЕКС РАЙОНА</div></div>';
    if (state.activeFilter) html+='<div style="text-align:center;font-size:11px;color:#667eea;margin-bottom:6px;">Фильтр: '+state.activeFilter+'</div>';
    metrics.forEach(m => {
        const color=m.value>=60?"#4CAF50":m.value>=30?"#FFC107":"#f44336";
        const active=state.activeFilter===m.label;
        html+='<div class="metric" style="cursor:pointer;padding:6px;'+(active?"background:rgba(102,126,234,0.15);border-radius:6px;":"")+'" onclick="toggleFilter(\''+m.label+'\')">';
        html+='<span style="width:8px;height:8px;border-radius:50%;background:'+(CAT_COLORS[m.label]||"#667eea")+';margin-right:6px;display:inline-block;"></span>';
        html+='<span class="metric-label" style="'+(active?"color:#fff;font-weight:600;":"")+'">'+m.label+'</span>';
        html+='<div class="metric-bar-bg"><div class="metric-bar-fill" style="width:'+m.value+'%;background:'+color+'"></div></div>';
        html+='<span class="metric-value">'+m.value+'</span></div>';
    });
    panel.innerHTML = html;
}

// ========== ОТЧЁТ ==========
async function generateReport() {
    const btn=document.getElementById("report-btn");
    if (state.reportCache) { document.getElementById("report-text").innerHTML=markdownToHtml(state.reportCache); renderCharts(); document.getElementById("report-modal").style.display="flex"; return; }
    btn.disabled=true; btn.textContent="Генерируем..."; trackRequest();
    try {
        const r=await fetch("/api/report",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({org_text:state.orgText,scores:state.scores})});
        if (!r.ok) { addBotMessage("❌ Ошибка "+r.status); return; }
        const data=await r.json();
        if (!data.report) { addBotMessage("❌ Пустой ответ"); return; }
        state.reportCache=data.report;
        document.getElementById("report-text").innerHTML=markdownToHtml(data.report);
        renderCharts(); document.getElementById("report-modal").style.display="flex";
    } catch(e) { addBotMessage("❌ "+e.message); }
    finally { btn.disabled=false; btn.textContent="Полный отчёт"; }
}
function renderCharts() {
    const cats=state.categories, s=state.scores;
    const colors=["#667eea","#764ba2","#f093fb","#f5576c","#feca57","#48dbfb","#ff9ff3","#54a0ff","#1dd1a1","#fd9644","#20bf6b","#778ca3","#a29bfe","#01a3a4"];
    if (state.pieChart) state.pieChart.destroy();
    state.pieChart = new Chart(document.getElementById("pieChart").getContext("2d"),{type:"doughnut",data:{labels:Object.keys(cats),datasets:[{data:Object.values(cats),backgroundColor:colors,borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:"right",labels:{color:"#ccc",font:{size:10}}}}}});
    const bl=["Еда","Здоровье","Шопинг","Спорт","Образование","Досуг","Разнообразие"];
    const bv=[s.food,s.health,s.shopping,s.sport,s.education,s.entertainment,s.diversity];
    if (state.barChart) state.barChart.destroy();
    state.barChart = new Chart(document.getElementById("barChart").getContext("2d"),{type:"bar",data:{labels:bl,datasets:[{data:bv,backgroundColor:colors,borderRadius:4}]},options:{indexAxis:"y",responsive:true,maintainAspectRatio:false,scales:{x:{max:100,ticks:{color:"#888"}},y:{ticks:{color:"#ccc"}}},plugins:{legend:{display:false}}}});
    if (state.radarChart) state.radarChart.destroy();
    state.radarChart = new Chart(document.getElementById("radarChart").getContext("2d"),{type:"radar",data:{labels:bl,datasets:[{label:"Район",data:bv,backgroundColor:"rgba(102,126,234,0.2)",borderColor:"#667eea",borderWidth:2,pointBackgroundColor:"#667eea",pointRadius:3}]},options:{responsive:true,maintainAspectRatio:false,scales:{r:{min:0,max:100,ticks:{color:"#666",backdropColor:"transparent"}}},plugins:{legend:{display:false}}}});
}
function closeReport() { document.getElementById("report-modal").style.display="none"; }

// ========== PDF ==========
async function exportPDF() {
    const btn=document.getElementById("pdf-btn"); btn.disabled=true; btn.textContent="PDF...";
    try {
        const el=document.getElementById("report-export-area");
        el.style.maxHeight="none"; el.style.overflow="visible";
        await new Promise(r=>setTimeout(r,200));
        const canvas=await html2canvas(el,{scale:1.5,backgroundColor:"#1e1e36",useCORS:true});
        el.style.maxHeight="85vh"; el.style.overflow="auto";
        const pdf=new jspdf.jsPDF("p","mm","a4");
        const w=210,m=8,cw=w-m*2;
        const px=canvas.width/cw, ph=(297-m*2)*px;
        const pages=Math.ceil(canvas.height/ph);
        for (let i=0;i<pages;i++) {
            if (i>0) pdf.addPage();
            const pc=document.createElement("canvas"); pc.width=canvas.width; pc.height=Math.min(ph,canvas.height-i*ph);
            pc.getContext("2d").drawImage(canvas,0,i*ph,canvas.width,pc.height,0,0,canvas.width,pc.height);
            pdf.addImage(pc.toDataURL("image/jpeg",0.92),"JPEG",m,m,cw,pc.height/px);
            pdf.setFontSize(8); pdf.setTextColor(120);
            pdf.text("Портрет квартала • "+(i+1)+"/"+pages,105,292,{align:"center"});
        }
        pdf.save("quarter-report.pdf");
    } catch(e) { addBotMessage("❌ PDF: "+e.message); }
    finally { btn.disabled=false; btn.textContent="📄 PDF"; }
}

// ========== ЧАТ ==========
function addBotMessage(t) { state.chatHistory.push({role:"assistant",content:t}); const c=document.getElementById("chat-messages"); const d=document.createElement("div"); d.className="message msg-assistant"; d.innerHTML=markdownToHtml(t); c.appendChild(d); c.scrollTop=c.scrollHeight; }
function addUserMessage(t) { state.chatHistory.push({role:"user",content:t}); const c=document.getElementById("chat-messages"); const d=document.createElement("div"); d.className="message msg-user"; d.textContent=t; c.appendChild(d); c.scrollTop=c.scrollHeight; }
function addLoading() { removeLoading(); const c=document.getElementById("chat-messages"); const d=document.createElement("div"); d.className="message msg-loading"; d.id="loading-msg"; d.innerHTML='<div class="dot"></div><div class="dot"></div><div class="dot"></div>'; c.appendChild(d); c.scrollTop=c.scrollHeight; }
function removeLoading() { const el=document.getElementById("loading-msg"); if(el) el.remove(); }
function setChatBusy(b) { state.chatBusy=b; document.querySelectorAll(".btn-quick").forEach(x=>{x.disabled=b;x.style.opacity=b?"0.4":"1";}); const s=document.getElementById("send-btn"); if(s) s.disabled=b; }
async function sendMessage() {
    if(state.chatBusy) return;
    const i=document.getElementById("chat-input"), t=i.value.trim(); if(!t) return;
    i.value=""; setChatBusy(true); addUserMessage(t); addLoading(); trackRequest();
    try { const r=await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({question:t,org_text:state.orgText,scores:state.scores,history:state.chatHistory.slice(-6)})}); const d=await r.json(); removeLoading(); addBotMessage(d.answer); }
    catch(e) { removeLoading(); addBotMessage("❌ "+e.message); }
    finally { setChatBusy(false); }
}
async function askQuick(q) {
    if(!q||state.chatBusy) return;
    setChatBusy(true); addUserMessage(q); addLoading(); trackRequest();
    try { const r=await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({question:q,org_text:state.orgText,scores:state.scores,history:state.chatHistory.slice(-6)})}); const d=await r.json(); removeLoading(); addBotMessage(d.answer); }
    catch(e) { removeLoading(); addBotMessage("❌ "+e.message); }
    finally { setChatBusy(false); }
}
document.getElementById("chat-input").addEventListener("keypress", e=>{ if(e.key==="Enter"&&!state.chatBusy) sendMessage(); });
document.addEventListener("click", e=>{ if(!e.target.closest(".search-box")) document.getElementById("search-results").innerHTML=""; });
function markdownToHtml(t) { if(!t) return ""; return t.replace(/^## (.+)$/gm,"<h2>$1</h2>").replace(/\*\*(.*?)\*\*/g,"<strong>$1</strong>").replace(/\*(.*?)\*/g,"<em>$1</em>").replace(/\n/g,"<br>"); }
