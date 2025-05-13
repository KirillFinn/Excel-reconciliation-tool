"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ChevronDown, ChevronUp } from "lucide-react"

interface DuplicateGroupDisplayProps {
  groups: any[][]
  title: string
  emptyMessage?: string
}

export function DuplicateGroupDisplay({
  groups,
  title,
  emptyMessage = "No duplicate groups found",
}: DuplicateGroupDisplayProps) {
  const [expandedGroups, setExpandedGroups] = useState<Record<number, boolean>>({})

  const toggleGroup = (index: number) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [index]: !prev[index],
    }))
  }

  if (!groups || groups.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-medium">{title}</h3>

      {groups.map((group, groupIndex) => (
        <Card key={groupIndex} className="overflow-hidden">
          <CardHeader className="bg-muted py-3 px-4">
            <div className="flex justify-between items-center">
              <CardTitle className="text-sm font-medium">
                Duplicate Group #{groupIndex + 1} <Badge variant="outline">{group.length} items</Badge>
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => toggleGroup(groupIndex)} className="h-8 w-8 p-0">
                {expandedGroups[groupIndex] ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                <span className="sr-only">Toggle group</span>
              </Button>
            </div>
          </CardHeader>

          {expandedGroups[groupIndex] && (
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">#</th>
                      {Object.keys(group[0] || {}).map((key) => (
                        <th key={key} className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                          {formatColumnName(key)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {group.map((item, itemIndex) => (
                      <tr key={itemIndex} className="border-b hover:bg-muted/20">
                        <td className="px-4 py-2 text-sm font-medium">{itemIndex + 1}</td>
                        {Object.entries(item).map(([key, value]) => (
                          <td key={key} className="px-4 py-2 text-sm">
                            {value !== null && value !== undefined ? String(value) : ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          )}
        </Card>
      ))}
    </div>
  )
}

function formatColumnName(name: string): string {
  if (!name) return ""
  return name
    .replace(/_/g, " ")
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (str) => str.toUpperCase())
    .trim()
}
