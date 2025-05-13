"use client"

import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface SheetSelectorProps {
  label: string
  sheets: string[]
  selectedSheet: string
  onSelectSheet: (sheet: string) => void
}

export function SheetSelector({ label, sheets, selectedSheet, onSelectSheet }: SheetSelectorProps) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={selectedSheet} onValueChange={onSelectSheet}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Select a sheet" />
        </SelectTrigger>
        <SelectContent>
          {sheets.map((sheet) => (
            <SelectItem key={sheet} value={sheet}>
              {sheet}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
