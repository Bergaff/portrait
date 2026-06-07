 "use client"

import { useState, useEffect, useRef } from "react"
import { ArrowDownRight, ArrowUpRight, Radio, Send, FileText, Sparkles, Loader2 } from "lucide-react"
import { Sparkline } from "@/components/sparkline"
import { FlowChart } from "@/components/flow-chart"
import { Button } from "@/components/ui/button"
import { metrics, liveFeed, type District } from "@/lib/dashboard-data"

const levelStyles: Record<string, string> = {
  high: "bg-primary",
  medium: "bg-chart-2",
  low: "bg-muted-foreground",
}

interface SidebarPanelProps {
  selected: District | null
}

export function SidebarPanel({ selected }: SidebarPanelProps) {
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([])
  const [input, setInput] = useState("")
  const [isChatLoading, setIsChatLoading] = useState(false)
  const [isReportLoading, setIsReportLoading] = useState(false)
  const [reportResult, setReportResult] = useState<string | null>(null)
  
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const handleSendMessage = async () => {
    if (!input.trim() || isChatLoading) return
    
    const userText = input.trim()
    setInput("")
    const updatedHistory = [...messages, { role: "user", content: userText }]
    setMessages(updatedHistory)
    setIsChatLoading(true)

    try {
      const response = await fetch("/api/chat/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userText,
          history: updatedHistory.slice(0, -1),
          context_data: selected ? {
            name: selected.name,
            score: selected.density,
            total_pois: Math.floor(selected.flow / 300)
          } : null
        })
      })
      
      if (response.ok) {
        const data = await response.json()
        setMessages([...updatedHistory, { role: "assistant", content: data.response }])
      } else {
        setMessages([...updatedHistory, { role: "assistant", content: "Ошибка бэкенда при обработке контекста." }])
      }
    } catch (e) {
      setMessages([...updatedHistory, { role: "assistant", content: "Не удалось связаться с сервером аналитики." }])
    } finally {
      setIsChatLoading(false)
    }
  }

  const handleGenerateReport = async () => {
    if (!selected || isReportLoading) return
    setIsReportLoading(true)
    setReportResult(null)

    try {
      const response = await fetch("/api/report/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: selected.lat,
          lng: selected.lng,
          zone_score: selected.density,
          total_pois: Math.floor(selected.flow / 240),
          categories_breakdown: {
            supermarkets: Math.floor(selected.density / 20) || 1,
            pharmacies: Math.floor(selected.density / 35),
            catering: Math.floor(selected.flow / 3000),
            retail: Math.floor(selected.flow / 4000),
            other: 2
          }
        })
      })

      if (response.ok) {
        const data = await response.json()
        setReportResult(data.recommendation)
      }
    } catch (e) {
      setReportResult("Сбой генерации PDF/JSON стрима отчета.")
    } finally {
      setIsReportLoading(false)
    }
  }

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto p-5 select-none">
      <section className="grid gap-3">
        {metrics.map((m) => {
          const positive = m.delta >= 0
          return (
            <div key={m.label} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-muted-foreground font-medium">{m.label}</p>
                  <p className="mt-1 text-2xl font-semibold tracking-tight">{m.value}</p>
                </div>
                <div className="w-20">
                  <Sparkline data={m.series} positive={positive} className="h-8 w-full" />
                </div>
              </div>
              <div className="mt-2 flex items-center gap-1 text-xs">
                <span className={positive ? "text-primary" : "text-destructive"}>
                  {positive ? <ArrowUpRight className="inline size-3 mr-0.5" /> : <ArrowDownRight className="inline size-3 mr-0.5" />}
                  {Math.abs(m.delta)}%
                </span>
                <span className="text-muted-foreground text-[11px]">vs last month</span>
              </div>
            </div>
          )
        })}
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-medium">Hourly Traffic Density</p>
            <h3 className="text-base font-semibold text-foreground mt-0.5">
              {selected ? selected.name : "Select a district"}
            </h3>
          </div>
        </div>
        <FlowChart />
      </section>

      <section className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-foreground uppercase tracking-wider">Commercial Report</span>
          <Button 
            variant="outline" 
            size="sm" 
            disabled={!selected || isReportLoading} 
            onClick={handleGenerateReport}
            className="cursor-pointer"
          >
            {isReportLoading ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : <FileText className="size-3.5 mr-1.5" />}
            Generate
          </Button>
        </div>
        {reportResult && (
          <div className="rounded-lg bg-secondary/60 border border-border p-3 text-xs text-foreground leading-relaxed animate-in fade-in duration-200">
            {reportResult}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-4 flex flex-col h-[280px] shrink-0">
        <div className="flex items-center gap-1.5 border-b border-border pb-2 mb-2">
          <Sparkles className="size-3.5 text-primary" />
          <span className="text-xs font-semibold text-foreground uppercase tracking-wider">Spatial Copilot</span>
        </div>
        
        <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 text-xs scrollbar-thin">
          {messages.length === 0 && (
            <p className="text-muted-foreground text-[11px] italic pt-2">
              Задайте вопрос по инфраструктуре {selected ? selected.name : "выбранного узла"}...
            </p>
          )}
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
              <div className={`max-w-[85%] rounded-lg px-2.5 py-1.5 leading-snug ${
                msg.role === "user" ? "bg-primary text-primary-foreground font-medium" : "bg-secondary text-foreground"
              }`}>
                {msg.content}
              </div>
            </div>
          ))}
          {isChatLoading && (
            <div className="flex items-center gap-1.5 text-muted-foreground text-[11px]">
              <Loader2 className="size-3 animate-spin text-primary" />
              Анализ паттернов среды...
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        <div className="mt-2 flex gap-1.5 items-center">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
            placeholder="Спросить про трафик или ритейл..."
            className="flex-1 h-8 rounded-lg border border-border bg-background px-2.5 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-primary transition-colors"
          />
          <Button variant="default" size="icon-sm" onClick={handleSendMessage} disabled={isChatLoading} className="cursor-pointer">
            <Send className="size-3" />
          </Button>
        </div>
      </section>

      <section className="mt-auto border-t border-border pt-4">
        <div className="mb-3 flex items-center px-1">
          <h2 className="text-xs font-semibold uppercase tracking-wider">Live Infrastructure Feed</h2>
          <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground uppercase font-bold">
            <Radio className="size-3 animate-pulse text-primary mr-0.5" />
            Live
          </span>
        </div>
        <ul className="flex flex-col gap-1.5">
          {liveFeed.map((f) => (
            <li key={f.id} className="flex items-start gap-2.5 rounded-lg p-2 hover:bg-card/50 transition-colors border border-transparent hover:border-border">
              <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${levelStyles[f.level]}`} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-foreground">{f.message}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{f.district}</p>
              </div>
              <span className="shrink-0 text-[10px] text-muted-foreground font-mono">{f.time}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
