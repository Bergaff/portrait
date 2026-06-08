"use client"

import { useEffect } from "react"
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from "react-leaflet"
import { districts, cityCenter, type District } from "@/lib/dashboard-data"
import "leaflet/dist/leaflet.css"

// Функция динамического расчета цвета в зависимости от плотности трафика
function densityColor(density: number) {
  if (density >= 80) return "oklch(0.58 0.21 277)" // var(--color-primary)
  if (density >= 60) return "oklch(0.65 0.15 277)"
  if (density >= 45) return "oklch(0.72 0.10 277)"
  return "oklch(0.65 0.01 286)" // var(--color-muted-foreground)
}

// Автоматический пересчет размеров контейнера карты при изменении геометрии окна (SaaS-стандарт)
function MapResizer() {
  const map = useMap()
  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize()
    }, 200)
    return () => clearTimeout(timer)
  }, [map])
  return null
}

interface CityMapProps {
  selectedId: string | null
  onSelect: (district: District) => void
}

export function CityMap({ selectedId, onSelect }: CityMapProps) {
  return (
    <div className="relative h-full w-full bg-background">
      {/* Кастомные переопределения стандартных стилей Leaflet для темной темы */}
      <style jsx global>{`
        .leaflet-container {
          background: var(--color-background) !important;
          font-family: var(--font-sans) !important;
        }
        .leaflet-vml-shape {
          width: 1px !important;
          height: 1px !important;
        }
        .custom-tooltip {
          background: var(--color-popover) !important;
          border: 1px border var(--color-border) !important;
          color: var(--color-popover-foreground) !important;
          font-size: 11px !important;
          font-weight: 500 !important;
          border-radius: 6px !important;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5) !important;
        }
      `}</style>

      <MapContainer
        center={cityCenter}
        zoom={13}
        zoomControl={false}
        scrollWheelZoom
        className="h-full w-full"
      >
        <MapResizer />

        {/* Премиальная подложка карты в стиле Dark Mode от CARTO */}
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; OpenStreetMap &copy; CARTO'
        />

        {districts.map((d) => {
          const isActive = selectedId === d.id
          const markerColor = densityColor(d.density)

          return (
            <CircleMarker
              key={d.id}
              center={[d.lat, d.lng]}
              radius={isActive ? 12 + d.density / 10 : 6 + d.density / 14}
              pathOptions={{
                color: markerColor,
                fillColor: markerColor,
                fillOpacity: isActive ? 0.6 : 0.25,
                weight: isActive ? 2.5 : 1.5,
              }}
              eventHandlers={{
                click: () => onSelect(d),
              }}
            >
              <Tooltip className="custom-tooltip" direction="top" offset={[0, -5]} opacity={1}>
                <div className="px-1 py-0.5">
                  <span className="font-semibold">{d.name}</span>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    Поток: {d.flow.toLocaleString()} чел/час
                  </div>
                </div>
              </Tooltip>
            </CircleMarker>
          )
        })}
      </MapContainer>
    </div>
  )
}
