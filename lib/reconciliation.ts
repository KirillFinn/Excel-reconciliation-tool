import type { ColumnMapping } from "@/components/column-mapper"
import { getSheetData } from "@/lib/file-service"

interface Transaction {
  [key: string]: any
}

interface ReconciliationResults {
  matched: Transaction[]
  inFile1Only: Transaction[]
  inFile2Only: Transaction[]
  duplicatesInFile1: Transaction[]
  duplicatesInFile2: Transaction[]
  duplicateGroupsInFile1: Transaction[][]
  duplicateGroupsInFile2: Transaction[][]
  columnMappings: ColumnMapping[]
  file1SheetName: string
  file2SheetName: string
  summary: {
    totalInFile1: number
    totalInFile2: number
    matched: number
    inFile1Only: number
    inFile2Only: number
    duplicatesInFile1: number
    duplicatesInFile2: number
  }
}

export type ReconciliationProgressCallback = (stage: string, percent: number) => void

// Export the file service functions directly instead of re-exporting
export async function processFiles(
  file1: File,
  file2: File,
  sheet1: string,
  sheet2: string,
  columnMappings: ColumnMapping[],
  onProgress?: ReconciliationProgressCallback,
): Promise<ReconciliationResults> {
  if (!columnMappings || columnMappings.length === 0) {
    throw new Error("No column mappings provided")
  }

  try {
    // Update progress
    onProgress?.("Reading file 1 data...", 5)

    // Use our optimized file service to get data
    const workbook1Data = await getSheetData(file1, sheet1, (stage, percent) => {
      onProgress?.(`File 1: ${stage}`, 5 + percent * 0.2)
    })

    onProgress?.("Reading file 2 data...", 30)

    const workbook2Data = await getSheetData(file2, sheet2, (stage, percent) => {
      onProgress?.(`File 2: ${stage}`, 30 + percent * 0.2)
    })

    if (workbook1Data.length === 0) {
      throw new Error(`No data found in sheet "${sheet1}" of File 1`)
    }

    if (workbook2Data.length === 0) {
      throw new Error(`No data found in sheet "${sheet2}" of File 2`)
    }

    // Validate that all mapped columns exist in the data
    onProgress?.("Validating column mappings...", 55)
    validateColumnMappings(workbook1Data[0], workbook2Data[0], columnMappings)

    // Step 1: Find duplicates within each file first
    onProgress?.("Finding duplicates in File 1...", 60)
    const {
      duplicates: duplicatesInFile1,
      duplicateGroups: duplicateGroupsInFile1,
      uniqueItems: uniqueFile1Items,
    } = await findDuplicatesInFile(workbook1Data, (percent) => {
      onProgress?.("Finding duplicates in File 1...", 60 + percent * 0.1)
    })

    onProgress?.("Finding duplicates in File 2...", 70)
    const {
      duplicates: duplicatesInFile2,
      duplicateGroups: duplicateGroupsInFile2,
      uniqueItems: uniqueFile2Items,
    } = await findDuplicatesInFile(workbook2Data, (percent) => {
      onProgress?.("Finding duplicates in File 2...", 70 + percent * 0.1)
    })

    // Step 2: Compare the two files using the column mappings
    // Only use unique items (non-duplicates) for matching
    onProgress?.("Comparing files...", 80)
    const { matched, inFile1Only, inFile2Only } = await compareFilesWithMappings(
      uniqueFile1Items,
      uniqueFile2Items,
      columnMappings,
      (percent) => {
        onProgress?.("Comparing files...", 80 + percent * 0.18)
      },
    )

    // Create summary
    onProgress?.("Creating summary...", 98)
    const summary = {
      totalInFile1: workbook1Data.length,
      totalInFile2: workbook2Data.length,
      matched: matched.length,
      inFile1Only: inFile1Only.length,
      inFile2Only: inFile2Only.length,
      duplicatesInFile1: duplicatesInFile1.length,
      duplicatesInFile2: duplicatesInFile2.length,
    }

    onProgress?.("Reconciliation complete", 100)

    return {
      matched,
      inFile1Only,
      inFile2Only,
      duplicatesInFile1,
      duplicatesInFile2,
      duplicateGroupsInFile1: Array.from(duplicateGroupsInFile1.values()),
      duplicateGroupsInFile2: Array.from(duplicateGroupsInFile2.values()),
      columnMappings,
      file1SheetName: sheet1,
      file2SheetName: sheet2,
      summary,
    }
  } catch (error) {
    console.error("Error in processFiles:", error)
    throw error
  }
}

function validateColumnMappings(file1Sample: Transaction, file2Sample: Transaction, mappings: ColumnMapping[]): void {
  for (const mapping of mappings) {
    if (!(mapping.file1Column in file1Sample)) {
      throw new Error(`Column "${mapping.file1Column}" not found in File 1 data`)
    }
    if (!(mapping.file2Column in file2Sample)) {
      throw new Error(`Column "${mapping.file2Column}" not found in File 2 data`)
    }
  }
}

// Find duplicates within a single file
async function findDuplicatesInFile(
  data: Transaction[],
  onProgress?: (percent: number) => void,
): Promise<{
  duplicates: Transaction[]
  duplicateGroups: Map<string, Transaction[]>
  uniqueItems: Transaction[]
}> {
  const seen = new Map<string, number>()
  const duplicates: Transaction[] = []
  const duplicateGroups = new Map<string, Transaction[]>()
  const uniqueItems: Transaction[] = []
  const totalItems = data.length
  const chunkSize = 1000

  // Process in chunks to avoid blocking
  for (let i = 0; i < totalItems; i += chunkSize) {
    const end = Math.min(i + chunkSize, totalItems)
    const chunk = data.slice(i, end)

    // Process this chunk
    for (let j = 0; j < chunk.length; j++) {
      const item = chunk[j]
      const key = createCompositeKeyFromAllColumns(item)

      if (key) {
        if (seen.has(key)) {
          // This is a duplicate
          duplicates.push(item)

          // Add to duplicate groups for detailed reporting
          if (!duplicateGroups.has(key)) {
            // First time seeing a duplicate of this key, add the original item too
            const originalIndex = seen.get(key)!
            duplicateGroups.set(key, [data[originalIndex], item])
          } else {
            // Add to existing group
            duplicateGroups.get(key)!.push(item)
          }
        } else {
          seen.set(key, i + j)
          uniqueItems.push(item)
        }
      }
    }

    // Report progress
    if (onProgress) {
      onProgress(Math.min(100, Math.round((end / totalItems) * 100)))
    }

    // Yield to the main thread
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  return { duplicates, duplicateGroups, uniqueItems }
}

// Create a composite key from all columns in a transaction
function createCompositeKeyFromAllColumns(item: Transaction): string {
  if (!item || typeof item !== "object") return ""

  const keyParts: string[] = []

  // Sort keys for consistent ordering
  const keys = Object.keys(item).sort()

  for (const key of keys) {
    // Skip internal properties or functions
    if (key.startsWith("_") || typeof item[key] === "function") continue

    let value = item[key]

    // Handle null/undefined values
    if (value === null || value === undefined) {
      value = ""
    }

    // Convert to string
    value = String(value).trim()

    keyParts.push(`${key}:${value}`)
  }

  return keyParts.join("|")
}

// Update the compareFilesWithMappings function to process in chunks
async function compareFilesWithMappings(
  data1: Transaction[],
  data2: Transaction[],
  mappings: ColumnMapping[],
  onProgress?: (percent: number) => void,
): Promise<{
  matched: Transaction[]
  inFile1Only: Transaction[]
  inFile2Only: Transaction[]
}> {
  const matched: Transaction[] = []
  const inFile1Only: Transaction[] = []
  const inFile2Only = [...data2] // Start with all items from file 2

  // Create a map for faster lookups
  const file2Map = new Map<string, number[]>()
  const chunkSize = 1000

  // Process file2 in chunks to build the map
  for (let i = 0; i < data2.length; i += chunkSize) {
    const end = Math.min(i + chunkSize, data2.length)
    const chunk = data2.slice(i, end)

    for (let j = 0; j < chunk.length; j++) {
      const item = chunk[j]
      const key = createCompositeKey(item, mappings, false)

      if (key) {
        if (!file2Map.has(key)) {
          file2Map.set(key, [])
        }
        file2Map.get(key)!.push(i + j)
      }
    }

    // Allow the main thread to breathe
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  // Compare file 1 against file 2 in chunks
  for (let i = 0; i < data1.length; i += chunkSize) {
    const end = Math.min(i + chunkSize, data1.length)
    const chunk = data1.slice(i, end)

    for (let j = 0; j < chunk.length; j++) {
      const item1 = chunk[j]
      const key = createCompositeKey(item1, mappings, true)

      if (key && file2Map.has(key) && file2Map.get(key)!.length > 0) {
        // Found a match
        const indices = file2Map.get(key)!
        const matchIndex = indices.shift() // Get and remove the first matching index
        const item2 = inFile2Only[matchIndex]

        // Add to matched items - store item2 as _matchedWith property
        matched.push({
          ...item1,
          _matchedWith: item2,
        })

        // Mark as matched in inFile2Only
        inFile2Only[matchIndex] = null as any
      } else {
        // Not found in file 2
        inFile1Only.push(item1)
      }
    }

    // Report progress
    if (onProgress) {
      onProgress(Math.min(100, Math.round((end / data1.length) * 100)))
    }

    // Allow the main thread to breathe
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  // Filter out null values from inFile2Only
  const filteredFile2Only = inFile2Only.filter(Boolean)

  return {
    matched,
    inFile1Only,
    inFile2Only: filteredFile2Only,
  }
}

function createCompositeKey(item: Transaction, mappings: ColumnMapping[], isFile1: boolean): string {
  const keyParts: string[] = []

  mappings.forEach((mapping) => {
    const columnName = isFile1 ? mapping.file1Column : mapping.file2Column
    let value = item[columnName]

    // Handle null/undefined values
    if (value === null || value === undefined) {
      value = ""
    }

    // Convert to string and normalize if not exact match
    if (!mapping.isExactMatch && typeof value === "string") {
      // Case-insensitive and trim whitespace for fuzzy matching
      value = value.toString().toLowerCase().trim()
    } else {
      value = value.toString()
    }

    keyParts.push(value)
  })

  return keyParts.join("|")
}
