import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getBaseUrl() {
  if (typeof window !== "undefined")
    // browser should use relative path
    return ""

  if (process.env.VERCEL_URL)
    // reference for vercel.com
    return `https://${process.env.VERCEL_URL}`

  if (process.env.RENDER_INTERNAL_HOSTNAME)
    // reference for render.com
    return `http://${process.env.RENDER_INTERNAL_HOSTNAME}:${process.env.PORT}`

  // assume localhost
  return `http://localhost:${process.env.PORT ?? 3000}`
}

export function convertTimestampToDate(timestamp: number) {
  const date = new Date(timestamp * 1000)
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

export function formatBytes(bytes: number) {
  const KB = 1024
  const MB = KB * 1024
  const GB = MB * 1024

  let formattedSize
  let unit

  if (bytes >= GB) {
    formattedSize = (bytes / GB).toFixed(2)
    unit = "GB"
  } else if (bytes >= MB) {
    formattedSize = (bytes / MB).toFixed(2)
    unit = "MB"
  } else if (bytes >= KB) {
    formattedSize = (bytes / KB).toFixed(2)
    unit = "KB"
  } else {
    formattedSize = bytes
    unit = "bytes"
  }

  return `${formattedSize} ${unit}`
}
