import type { ColumnMapping } from "@/components/column-mapper"
// Import the new streaming function and the new worker-based getSheetColumns
import { getSheetDataStreamed, getSheetColumnsWithWorker } from "@/lib/file-service"

interface Transaction {
  [key: string]: any
}

interface ReconciliationResults {
  matched: Transaction[]
  inFile1Only: Transaction[]
  inFile2Only: Transaction[]
  duplicatesInFile1: Transaction[] // These will be individual duplicate items, not groups
  duplicatesInFile2: Transaction[] // These will be individual duplicate items, not groups
  duplicateGroupsInFile1: Transaction[][] // Actual groups of duplicates
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
    duplicatesInFile1: number // Count of individual duplicate items
    duplicatesInFile2: number // Count of individual duplicate items
  }
}

export type ReconciliationProgressCallback = (stage: string, percent: number) => void

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
    onProgress?.("Initializing...", 0)

    // Step 0: Validate column mappings by fetching headers using the worker
    onProgress?.("Fetching headers for File 1...", 1)
    const file1Headers = await getSheetColumnsWithWorker(file1, sheet1, (stage, percent) => {
      onProgress?.(`File 1 Headers: ${stage}`, 1 + percent * 0.02) // Allocate 2% for this (1-3%)
    })
    onProgress?.("Fetching headers for File 2...", 3)
    const file2Headers = await getSheetColumnsWithWorker(file2, sheet2, (stage, percent) => {
      onProgress?.(`File 2 Headers: ${stage}`, 3 + percent * 0.02) // Allocate 2% for this (3-5%)
    })

    validateColumnMappingsAgainstHeaders(file1Headers, file2Headers, columnMappings)
    onProgress?.("Column mappings validated.", 5) // Validation itself is quick

    // Create async iterators for streaming data, progress now starts after header loading
    const file1DataStream = getSheetDataStreamed(file1, sheet1, (stage, percent) => {
      onProgress?.(`File 1 Data: ${stage}`, 5 + percent * 0.20) // 5% to 25% (same allocation for data streaming part)
    })
    const file2DataStream = getSheetDataStreamed(file2, sheet2, (stage, percent) => {
      onProgress?.(`File 2 Data: ${stage}`, 25 + percent * 0.20) // 25% to 45% (same allocation for data streaming part)
    })

    // Step 1: Find duplicates within each file first
    onProgress?.("Finding duplicates in File 1...", 45)
    const {
      duplicates: duplicatesInFile1,
      duplicateGroups: duplicateGroupsInFile1,
      uniqueItemsStream: uniqueFile1ItemsStream,
      getCount: file1TotalCountGetter,
    } = await findDuplicatesInFileStream(file1DataStream, (percent) => { // Call new stream function
      onProgress?.("Processing File 1 for duplicates...", 45 + percent * 0.15) // 45% to 60%
    })

    onProgress?.("Finding duplicates in File 2...", 60)
    const {
      duplicates: duplicatesInFile2,
      duplicateGroups: duplicateGroupsInFile2,
      uniqueItemsStream: uniqueFile2ItemsStream,
      getCount: file2TotalCountGetter,
    } = await findDuplicatesInFileStream(file2DataStream, (percent) => { // Call new stream function
      onProgress?.("Processing File 2 for duplicates...", 60 + percent * 0.15) // 60% to 75%
    })

    // Step 2: Compare the two streams of unique items
    onProgress?.("Comparing unique items from files...", 75)
    const { matched, inFile1Only, inFile2Only } = await compareUniqueItemStreams(
      uniqueFile1ItemsStream,
      uniqueFile2ItemsStream,
      columnMappings,
      (percent) => {
        onProgress?.("Comparing files...", 75 + percent * 0.23) // 75% to 98%
      },
    )

    onProgress?.("Finalizing results...", 98)
    const summary = {
      totalInFile1: file1TotalCountGetter(),
      totalInFile2: file2TotalCountGetter(),
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
      duplicatesInFile1, // individual duplicate items
      duplicatesInFile2, // individual duplicate items
      duplicateGroupsInFile1: Array.from(duplicateGroupsInFile1.values()), // actual groups
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

// Updated validation function to work with arrays of headers
function validateColumnMappingsAgainstHeaders(
  file1Headers: string[],
  file2Headers: string[],
  mappings: ColumnMapping[],
): void {
  const file1HeaderSet = new Set(file1Headers)
  const file2HeaderSet = new Set(file2Headers)

  for (const mapping of mappings) {
    if (!file1HeaderSet.has(mapping.file1Column)) {
      throw new Error(`Column "${mapping.file1Column}" not found in File 1 headers. Available: ${file1Headers.join(", ")}`)
    }
    if (!file2HeaderSet.has(mapping.file2Column)) {
      throw new Error(`Column "${mapping.file2Column}" not found in File 2 headers. Available: ${file2Headers.join(", ")}`)
    }
  }
}

// Stream-based duplicate finding (Definition will follow)
// async function findDuplicatesInFileStream(...)
// async function compareUniqueItemStreams(...)

// Stream-based duplicate finding
async function findDuplicatesInFileStream(
  dataStream: AsyncGenerator<Transaction[], void, void>,
  onProgress?: (percent: number) => void,
): Promise<{
  duplicates: Transaction[]
  duplicateGroups: Map<string, Transaction[]>
  uniqueItemsStream: AsyncGenerator<Transaction[], void, void>
  getCount: () => number // Getter function for the processed count
}> {
  const seen = new Map<string, Transaction>()
  const duplicates: Transaction[] = []
  const duplicateGroups = new Map<string, Transaction[]>()
  let processedCount = 0

  async function* processStreamAndYieldUniques(): AsyncGenerator<Transaction[], void, void> {
    let chunkIteration = 0
    for await (const chunk of dataStream) {
      if (!chunk || chunk.length === 0) continue

      const uniqueItemsInChunk: Transaction[] = []
      processedCount += chunk.length

      for (const item of chunk) {
        const key = createCompositeKeyFromAllColumns(item)
        if (key) {
          if (seen.has(key)) {
            duplicates.push(item)
            if (!duplicateGroups.has(key)) {
              duplicateGroups.set(key, [seen.get(key)!, item])
            } else {
              duplicateGroups.get(key)!.push(item)
            }
          } else {
            seen.set(key, item)
            uniqueItemsInChunk.push(item)
          }
        }
      }

      if (uniqueItemsInChunk.length > 0) {
        yield uniqueItemsInChunk
      }
      chunkIteration++
      if (onProgress) {
        onProgress(chunkIteration % 100) // Basic progress
      }
    }
  }

  return {
    duplicates,
    duplicateGroups,
    uniqueItemsStream: processStreamAndYieldUniques(),
    getCount: () => processedCount,
  }
}

// Definition for compareUniqueItemStreams
async function compareUniqueItemStreams(
  uniqueFile1ItemsStream: AsyncGenerator<Transaction[], void, void>,
  uniqueFile2ItemsStream: AsyncGenerator<Transaction[], void, void>,
  mappings: ColumnMapping[],
  onProgress?: (percent: number) => void,
): Promise<{
  matched: Transaction[]
  inFile1Only: Transaction[]
  inFile2Only: Transaction[]
}> {
  const matched: Transaction[] = []
  const inFile1Only: Transaction[] = []
  const file2Map = new Map<string, Transaction[]>() // Key: composite key, Value: array of items from file 2
  const allFile2UniqueItems: (Transaction | null)[] = [] // Store all unique items from file 2 to find those not matched
  let file2CurrentIndex = 0

  onProgress?.("Building map from File 2 unique items...", 0)
  let file2ChunksProcessed = 0
  for await (const chunk of uniqueFile2ItemsStream) {
    if (!chunk || chunk.length === 0) continue
    for (const item of chunk) {
      allFile2UniqueItems.push(item) // Add to list, store original index implicitly
      const key = createCompositeKey(item, mappings, false) // Use mapping-specific key
      if (key) {
        if (!file2Map.has(key)) {
          file2Map.set(key, [])
        }
        // Store the index in allFile2UniqueItems to mark later if matched
        file2Map.get(key)!.push({ ...item, _originalIndexInAllFile2: file2CurrentIndex })
      }
      file2CurrentIndex++
    }
    file2ChunksProcessed++
    // Simple progress for map building, could be improved if total chunks known
    if (onProgress) onProgress(Math.min(30, file2ChunksProcessed)) // Assign up to 30% for this phase
  }
  onProgress?.("Map from File 2 built. Comparing File 1...", 30)

  let file1ItemsProcessed = 0
  // Assuming total unique items in file 1 is unknown, base progress on chunks or time.
  // If a getCount() was available for uniqueFile1ItemsStream, it would be better.

  for await (const chunk of uniqueFile1ItemsStream) {
    if (!chunk || chunk.length === 0) continue
    for (const item1 of chunk) {
      const key = createCompositeKey(item1, mappings, true)
      let wasMatched = false
      if (key && file2Map.has(key)) {
        const potentialMatchesFile2 = file2Map.get(key)!
        if (potentialMatchesFile2.length > 0) {
          const matchedFile2ItemWrapper = potentialMatchesFile2.shift()! // Get first available match
          // Mark the original item in allFile2UniqueItems as null (matched)
          allFile2UniqueItems[matchedFile2ItemWrapper._originalIndexInAllFile2!] = null

          // Construct the matched transaction object
          // The '_matchedWith' can store the actual item from file 2 without the wrapper property
          const file2ActualItem = { ...matchedFile2ItemWrapper };
          delete file2ActualItem._originalIndexInAllFile2;

          matched.push({
            ...item1,
            _matchedWith: file2ActualItem,
          })
          wasMatched = true
        }
      }

      if (!wasMatched) {
        inFile1Only.push(item1)
      }
      file1ItemsProcessed++
    }
    if (onProgress) {
         // Progress for file 1 processing, from 30% to 95%
        onProgress(30 + Math.min(65, (file1ItemsProcessed % 1000) * (65/1000) )) // Placeholder progress
    }
  }

  onProgress?.("Filtering unmatched items from File 2...", 95)
  const inFile2Only = allFile2UniqueItems.filter(item => item !== null) as Transaction[]

  onProgress?.("Comparison complete.", 100)

  return {
    matched,
    inFile1Only,
    inFile2Only,
  }
}


// Create a composite key from all columns in a transaction for duplicate checking
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
