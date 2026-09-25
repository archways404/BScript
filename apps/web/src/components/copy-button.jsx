import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'

export function CopyButton({ value, label = 'Copy' }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <Button type="button" variant="ghost" size="icon" onClick={copy} aria-label={label} title={label}>
      {copied ? <Check className="text-success" /> : <Copy />}
    </Button>
  )
}
