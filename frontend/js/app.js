// ========== SUPABASE ==========
const { createClient } = supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);
let currentUser = null;

supabaseClient.auth.getSession().then(({ data: { session } }) => {
    if (session) { currentUser = session.user; updateAuthUI(session.user); }
});
supabaseClient.auth.onAuthStateChange((event, session) => {
    if (session) {
        currentUser = session.user;
        updateAuthUI(session.user);
        document.getElementById("auth-modal").style.display = "none";
    } else {
        currentUser = null;
        updateAuthUILoggedOut();
    }
});
function updateAuthUI(user) {
    document.getElementById("auth-btn").style.display = "none";
    document.getElementById("user-info").style.display = "flex";
    const email = user.email || user.user_metadata?.full_name || "Пользователь";
    document.getElementById("user-email-short").textContent =
        email.substring(0, 16) + (email.length > 16 ? "..." : "");
}
function updateAuthUILoggedOut() {
    document.getElementById("auth-btn").style.display = "block";
    document.getElementById("user-info").style.display = "none";
}
async function socialLogin(provider) {
    showAuthError("Открываем " + provider + "...");
    const { error } = await supabaseClient.auth.signInWithOAuth({
        provider: provider,
        options: { redirectTo: window.location.origin }
    });
    if (error) showAuthError(error.message);
}
async function emailSignIn() {
    const email = document.getElementById("auth-email").value.trim();
    const password = document.getElementById("auth-password").value;
    if (!email || !password) { showAuthError("Заполните email и пароль"); return; }
    showAuthError("Входим...");
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) showAuthError(error.message);
}
async function emailSignUp() {
    const email = document.getElementById("auth-email").value.trim();
    const password = document.getElementById("auth-password").value;
    if (!email || !password) { showAuthError("Заполните email и пароль"); return; }
    if (password.length < 6) { showAuthError("Пароль минимум 6 символов"); return; }
    showAuthError("Регистрируем...");
    const { error } = await supabaseClient.auth.signUp({ email, password });
    if (error) showAuthError(error.message);
    else showAuthError("✅ Проверьте почту!");
}
async function resetPassword() {
    const email = document.getElementById("auth-email").value.trim();
    if (!email) { showAuthError("Введите email"); return; }
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email);
    if (error) showAuthError(error.message);
    else showAuthError("✅ Письмо отправлено на " + email);
}
async function signOut() { await supabaseClient.auth.signOut(); }
function showAuthError(msg) {
    const el = document.getElementById("auth-error");
    if (el) el.textContent = msg;
}
function toggleAuth() {
    const m = document.getElementById("auth-modal");
    m.style.display = m.style.display === "none" ? "flex" : "none";
    showAuthError("");
}

// ========== СОСТОЯНИЕ ==========
let state = {
    bbox: null, organizations: [], scores: {}, categories: {},
    orgText: "", chatHistory: [], heatLayer: null, markersLayer: null,
    pieChart: null, barChart: null, radarChart: null,
    activeFilter: null, reportCache: null, chatBusy: false
};

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
        polygon: { shapeOptions: {color:"#667eea",fillOpacity:0.15,weight:2} },
        rectangle: { shapeOptions: {color:"#667eea",fillOpacity:0.15,weight:2} }
    },
    edit: { featureGroup: drawnItems }
});
map.addControl(drawControl);
map.on("draw:created", function(e) {
    drawnItems.clearLayers();
    drawnItems.addLayer(e.layer);
    const b = e.layer.getBounds();
    state.bbox = b.getSouth()+","+b.getWest()+","+b.getNorth()+","+b.getEast();
    document.getElementById("analyze-btn").style.display = "block";
    state.reportCache = null;
});

// ========== СТАРТОВЫЙ ЭКРАН ГОРОДА ==========
let detectedCityName = "";
let detectedLat = 55.7558;
let detectedLon = 37.6173;

async function initCityModal() {
    // Сначала пробуем браузерный geolocation (самый точный)
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                const lat = pos.coords.latitude;
                const lon = pos.coords.longitude;
                // Обратное геокодирование через Nominatim
                try {
                    const r = await fetch(
                        "https://nominatim.openstreetmap.org/reverse?lat=" + lat + "&lon=" + lon + "&format=json&accept-language=ru",
                        { headers: { "User-Agent": "QuarterPortrait/1.0" } }
                    );
                    const d = await r.json();
                    const city = d.address?.city || d.address?.town || d.address?.village || d.address?.county || "Ваш город";
                    showCityConfirm(city, lat, lon);
                } catch(e) {
                    showCityConfirm("Ваш город", lat, lon);
                }
            },
            async () => {
                // Geolocation отклонён — пробуем IP
                await detectByIP();
            },
            { timeout: 8000 }
        );
    } else {
        await detectByIP();
    }
}

async function detectByIP() {
    // Запрашиваем IP с клиента (не с сервера)
    const apis = [
        "https://ipapi.co/json/",
        "https://ipwho.is/",
        "https://ip-api.com/json/?fields=city,lat,lon,country"
    ];
    for (const url of apis) {
        try {
            const r = await fetch(url);
            if (r.ok) {
                const d = await r.json();
                const city = d.city || d.City || "";
                const lat = parseFloat(d.latitude || d.lat || 0);
                const lon = parseFloat(d.longitude || d.lon || 0);
                if (city && lat && lon) {
                    showCityConfirm(city, lat, lon);
                    return;
                }
            }
        } catch(e) {}
    }
    // Ничего не сработало
    showCityInput();
}

function showCityConfirm(city, lat, lon) {
    detectedCityName = city;
    detectedLat = lat;
    detectedLon = lon;
    document.getElementById("city-detecting").style.display = "none";
    document.getElementById("city-name-show").textContent = city;
    document.getElementById("city-confirm").style.display = "block";
}

function showCityInput() {
    document.getElementById("city-detecting").style.display = "none";
    document.getElementById("city-confirm").style.display = "none";
    document.getElementById("city-input-block").style.display = "block";
    document.getElementById("city-input").focus();

    // Поиск по вводу
    const input = document.getElementById("city-input");
    let citySearchTimeout;
    input.addEventListener("input", function() {
        clearTimeout(citySearchTimeout);
        const q = this.value.trim();
        if (q.length < 2) { document.getElementById("city-search-results").innerHTML = ""; return; }
        citySearchTimeout = setTimeout(async () => {
            try {
                const r = await fetch("/api/search?q=" + encodeURIComponent(q));
                const data = await r.json();
                const c = document.getElementById("city-search-results");
                c.innerHTML = "";
                (data.results || []).slice(0, 4).forEach(item => {
                    const div = document.createElement("div");
                    div.className = "search-item";
                    div.textContent = item.display_name.substring(0, 60);
                    div.onclick = () => {
                        input.value = item.display_name.substring(0, 40);
                        detectedLat = item.lat;
                        detectedLon = item.lon;
                        detectedCityName = item.display_name.split(",")[0];
                        c.innerHTML = "";
                    };
                    c.appendChild(div);
                });
            } catch(e) {}
        }, 400);
    });
    input.addEventListener("keypress", function(e) {
        if (e.key === "Enter") searchAndGoCity();
    });
}

async function searchAndGoCity() {
    const q = document.getElementById("city-input").value.trim();
    if (!q) return;
    if (detectedLat && detectedLon && detectedCityName) {
        confirmCity();
        return;
    }
    try {
        const r = await fetch("/api/search?q=" + encodeURIComponent(q));
        const data = await r.json();
        if (data.results && data.results.length > 0) {
            const item = data.results[0];
            detectedLat = item.lat;
            detectedLon = item.lon;
            detectedCityName = item.display_name.split(",")[0];
        }
    } catch(e) {}
    confirmCity();
}

function confirmCity() {
    map.setView([detectedLat, detectedLon], 13);
    document.getElementById("city-modal").style.display = "none";
    addBotMessage("Привет! Я AI-урбанист. Город: " + detectedCityName + ". Выделите область на карте для анализа.");
}

function skipCity() {
    map.setView([55.7558, 37.6173], 13);
    document.getElementById("city-modal").style.display = "none";
    addBotMessage("Привет! Я AI-урбанист. Выделите область на карте для анализа.");
}

// Запускаем при старте
initCityModal();

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
            if (!data.results || data.results.length === 0) {
                c.innerHTML = '<div class="search-item" style="color:#666;cursor:default">Ничего не найдено</div>';
                return;
            }
            data.results.forEach(item => {
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
        } catch(err) { console.error("Search error:", err); }
    }, 400);
});

// ========== АНАЛИЗ ==========
async function analyzeArea() {
    if (!state.bbox) return;
    const btn = document.getElementById("analyze-btn");
    btn.disabled = true; btn.textContent = "Анализируем...";
    state.reportCache = null;
    try {
        const r = await fetch("/api/analyze", {
            method:"POST", headers:{"Content-Type":"application/json"},
            body: JSON.stringify({bbox: state.bbox})
        });
        const data = await r.json();
        if (data.error) { addBotMessage("⚠️ " + data.error); return; }
        state.organizations = data.organizations;
        state.scores = data.scores;
        state.categories = data.categories;
        state.orgText = data.org_text;
        state.activeFilter = null;
        if (state.heatLayer) map.removeLayer(state.heatLayer);
        if (data.organizations.length > 0) {
            state.heatLayer = L.heatLayer(
                data.organizations.map(o => [o.lat, o.lon, 1]),
                {radius:20,blur:15,gradient:{0.2:"#667eea",0.5:"#764ba2",0.7:"#f093fb",1:"#f5576c"}}
            ).addTo(map);
        }
        renderFilteredMarkers();
        showScores(data.scores);
        const s = data.scores;
        addBotMessage("✅ Готово! Индекс: " + s.overall + "/100\nНайдено " + s.total_places + " мест на " + s.area_km2 + " км²\n\nКликайте по категориям — фильтр на карте.");
        document.getElementById("report-btn").style.display = "block";
        document.getElementById("quick-questions").style.display = "flex";
    } catch(e) {
        addBotMessage("❌ Ошибка: " + e.message);
    } finally {
        btn.disabled = false; btn.textContent = "Анализировать район";
    }
}

// ========== ФИЛЬТРЫ ==========
const CAT_MAP = {
    "Еда":["cafe","restaurant","fast_food","bar","pub","food_court","biergarten"],
    "Здоровье":["pharmacy","clinic","dentist","doctors","hospital","veterinary"],
    "Шопинг":["clothes","shoes","supermarket","convenience","electronics","mobile_phone","books","gift","florist","jewelry","cosmetics"],
    "Спорт":["gym","fitness_centre","sports_centre","swimming_pool","yoga"],
    "Образование":["school","kindergarten","university","college","language_school","library"],
    "Досуг":["cinema","theatre","museum","playground","nightclub","arts_centre","escape_game"],
    "Разнообразие":[]
};
const CAT_COLORS = {
    "Еда":"#feca57","Здоровье":"#ff6b6b","Шопинг":"#48dbfb",
    "Спорт":"#1dd1a1","Образование":"#54a0ff","Досуг":"#f093fb","Разнообразие":"#667eea"
};
function toggleFilter(category) {
    state.activeFilter = (state.activeFilter === category) ? null : category;
    renderFilteredMarkers();
    showScores(state.scores);
}
function renderFilteredMarkers() {
    if (state.markersLayer) map.removeLayer(state.markersLayer);
    state.markersLayer = L.layerGroup();
    state.organizations.forEach(o => {
        if (state.activeFilter && state.activeFilter !== "Разнообразие") {
            const allowed = CAT_MAP[state.activeFilter] || [];
            if (!allowed.includes(o.amenity)) return;
        }
        const color = state.activeFilter ? (CAT_COLORS[state.activeFilter] || "#667eea") : "#667eea";
        L.circleMarker([o.lat, o.lon], {
            radius:5, color:color, fillColor:color, fillOpacity:0.85, weight:1
        }).bindTooltip(o.name + " (" + o.amenity + ")").addTo(state.markersLayer);
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
    if (state.activeFilter) {
        html += '<div style="text-align:center;font-size:11px;color:#667eea;margin-bottom:6px;padding:4px 8px;background:rgba(102,126,234,0.1);border-radius:6px;">Фильтр: <b>'+state.activeFilter+'</b> — нажмите снова для сброса</div>';
    }
    metrics.forEach(m => {
        const color = m.value>=60?"#4CAF50":m.value>=30?"#FFC107":"#f44336";
        const isActive = state.activeFilter === m.label;
        const dotColor = CAT_COLORS[m.label] || "#667eea";
        const activeBg = isActive ? "background:rgba(102,126,234,0.15);border-radius:8px;border:1px solid rgba(102,126,234,0.4);" : "";
        html += '<div class="metric" style="cursor:pointer;padding:6px 6px;margin:2px 0;'+activeBg+'" onclick="toggleFilter(\''+m.label+'\')" title="Фильтр: '+m.label+'">';
        html += '<span style="width:8px;height:8px;border-radius:50%;background:'+dotColor+';display:inline-block;margin-right:6px;flex-shrink:0;"></span>';
        html += '<span class="metric-label" style="'+(isActive?"color:#fff;font-weight:600;":"")+'">'+m.label+'</span>';
        html += '<div class="metric-bar-bg"><div class="metric-bar-fill" style="width:'+m.value+'%;background:'+color+'"></div></div>';
        html += '<span class="metric-value">'+m.value+'</span>';
        html += '</div>';
    });
    panel.innerHTML = html;
}

// ========== ОТЧЁТ ==========
async function generateReport() {
    const btn = document.getElementById("report-btn");
    if (state.reportCache) {
        document.getElementById("report-text").innerHTML = markdownToHtml(state.reportCache);
        renderCharts();
        document.getElementById("report-modal").style.display = "flex";
        return;
    }
    btn.disabled = true; btn.textContent = "Генерируем...";
    try {
        const r = await fetch("/api/report", {
            method:"POST", headers:{"Content-Type":"application/json"},
            body: JSON.stringify({org_text: state.orgText, scores: state.scores})
        });
        if (!r.ok) {
            const errText = await r.text();
            addBotMessage("❌ Ошибка сервера " + r.status + ": " + errText.substring(0,100));
            return;
        }
        const data = await r.json();
        if (!data.report) { addBotMessage("❌ Пустой ответ"); return; }
        state.reportCache = data.report;
        document.getElementById("report-text").innerHTML = markdownToHtml(data.report);
        renderCharts();
        document.getElementById("report-modal").style.display = "flex";
    } catch(e) {
        addBotMessage("❌ Ошибка отчёта: " + e.message);
    } finally {
        btn.disabled = false; btn.textContent = "Полный отчёт";
    }
}

function renderCharts() {
    const cats = state.categories;
    const catLabels = Object.keys(cats);
    const catValues = Object.values(cats);
    const colors = ["#667eea","#764ba2","#f093fb","#f5576c","#feca57","#48dbfb","#ff9ff3","#54a0ff","#5f27cd","#01a3a4"];
    if (state.pieChart) state.pieChart.destroy();
    state.pieChart = new Chart(document.getElementById("pieChart").getContext("2d"), {
        type:"doughnut",
        data:{labels:catLabels,datasets:[{data:catValues,backgroundColor:colors,borderWidth:0}]},
        options:{responsive:true,maintainAspectRatio:false,plugins:{
            legend:{position:"right",labels:{color:"#ccc",font:{size:11},padding:8}},
            title:{display:true,text:"Категории организаций",color:"#fff",font:{size:14}}
        }}
    });
    const s = state.scores;
    const barLabels = ["Еда","Здоровье","Шопинг","Спорт","Образование","Досуг","Разнообразие"];
    const barValues = [s.food,s.health,s.shopping,s.sport,s.education,s.entertainment,s.diversity];
    const barColors = ["#feca57","#ff6b6b","#48dbfb","#1dd1a1","#54a0ff","#f093fb","#667eea"];
    if (state.barChart) state.barChart.destroy();
    state.barChart = new Chart(document.getElementById("barChart").getContext("2d"), {
        type:"bar",
        data:{labels:barLabels,datasets:[{data:barValues,backgroundColor:barColors,borderWidth:0,borderRadius:4}]},
        options:{indexAxis:"y",responsive:true,maintainAspectRatio:false,
            scales:{x:{max:100,ticks:{color:"#888"},grid:{color:"rgba(255,255,255,0.05)"}},y:{ticks:{color:"#ccc"},grid:{display:false}}},
            plugins:{legend:{display:false},title:{display:true,text:"Оценки инфраструктуры",color:"#fff",font:{size:14}}}
        }
    });
    if (state.radarChart) state.radarChart.destroy();
    state.radarChart = new Chart(document.getElementById("radarChart").getContext("2d"), {
        type:"radar",
        data:{labels:barLabels,datasets:[
            {label:"Этот район",data:barValues,backgroundColor:"rgba(102,126,234,0.2)",borderColor:"#667eea",borderWidth:2,pointBackgroundColor:"#667eea",pointRadius:4},
            {label:"Среднее",data:[50,50,50,50,50,50,50],backgroundColor:"rgba(255,255,255,0.05)",borderColor:"rgba(255,255,255,0.3)",borderWidth:1,borderDash:[5,5],pointRadius:0}
        ]},
        options:{responsive:true,maintainAspectRatio:false,
            scales:{r:{min:0,max:100,ticks:{color:"#666",backdropColor:"transparent",stepSize:25},grid:{color:"rgba(255,255,255,0.08)"},pointLabels:{color:"#ccc",font:{size:12}},angleLines:{color:"rgba(255,255,255,0.08)"}}},
            plugins:{legend:{position:"bottom",labels:{color:"#ccc",font:{size:11}}},title:{display:true,text:"Профиль района",color:"#fff",font:{size:14}}}
        }
    });
}

function closeReport() { document.getElementById("report-modal").style.display = "none"; }

// ========== PDF ==========
async function exportPDF() {
    const btn = document.getElementById("pdf-btn");
    if (btn) { btn.disabled = true; btn.textContent = "Создаём PDF..."; }
    try {
        const element = document.getElementById("report-export-area");
        const prevMaxH = element.style.maxHeight;
        const prevOverflow = element.style.overflow;
        element.style.maxHeight = "none";
        element.style.overflow = "visible";
        await new Promise(r => setTimeout(r, 300));
        const canvas = await html2canvas(element, {
            scale:1.5, backgroundColor:"#1e1e36", useCORS:true, logging:false,
            windowWidth:element.scrollWidth, windowHeight:element.scrollHeight
        });
        element.style.maxHeight = prevMaxH;
        element.style.overflow = prevOverflow;
        const pdf = new jspdf.jsPDF("p","mm","a4");
        const pageW=210, pageH=297, margin=8, contentW=pageW-margin*2;
        const pxPerMm = canvas.width / contentW;
        const pageHeightPx = (pageH - margin*2) * pxPerMm;
        const totalPages = Math.ceil(canvas.height / pageHeightPx);
        for (let page=0; page<totalPages; page++) {
            if (page>0) pdf.addPage();
            const srcY = page * pageHeightPx;
            const srcH = Math.min(pageHeightPx, canvas.height - srcY);
            const pageCanvas = document.createElement("canvas");
            pageCanvas.width = canvas.width;
            pageCanvas.height = srcH;
            const ctx = pageCanvas.getContext("2d");
            ctx.drawImage(canvas, 0, srcY, canvas.width, srcH, 0, 0, canvas.width, srcH);
            const imgData = pageCanvas.toDataURL("image/jpeg", 0.92);
            const imgH = srcH / pxPerMm;
            pdf.addImage(imgData, "JPEG", margin, margin, contentW, imgH);
            pdf.setFontSize(8); pdf.setTextColor(120,120,120);
            pdf.text("Портрет квартала  •  "+new Date().toLocaleDateString("ru-RU")+"  •  "+(page+1)+" / "+totalPages, 105, 292, {align:"center"});
        }
        pdf.save("quarter-report.pdf");
    } catch(e) {
        console.error("PDF error:", e);
        addBotMessage("❌ Ошибка PDF: " + e.message);
    } finally {
        if (btn) { btn.disabled=false; btn.textContent="📄 PDF"; }
    }
}

// ========== ЧАТ ==========
function addBotMessage(text) {
    state.chatHistory.push({role:"assistant",content:text});
    const c = document.getElementById("chat-messages");
    const div = document.createElement("div");
    div.className = "message msg-assistant";
    div.innerHTML = markdownToHtml(text);
    c.appendChild(div);
    c.scrollTop = c.scrollHeight;
}
function addUserMessage(text) {
    state.chatHistory.push({role:"user",content:text});
    const c = document.getElementById("chat-messages");
    const div = document.createElement("div");
    div.className = "message msg-user";
    div.textContent = text;
    c.appendChild(div);
    c.scrollTop = c.scrollHeight;
}
function addLoading() {
    removeLoading();
    const c = document.getElementById("chat-messages");
    const div = document.createElement("div");
    div.className = "message msg-loading";
    div.id = "loading-msg";
    // Три анимированные точки
    div.innerHTML = '<div class="dot"></div><div class="dot"></div><div class="dot"></div>';
    c.appendChild(div);
    c.scrollTop = c.scrollHeight;
}
function removeLoading() {
    const el = document.getElementById("loading-msg");
    if (el) el.remove();
}
function setChatBusy(busy) {
    state.chatBusy = busy;
    document.querySelectorAll(".btn-quick").forEach(b => {
        b.disabled = busy;
        b.style.opacity = busy ? "0.4" : "1";
    });
    const sendBtn = document.getElementById("send-btn");
    if (sendBtn) sendBtn.disabled = busy;
}
async function sendMessage() {
    if (state.chatBusy) return;
    const input = document.getElementById("chat-input");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    setChatBusy(true);
    addUserMessage(text);
    addLoading();
    try {
        const r = await fetch("/api/chat", {
            method:"POST", headers:{"Content-Type":"application/json"},
            body: JSON.stringify({question:text,org_text:state.orgText,scores:state.scores,history:state.chatHistory.slice(-6)})
        });
        const data = await r.json();
        removeLoading();
        addBotMessage(data.answer);
    } catch(e) {
        removeLoading();
        addBotMessage("❌ Ошибка: " + e.message);
    } finally { setChatBusy(false); }
}
async function askQuick(q) {
    if (!q || state.chatBusy) return;
    setChatBusy(true);
    addUserMessage(q);
    addLoading();
    try {
        const r = await fetch("/api/chat", {
            method:"POST", headers:{"Content-Type":"application/json"},
            body: JSON.stringify({question:q,org_text:state.orgText,scores:state.scores,history:state.chatHistory.slice(-6)})
        });
        const data = await r.json();
        removeLoading();
        addBotMessage(data.answer);
    } catch(e) {
        removeLoading();
        addBotMessage("❌ Ошибка: " + e.message);
    } finally { setChatBusy(false); }
}
document.getElementById("chat-input").addEventListener("keypress", function(e) {
    if (e.key === "Enter" && !state.chatBusy) sendMessage();
});
document.addEventListener("click", function(e) {
    if (!e.target.closest(".search-box")) document.getElementById("search-results").innerHTML = "";
});
function markdownToHtml(text) {
    if (!text) return "";
    return text
        .replace(/^## (.+)$/gm, "<h2>$1</h2>")
        .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.*?)\*/g, "<em>$1</em>")
        .replace(/\n/g, "<br>");
}
