export type District = {
  id: string
  name: string
  lat: number
  lng: number
  density: number  // Плотность населения/трафика (0-100)
  flow: number     // Средний пешеходный поток (чел/час)
  trend: number    // Процентное изменение тренда активности
}

// Профессиональные референсные точки анализа городской среды (Сан-Франциско)
export const districts: District[] = [
  { id: "soma", name: "SoMa Commercial District", lat: 37.7785, lng: -122.4056, density: 92, flow: 18420, trend: 12.4 },
  { id: "fidi", name: "Financial District Hub", lat: 37.7946, lng: -122.4006, density: 88, flow: 21030, trend: 8.1 },
  { id: "mission", name: "Mission Retail Zone", lat: 37.7599, lng: -122.4148, density: 74, flow: 14200, trend: -3.2 },
  { id: "hayes", name: "Hayes Valley Premium", lat: 37.7765, lng: -122.4244, density: 61, flow: 9800, trend: 5.6 },
  { id: "marina", name: "Marina Coastal Area", lat: 37.8037, lng: -122.4368, density: 48, flow: 7600, trend: -1.4 },
  { id: "castro", name: "Castro Street", lat: 37.7609, lng: -122.4350, density: 65, flow: 11200, trend: 2.3 },
  { id: "sunset", name: "Sunset District Cluster", lat: 37.7522, lng: -122.4842, density: 33, flow: 4900, trend: 1.1 }
]

// Географический центр карты для инициализации Leaflet
export const cityCenter: [number, number] = [37.7749, -122.4194]

export type Metric = {
  label: string
  value: string
  delta: number
  series: number[]
}

// Системные макро-метрики для глобальной панели аналитики
export const metrics: Metric[] = [
  {
    label: "Active Population Index",
    value: "412.8K",
    delta: 6.2,
    series: [32, 40, 38, 52, 48, 60, 58, 70, 66, 74, 80, 78]
  },
  {
    label: "Avg Dwell Time (Mins)",
    value: "24m",
    delta: -2.1,
    series: [60, 58, 55, 52, 54, 50, 48, 46, 49, 45, 44, 42]
  },
  {
    label: "Transit Load Capacity",
    value: "78%",
    delta: 3.8,
    series: [40, 44, 42, 50, 55, 53, 60, 64, 62, 70, 72, 76]
  }
]

// Почасовой срез трафика для графика FlowChart
export const hourlyFlow: number[] = [
  2100, 1400, 900, 600, 800, 1500, 3400, 6800, 9200, 11000, 10500, 12000,
  14200, 13800, 13100, 14800, 17200, 19400, 18500, 14000, 9800, 6700, 4500, 3100
]

export type LiveEvent = {
  id: string
  message: string
  district: string
  time: string
  level: "high" | "medium" | "low"
}

// Живой лог событий для нижней секции боковой панели
export const liveFeed: LiveEvent[] = [
  { id: "1", message: "Пешеходный пик в узле коммерции", district: "Financial District", time: "Just now", level: "high" },
  { id: "2", message: "Стабилизация трафика в ритейл-зоне", district: "Mission Retail", time: "4m ago", level: "medium" },
  { id: "3", message: "Локальное снижение транспортного потока", district: "Sunset District", time: "12m ago", level: "low" },
  { id: "4", message: "Регистрация нового торгового POI", district: "SoMa Commercial", time: "25m ago", level: "medium" }
]
