// ===== СОСТОЯНИЕ =====
let state = {
    bbox: null,
    organizations: [],
    scores: {},
    orgText: "",
    chatHistory: [],
    heatLayer: null,
    markersLayer: null
};

// ===== КАРТА =====
const map = L.map("map").setView([55.7558, 37.6173], 13);

L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: "OpenStreetMap, CARTO",
    maxZoom: 19
}).addTo(map);

// Рисование
const drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);

const drawControl = new L.Control.Draw({
    draw: {
        polyline: false,
        circle: false,
        circlemarker: false,
        marker: false,
        polygon: {
            shapeOptions: { color: "#667eea", fillOpacity: 0.15, weight: 2 }
        },
        rectangle: {
            shapeOptions: { color: "#667eea", fillOpacity: 0.15, weight: 2 }
        }
    },
    edit: { featureGroup: drawnItems }
});
map.addControl(drawControl);

map.on("draw:created", function(e) {
    drawnItems.clearLayers();
    drawnItems.addLayer(e.layer);

    const bounds = e.layer.getBounds();
    state.bbox = bounds.getSouth() + "," + bounds.getWest() + "," + bounds.getNorth() + "," + bounds.getEast();

    document.getElementById("analyze-btn").style.display = "block";
});

// ===== ОПРЕДЕЛЕНИЕ ГОРОДА =====
async function detectCity() {
    try {
        const r = await fetch("/api/detect-city");
        const data = await r.json();
        map.setView([data.lat, data.lon], 13);
        addBotMessage("Привет! Я AI-урбанист. Похоже, вы в городе " + data.city + ". Выделите область на карте инструментом рисования, и я проанализирую этот район.");
    } catch(e) {
        addBotMessage("Привет! Выделите область на карте, и я проанализирую район.");
    }
}

detectCity();

// ===== ПОИСК =====
let searchTimeout;
document.getElementById("search-input").addEventListener("input", function(e) {
    clearTimeout(searchTimeout);
    const q = e.target.value;
    if (q.length < 3) {
        document.getElementById("search-results").innerHTML = "";
        return;
    }
    searchTimeout = setTimeout(async () => {
        const r = await fetch("/api/search?q=" + encodeURIComponent(q));
        const data = await r.json();
        const container = document.getElementById("search-results");
        container.innerHTML = "";
        data.results.forEach(item => {
            const div = document.createElement("div");
            div.className = "search-item";
            div.textContent = item.display_name.substring(0, 60);
            div.onclick = () => {
                map.setView([item.lat, item.lon], 15);
                container.innerHTML = "";
                document.getElementById("search-input").value = "";
            };
            container.appendChild(div);
        });
    }, 400);
});

// ===== АНАЛИЗ =====
document.getElementById("analyze-btn").addEventListener("click", async function() {
    if (!state.bbox) return;

    this.disabled = true;
    this.textContent = "Анализируем...";

    try {
        const r = await fetch("/api/analyze", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({bbox: state.bbox})
        });
        const data = await r.json();

        if (data.error) {
            addBotMessage(data.error);
            return;
        }

        state.organizations = data.organizations;
        state.scores = data.scores;
        state.orgText = data.org_text;

        // Тепловая карта
        if (state.heatLayer) map.removeLayer(state.heatLayer);
        const heatData = data.organizations.map(o => [o.lat, o.lon, 1]);
        state.heatLayer = L.heatLayer(heatData, {
            radius: 20, blur: 15,
            gradient: {0.2: "#667eea", 0.5: "#764ba2", 0.7: "#f093fb", 1: "#f5576c"}
        }).addTo(map);

        // Маркеры
        if (state.markersLayer) map.removeLayer(state.markersLayer);
        state.markersLayer = L.layerGroup();
        data.organizations.forEach(o => {
            if (o.name && o.name !== "Без названия") {
                L.circleMarker([o.lat, o.lon], {
                    radius: 4, color: "#667eea", fillOpacity: 0.8
                }).bindTooltip(o.name).addTo(state.markersLayer);
            }
        });
        state.markersLayer.addTo(map);

        // Оценки
        showScores(data.scores);

        // Сообщение
        const s = data.scores;
        addBotMessage("Район проанализирован!\n\nИндекс: " + s.overall + "/100\nНайдено " + s.total_places + " организаций на " + s.area_km2 + " км²\n\nНажмите «Полный отчёт» или задайте вопрос.");

        // Показать элементы
        document.getElementById("report-btn").style.display = "block";
        document.getElementById("quick-questions").style.display = "flex";

    } catch(e) {
        addBotMessage("Ошибка анализа: " + e.message);
    } finally {
        this.disabled = false;
        this.textContent = "Анализировать район";
    }
});

// ===== ОЦЕНКИ =====
function showScores(s) {
    const panel = document.getElementById("scores-panel");
    panel.style.display = "block";

    const metrics = [
        {label: "Еда", value: s.food},
        {label: "Здоровье", value: s.health},
        {label: "Шопинг", value: s.shopping},
        {label: "Спорт", value: s.sport},
        {label: "Образование", value: s.education},
        {label: "Досуг", value: s.entertainment},
        {label: "Разнообразие", value: s.diversity}
    ];

    let html = '<div class="score-badge"><div class="score-big">' + s.overall + '/100</div><div class="score-sub">ИНДЕКС РАЙОНА</div></div>';

    metrics.forEach(m => {
        const color = m.value >= 60 ? "#4CAF50" : m.value >= 30 ? "#FFC107" : "#f44336";
        html += '<div class="metric">';
        html += '<span class="metric-label">' + m.label + '</span>';
        html += '<div class="metric-bar-bg"><div class="metric-bar-fill" style="width:' + m.value + '%;background:' + color + '"></div></div>';
        html += '<span class="metric-value">' + m.value + '</span>';
        html += '</div>';
    });

    panel.innerHTML = html;
}

// ===== ОТЧЁТ =====
document.getElementById("report-btn").addEventListener("click", async function() {
    this.disabled = true;
    this.textContent = "Генерируем...";

    try {
        const r = await fetch("/api/report", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({org_text: state.orgText, scores: state.scores})
        });
        const data = await r.json();

        document.getElementById("report-text").innerHTML = markdownToHtml(data.report);
        document.getElementById("report-modal").style.display = "flex";
    } catch(e) {
        addBotMessage("Ошибка генерации отчёта");
    } finally {
        this.disabled = false;
        this.textContent = "Полный отчёт";
    }
});

function closeReport() {
    document.getElementById("report-modal").style.display = "none";
}

// ===== ЧАТ =====
function addBotMessage(text) {
    state.chatHistory.push({role: "assistant", content: text});
    const container = document.getElementById("chat-messages");
    const div = document.createElement("div");
    div.className = "message msg-assistant";
    div.innerHTML = markdownToHtml(text);
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function addUserMessage(text) {
    state.chatHistory.push({role: "user", content: text});
    const container = document.getElementById("chat-messages");
    const div = document.createElement("div");
    div.className = "message msg-user";
    div.textContent = text;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function addLoading() {
    const container = document.getElementById("chat-messages");
    const div = document.createElement("div");
    div.className = "message msg-loading";
    div.id = "loading-msg";
    div.textContent = "Думаю...";
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function removeLoading() {
    const el = document.getElementById("loading-msg");
    if (el) el.remove();
}

async function sendMessage() {
    const input = document.getElementById("chat-input");
    const text = input.value.trim();
    if (!text) return;

    input.value = "";
    addUserMessage(text);
    addLoading();

    try {
        const r = await fetch("/api/chat", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({
                question: text,
                org_text: state.orgText,
                scores: state.scores,
                history: state.chatHistory.slice(-6)
            })
        });
        const data = await r.json();
        removeLoading();
        addBotMessage(data.answer);
    } catch(e) {
        removeLoading();
        addBotMessage("Ошибка: " + e.message);
    }
}

async function askQuick(q) {
    addUserMessage(q);
    addLoading();
    try {
        const r = await fetch("/api/chat", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({
                question: q,
                org_text: state.orgText,
                scores: state.scores,
                history: state.chatHistory.slice(-6)
            })
        });
        const data = await r.json();
        removeLoading();
        addBotMessage(data.answer);
    } catch(e) {
        removeLoading();
        addBotMessage("Ошибка");
    }
}

// Enter для отправки
document.getElementById("chat-input").addEventListener("keypress", function(e) {
    if (e.key === "Enter") sendMessage();
});

// Клик вне результатов поиска
document.addEventListener("click", function(e) {
    if (!e.target.closest(".search-box")) {
        document.getElementById("search-results").innerHTML = "";
    }
});

// ===== ПРОСТОЙ MARKDOWN =====
function markdownToHtml(text) {
    if (!text) return "";
    return text
        .replace(/## (.*)/g, "<h2>$1</h2>")
        .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.*?)\*/g, "<em>$1</em>")
        .replace(/\n/g, "<br>");
}
