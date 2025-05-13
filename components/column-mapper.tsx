"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { PlusCircle, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"

export interface ColumnMapping {
  file1Column: string
  file2Column: string
  isExactMatch: boolean
}

interface ColumnMapperProps {
  file1Columns: string[]
  file2Columns: string[]
  onSaveMapping: (mappings: ColumnMapping[]) => void
  onCancel: () => void
}

export function ColumnMapper({ file1Columns, file2Columns, onSaveMapping, onCancel }: ColumnMapperProps) {
  const [mappings, setMappings] = useState<ColumnMapping[]>([{ file1Column: "", file2Column: "", isExactMatch: true }])

  // Initialize with first columns if available
  useEffect(() => {
    // Initialize with first columns if available
    if (file1Columns.length > 0 && file2Columns.length > 0) {
      setMappings([{ file1Column: file1Columns[0], file2Column: file2Columns[0], isExactMatch: true }])
    } else if (file1Columns.length > 0) {
      // Only file1 has columns
      setMappings([{ file1Column: file1Columns[0], file2Column: "", isExactMatch: true }])
    } else if (file2Columns.length > 0) {
      // Only file2 has columns
      setMappings([{ file1Column: "", file2Column: file2Columns[0], isExactMatch: true }])
    }
  }, [file1Columns, file2Columns])

  const addMapping = () => {
    setMappings([...mappings, { file1Column: "", file2Column: "", isExactMatch: true }])
  }

  const removeMapping = (index: number) => {
    const newMappings = [...mappings]
    newMappings.splice(index, 1)
    setMappings(newMappings)
  }

  const updateMapping = (index: number, field: keyof ColumnMapping, value: string | boolean) => {
    const newMappings = [...mappings]
    newMappings[index] = { ...newMappings[index], [field]: value }
    setMappings(newMappings)
  }

  const handleSave = () => {
    // Filter out incomplete mappings
    const validMappings = mappings.filter((m) => m.file1Column && m.file2Column)
    onSaveMapping(validMappings)
  }

  const isValid = mappings.some((m) => m.file1Column && m.file2Column)

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Map Columns for Matching</CardTitle>
        <CardDescription>
          Select which columns to compare between the two files. Add multiple mappings to improve matching accuracy.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="max-h-[400px] overflow-y-auto pr-1">
          <div className="space-y-4">
            {mappings.map((mapping, index) => (
              <div
                key={index}
                className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto_auto] gap-4 items-end border-b pb-4"
              >
                <div>
                  <Label className="mb-2 block">File 1 Column</Label>
                  <Select
                    value={mapping.file1Column}
                    onValueChange={(value) => updateMapping(index, "file1Column", value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select column" />
                    </SelectTrigger>
                    <SelectContent>
                      {file1Columns.map((column) => (
                        <SelectItem key={column} value={column}>
                          {formatColumnName(column)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="mb-2 block">File 2 Column</Label>
                  <Select
                    value={mapping.file2Column}
                    onValueChange={(value) => updateMapping(index, "file2Column", value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select column" />
                    </SelectTrigger>
                    <SelectContent>
                      {file2Columns.map((column) => (
                        <SelectItem key={column} value={column}>
                          {formatColumnName(column)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center space-x-2">
                  <Switch
                    checked={mapping.isExactMatch}
                    onCheckedChange={(checked) => updateMapping(index, "isExactMatch", checked)}
                    id={`exact-match-${index}`}
                  />
                  <Label htmlFor={`exact-match-${index}`}>Exact match</Label>
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeMapping(index)}
                  disabled={mappings.length === 1}
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="sr-only">Remove mapping</span>
                </Button>
              </div>
            ))}

            <Button variant="outline" onClick={addMapping} className="w-full">
              <PlusCircle className="h-4 w-4 mr-2" />
              Add Another Column Mapping
            </Button>

            <div className="mt-6">
              <h3 className="text-sm font-medium mb-2">Matching Logic:</h3>
              <p className="text-sm text-muted-foreground mb-2">
                Transactions will match if ALL of the mapped columns match between files.
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                {mappings
                  .filter((m) => m.file1Column && m.file2Column)
                  .map((mapping, index) => (
                    <Badge key={index} variant="secondary">
                      {formatColumnName(mapping.file1Column)} ↔ {formatColumnName(mapping.file2Column)}
                      {!mapping.isExactMatch && " (fuzzy)"}
                    </Badge>
                  ))}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex justify-between border-t p-6">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={!isValid}>
          Save & Continue
        </Button>
      </CardFooter>
    </Card>
  )
}

function formatColumnName(name: string): string {
  return name
    .replace(/_/g, " ")
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (str) => str.toUpperCase())
    .trim()
}
