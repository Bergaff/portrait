 "use client"

import { hourlyFlow } from "@/lib/dashboard-data"

export function FlowChart() {
  const max = Math.max(...hourlyFlow)
  const peakIndex = hourlyFlow.indexOf(max)

  return (
    <div className="flex h-28 items-end gap-[3px] px-1">
      {hourlyFlow.map((v, i) => {
        const isPeak = i === peakIndex
        return (
          <div key={i} className="group relative flex flex-1 items-end h-full cursor-pointer">
            {/* Столбец графика в премиальной oklch палитре */}
            <div
              className={`w-full rounded-t-sm transition-all duration-200 ${
                isPeak
                  ? "bg-primary"
                  : "bg-primary/20 group-hover:bg-primary/45"
              }`}
              style={{ height: `${(v / max) * 100}%` }}
            />

            {/* Тултип при наведении */}
            <div className="pointer-events-none absolute -top-8 left-1/2 z-30 -translate-x-1/2 rounded border border-border bg-popover px-1.5 py-0.5 text-[10px] font-mono font-medium text-popover-foreground opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100 whitespace-nowrap">
              {`${String(i).padStart(2, "0")}:00`}
            </div>
          </div>
        )
      })}
    </div>
  )
}
