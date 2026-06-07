import "@/app/globals.css"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Atlas Urban Analytics Platform",
  description: "Elite Spatial & Commercial Intelligence SaaS",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  )
}
