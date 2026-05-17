let state = {
    bbox: null, organizations: [], scores: {}, categories: {},
    orgText: "", chatHistory: [], heatLayer: null, markersLayer: null,
    pieChart: null, barChart: null, radarChart: null
};

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
});

async function detectCity() {
    try {
        const r = await fetch("/api/detect-city");
        const d = await r.json();
        map.setView([d.lat, d.lon], 13);
        addBotMessage("Привет! Я AI-урбанист. Похоже, вы в городе " + d.city + ". Выделите область на карте, и я проанализирую район.");
    } catch(e) {
        addBotMessage("Привет! Выделите область на карте для анализа.");
    }
}
detectCity();

// ПОИСК
let searchTimeout;
document.getElementById("search-input").addEventListener("input", function(e) {
    clearTimeout(searchTimeout);
    const q = e.target.value.trim();
    if (q.length < 3) { document.getElementById("search-results").innerHTML = ""; return; }
    searchTimeout = setTimeout(async () => {
        try {
            const r = await fetch("/api/search?q=" + encodeURIComponent(q));
            const data = await r.json();
            const c = document.getElementById("search-results");
            c.innerHTML = "";
            if (data.results.length === 0) {
                c.innerHTML = '<div class="search-item" style="color:#666">Ничего не найдено</div>';
                return;
            }
            data.results.forEach(item => {
                const div = document.createElement("div");
                div.className = "search-item";
                div.textContent = item.display_name.substring(0, 70);
                div.onclick = () => {
                    map.setView([item.lat, item.lon], 16);
                    c.innerHTML = "";
                    document.getElementById("search-input").value = "";
                };
                c.appendChild(div);
            });
        } catch(err) { console.error(err); }
    }, 500);
});

// АНАЛИЗ
async function analyzeArea() {
    if (!state.bbox) return;
    const btn = document.getElementById("analyze-btn");
    btn.disabled = true; btn.textContent = "Анализируем...";
    try {
        const r = await fetch("/api/analyze", {
            method:"POST", headers:{"Content-Type":"application/json"},
            body: JSON.stringify({bbox: state.bbox})
        });
        const data = await r.json();
        if (data.error) { addBotMessage(data.error); return; }
        state.organizations = data.organizations;
        state.scores = data.scores;
        state.categories = data.categories;
        state.orgText = data.org_text;

        if (state.heatLayer) map.removeLayer(state.heatLayer);
        state.heatLayer = L.heatLayer(
            data.organizations.map(o=>[o.lat,o.lon,1]),
            {radius:20,blur:15,gradient:{0.2:"#667eea",0.5:"#764ba2",0.7:"#f093fb",1:"#f5576c"}}
        ).addTo(map);

        if (state.markersLayer) map.removeLayer(state.markersLayer);
        state.markersLayer = L.layerGroup();
        data.organizations.forEach(o => {
            if (o.name && o.name !== "Без названия") {
                L.circleMarker([o.lat,o.lon],{radius:4,color:"#667eea",fillOpacity:0.8})
                 .bindTooltip(o.name).addTo(state.markersLayer);
            }
        });
        state.markersLayer.addTo(map);

        showScores(data.scores);
        const s = data.scores;
        addBotMessage("Район проанализирован!\n\nИндекс: "+s.overall+"/100\nНайдено "+s.total_places+" организаций на "+s.area_km2+" км²\n\nНажмите «Полный отчёт» или задайте вопрос.");
        document.getElementById("report-btn").style.display = "block";
        document.getElementById("quick-questions").style.display = "flex";
    } catch(e) { addBotMessage("Ошибка: "+e.message); }
    finally { btn.disabled = false; btn.textContent = "Анализировать район"; }
}

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
    metrics.forEach(m => {
        const color = m.value>=60?"#4CAF50":m.value>=30?"#FFC107":"#f44336";
        html += '<div class="metric"><span class="metric-label">'+m.label+'</span>';
        html += '<div class="metric-bar-bg"><div class="metric-bar-fill" style="width:'+m.value+'%;background:'+color+'"></div></div>';
        html += '<span class="metric-value">'+m.value+'</span></div>';
    });
    panel.innerHTML = html;
}

// ОТЧЁТ
async function generateReport() {
    const btn = document.getElementById("report-btn");
    btn.disabled = true; btn.textContent = "Генерируем...";
    try {
        const r = await fetch("/api/report", {
            method:"POST", headers:{"Content-Type":"application/json"},
            body: JSON.stringify({org_text: state.orgText, scores: state.scores})
        });
        const data = await r.json();
        document.getElementById("report-text").innerHTML = markdownToHtml(data.report);
        renderCharts();
        document.getElementById("report-modal").style.display = "flex";
    } catch(e) { addBotMessage("Ошибка отчёта"); }
    finally { btn.disabled = false; btn.textContent = "Полный отчёт"; }
}

function renderCharts() {
    const cats = state.categories;
    const catLabels = Object.keys(cats);
    const catValues = Object.values(cats);
    const colors = ["#667eea","#764ba2","#f093fb","#f5576c","#feca57","#48dbfb","#ff9ff3","#54a0ff","#5f27cd","#01a3a4"];

    // ПАЙЧАРТ
    if (state.pieChart) state.pieChart.destroy();
    state.pieChart = new Chart(document.getElementById("pieChart").getContext("2d"), {
        type: "doughnut",
        data: { labels: catLabels, datasets: [{ data: catValues, backgroundColor: colors, borderWidth: 0 }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { position:"right", labels: { color:"#ccc", font:{size:11}, padding:8 } },
                title: { display:true, text:"Категории организаций", color:"#fff", font:{size:14} }
            }
        }
    });

    // БАРЧАРТ
    const s = state.scores;
    const barLabels = ["Еда","Здоровье","Шопинг","Спорт","Образование","Досуг","Разнообразие"];
    const barValues = [s.food,s.health,s.shopping,s.sport,s.education,s.entertainment,s.diversity];
    const barColors = ["#667eea","#4ECDC4","#f093fb","#feca57","#48dbfb","#ff9ff3","#54a0ff"];

    if (state.barChart) state.barChart.destroy();
    state.barChart = new Chart(document.getElementById("barChart").getContext("2d"), {
        type: "bar",
        data: { labels: barLabels, datasets: [{ data: barValues, backgroundColor: barColors, borderWidth: 0, borderRadius: 4 }] },
        options: {
            indexAxis:"y", responsive:true, maintainAspectRatio:false,
            scales: {
                x: { max:100, ticks:{color:"#888"}, grid:{color:"rgba(255,255,255,0.05)"} },
                y: { ticks:{color:"#ccc"}, grid:{display:false} }
            },
            plugins: { legend:{display:false}, title:{display:true,text:"Оценки инфраструктуры",color:"#fff",font:{size:14}} }
        }
    });

    // РАДАР (ЛЕПЕСТКОВАЯ)
    if (state.radarChart) state.radarChart.destroy();
    state.radarChart = new Chart(document.getElementById("radarChart").getContext("2d"), {
        type: "radar",
        data: {
            labels: barLabels,
            datasets: [{
                label: "Этот район",
                data: barValues,
                backgroundColor: "rgba(102,126,234,0.2)",
                borderColor: "#667eea",
                borderWidth: 2,
                pointBackgroundColor: "#667eea",
                pointRadius: 4
            },{
                label: "Средний по городу",
                data: [50,50,50,50,50,50,50],
                backgroundColor: "rgba(255,255,255,0.05)",
                borderColor: "rgba(255,255,255,0.3)",
                borderWidth: 1,
                borderDash: [5,5],
                pointRadius: 0
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
                r: {
                    min: 0, max: 100,
                    ticks: { color: "#666", backdropColor: "transparent", stepSize: 25 },
                    grid: { color: "rgba(255,255,255,0.08)" },
                    pointLabels: { color: "#ccc", font: { size: 12 } },
                    angleLines: { color: "rgba(255,255,255,0.08)" }
                }
            },
            plugins: {
                legend: { position: "bottom", labels: { color: "#ccc", font: { size: 11 } } },
                title: { display: true, text: "Профиль района", color: "#fff", font: { size: 14 } }
            }
        }
    });
}

function closeReport() { document.getElementById("report-modal").style.display = "none"; }

function exportPDF() {
    const el = document.getElementById("report-export-area");
    html2pdf().set({
        margin: 10, filename: "quarter-report.pdf",
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2, backgroundColor: "#1e1e36" },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" }
    }).from(el).save();
}

// ЧАТ
function addBotMessage(text) {
    state.chatHistory.push({role:"assistant",content:text});
    const c = document.getElementById("chat-messages");
    const div = document.createElement("div");
    div.className = "message msg-assistant";
    div.innerHTML = markdownToHtml(text);
    c.appendChild(div); c.scrollTop = c.scrollHeight;
}
function addUserMessage(text) {
    state.chatHistory.push({role:"user",content:text});
    const c = document.getElementById("chat-messages");
    const div = document.createElement("div");
    div.className = "message msg-user";
    div.textContent = text;
    c.appendChild(div); c.scrollTop = c.scrollHeight;
}
function addLoading() {
    const c = document.getElementById("chat-messages");
    const div = document.createElement("div");
    div.className = "message msg-loading"; div.id = "loading-msg";
    div.textContent = "Думаю...";
    c.appendChild(div); c.scrollTop = c.scrollHeight;
}
function removeLoading() { const el = document.getElementById("loading-msg"); if(el) el.remove(); }

async function sendMessage() {
    const input = document.getElementById("chat-input");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    addUserMessage(text); addLoading();
    try {
        const r = await fetch("/api/chat", {
            method:"POST", headers:{"Content-Type":"application/json"},
            body: JSON.stringify({question:text,org_text:state.orgText,scores:state.scores,history:state.chatHistory.slice(-6)})
        });
        const data = await r.json();
        removeLoading(); addBotMessage(data.answer);
    } catch(e) { removeLoading(); addBotMessage("Ошибка: "+e.message); }
}

async function askQuick(q) {
    addUserMessage(q); addLoading();
    try {
        const r = await fetch("/api/chat", {
            method:"POST", headers:{"Content-Type":"application/json"},
            body: JSON.stringify({question:q,org_text:state.orgText,scores:state.scores,history:state.chatHistory.slice(-6)})
        });
        const data = await r.json();
        removeLoading(); addBotMessage(data.answer);
    } catch(e) { removeLoading(); addBotMessage("Ошибка"); }
}

document.getElementById("chat-input").addEventListener("keypress", function(e) { if(e.key==="Enter") sendMessage(); });
document.addEventListener("click", function(e) { if(!e.target.closest(".search-box")) document.getElementById("search-results").innerHTML=""; });

// AUTH заглушки
function toggleAuth() {
    const m = document.getElementById("auth-modal");
    m.style.display = m.style.display === "none" ? "flex" : "none";
}
function socialLogin(provider) { alert("Авторизация через " + provider + " — подключите Supabase Auth"); }
function emailLogin() { alert("Email авторизация — подключите Supabase Auth"); }

function markdownToHtml(text) {
    if (!text) return "";
    return text
        .replace(/## (.*)/g, "<h2>$1</h2>")
        .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.*?)\*/g, "<em>$1</em>")
        .replace(/\n/g, "<br>");
}
