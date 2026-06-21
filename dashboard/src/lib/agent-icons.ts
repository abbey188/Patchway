import {
  Bot, Cpu, Zap, CircuitBoard, Scan, Binary,
  Radar, Terminal, Fingerprint, Shield,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const ICON_POOL: LucideIcon[] = [
  Bot, Cpu, Zap, CircuitBoard, Scan, Binary,
  Radar, Terminal, Fingerprint, Shield,
]

function hashName(name: string): number {
  let h = 5381
  for (let i = 0; i < name.length; i++) {
    h = ((h << 5) + h + name.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

export function getAgentIcon(name: string): LucideIcon {
  return ICON_POOL[hashName(name) % ICON_POOL.length]
}
