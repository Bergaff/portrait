"use client"

import dynamic from "next/dynamic"
import { useState } from "react"
import {
  Activity,
  Bell,
  Compass,
  Layers,
  Map as MapIcon,
  Search,
  Settings,
  TrendingUp,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { SidebarPanel } from "@/components/sidebar-panel"
import { districts, type District } from "@/lib/dashboard-data"

// Безопасный импорт Leaflet-компонента без серверного рендеринга (SSR)
const CityMap = dynamic(
  () => import("@/components/city-map").then((m) => m.CityMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-background text-xs font-mono text-muted-foreground animate-pulse">
        Инициализация картографических слоев...
      </div>
    ),
  },
)

const navItems = [
  { icon: Compass, label: "Overview", active: true },
  { icon: MapIcon, label: "Spatial Map" },
  { icon: TrendingUp, label: "Predictive Trends" },
  { icon: Layers, label: "Urban Districts" },
  { icon: Activity, label: "Live Telemetry" },
]

export function DashboardShell() {
  // Дефолтно выбираем первую коммерческую зону (SoMa)
  const [selected, setSelected] = useState<District | null>(districts[0])

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground antialiased font-sans">
      
      {/* Левое системное меню навигации (Rail Navigation) */}
      <nav className="flex w-16 flex-col items-center gap-3 border-r border-border bg-sidebar py-4 shrink-0">
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20 font-mono text-sm font-bold">
          AT
        </div>
        <div className="mt-4 flex flex-1 flex-col gap-1 w-full px-2">
          {navItems.map((item) => (
            <button
              key={item.label}
              title={item.label}
              className={`flex size-12 items-center justify-center rounded-lg transition-all duration-150 outline-none cursor-pointer ${
                item.active
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              }`}
            >
              <item.icon className="size-4" />
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-1 w-full px-2 mt-auto border-t border-sidebar-border pt-3">
          <button className="flex size-12 items-center justify-center rounded-lg text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors cursor-pointer">
            <Settings className="size-4" />
          </button>
        </div>
      </nav>

      {/* Основной контентный блок рабочей области */}
      <div className="flex flex-1 flex-col min-w-0">
        
        {/* Верхняя панель мониторинга и поиска (Header) */}
        <header className="flex h-14 items-center justify-between border-b border-border bg-card px-5 shrink-0 select-none">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-semibold tracking-tight uppercase">Atlas Urban Analytics Platform</h1>
            <span className="inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary font-mono border border-primary/10">
              v2.5-Live
            </span>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="relative hidden sm:block">
              <Search className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Поиск индекса зоны, координат, POI..."
                className="h-8 w-64 rounded-lg border border-border bg-background pl-9 pr-3 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-primary transition-colors font-sans"
              />
            </div>
            <button className="relative flex size-8 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
              <Bell className="size-4" />
              <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-primary" />
            </button>
            <div className="flex size-8 items-center justify-center rounded-full bg-primary text-[11px] font-mono font-bold text-primary-foreground select-none">
              AN
            </div>
          </div>
        </header>

        {/* Интерактивный интегpированный слой: Карта + Аналитика */}
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          
          {/* Секция интерактивной Leaflet карты */}
          <section className="relative min-h-[350px] flex-1 lg:min-h-0 border-b lg:border-b-0 lg:border-r border-border">
            <CityMap
              selectedId={selected?.id ?? null}
              onSelect={(d) => setSelected(d)}
            />
            
            {/* Плавающая легенда плотности трафика в углу карты */}
            <div className="pointer-events-none absolute bottom-4 left-4 z-[400] rounded-xl border border-border bg-card/90 p-3 backdrop-blur-sm shadow-lg select-none">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Traffic Density Index
              </p>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-primary" />
                  <span className="text-[11px] text-muted-foreground font-medium">High Flow</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-muted-foreground" />
                  <span className="text-[11px] text-muted-foreground font-medium">Low/Muted</span>
                </div>
              </div>
            </div>
          </section>

          {/* Правая аналитическая панель (Метрики, Отчеты, Чат) */}
          <aside className="w-full shrink-0 bg-background lg:w-[380px] h-full overflow-hidden">
            <SidebarPanel selected={selected} />
          </aside>
          
        </div>
      </div>
    </div>
  )
}
