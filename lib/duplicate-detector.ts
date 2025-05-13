import { processArrayInChunks } from "./data-utils"

export interface DuplicateGroup<T> {
  key: string
  items: T[]
}

/**
 * Find duplicates in a dataset based on specified columns
 * @param data The dataset to search for duplicates
 * @param columns The columns to use for duplicate detection (if empty, use all columns)
 * @param options Configuration options
 * @returns Object containing duplicates, duplicate groups, and unique items
 */
export async function findDuplicates<T extends Record<string, any>>(
  data: T[],
  columns: string[] = [],
  options: {
    caseSensitive?: boolean
    trimWhitespace?: boolean
    ignoreEmptyValues?: boolean
    onProgress?: (percent: number) => void
  } = {},
): Promise<{
  duplicates: T[]
  duplicateGroups: DuplicateGroup<T>[]
  uniqueItems: T[]
}> {
  if (!Array.isArray(data) || data.length === 0) {
    return { duplicates: [], duplicateGroups: [], uniqueItems: [] }
  }

  const { caseSensitive = false, trimWhitespace = true, ignoreEmptyValues = true, onProgress } = options

  // If no columns specified, use all columns from the first item
  const keysToCheck = columns.length > 0 ? columns : Object.keys(data[0] || {})

  if (keysToCheck.length === 0) {
    return { duplicates: [], duplicateGroups: [], uniqueItems: [] }
  }

  const seen = new Map<string, number>()
  const duplicates: T[] = []
  const duplicateGroupsMap = new Map<string, T[]>()
  const uniqueItems: T[] = []

  // Process in chunks for better performance with large datasets
  const chunkSize = 1000

  await processArrayInChunks(
    data,
    chunkSize,
    async (chunk, chunkIndex) => {
      const chunkDuplicates: T[] = []

      for (let i = 0; i < chunk.length; i++) {
        const item = chunk[i]
        const itemIndex = chunkIndex * chunkSize + i

        // Create a composite key from all specified columns
        const keyParts: string[] = []

        for (const key of keysToCheck) {
          let value = item[key]

          // Skip undefined or null values if configured to do so
          if ((value === undefined || value === null) && ignoreEmptyValues) {
            continue
          }

          // Convert to string and normalize if needed
          if (value !== null && value !== undefined) {
            value = String(value)

            if (!caseSensitive) {
              value = value.toLowerCase()
            }

            if (trimWhitespace && typeof value === "string") {
              value = value.trim()
            }
          } else {
            value = ""
          }

          keyParts.push(`${key}:${value}`)
        }

        const compositeKey = keyParts.join("|")

        if (compositeKey) {
          if (seen.has(compositeKey)) {
            // This is a duplicate
            chunkDuplicates.push(item)

            // Add to duplicate groups for detailed reporting
            if (!duplicateGroupsMap.has(compositeKey)) {
              // First time seeing a duplicate of this key, add the original item too
              const originalIndex = seen.get(compositeKey)!
              duplicateGroupsMap.set(compositeKey, [data[originalIndex], item])
            } else {
              // Add to existing group
              duplicateGroupsMap.get(compositeKey)!.push(item)
            }
          } else {
            seen.set(compositeKey, itemIndex)
            uniqueItems.push(item)
          }
        }
      }

      return chunkDuplicates
    },
    (processed, total) => {
      if (onProgress) {
        onProgress(Math.round((processed / total) * 100))
      }
    },
  ).then((chunkResults) => {
    // Combine all chunk results
    for (const chunkDuplicates of chunkResults) {
      duplicates.push(...chunkDuplicates)
    }
  })

  // Convert the Map to an array of DuplicateGroup objects
  const duplicateGroups: DuplicateGroup<T>[] = Array.from(duplicateGroupsMap.entries()).map(([key, items]) => ({
    key,
    items,
  }))

  return { duplicates, duplicateGroups, uniqueItems }
}

/**
 * Find duplicates in a dataset based on all columns
 * @param data The dataset to search for duplicates
 * @param onProgress Optional progress callback
 * @returns Object containing duplicates, duplicate groups, and unique items
 */
export async function findExactDuplicates<T extends Record<string, any>>(
  data: T[],
  onProgress?: (percent: number) => void,
): Promise<{
  duplicates: T[]
  duplicateGroups: Map<string, T[]>
  uniqueItems: T[]
}> {
  const seen = new Map<string, number>()
  const duplicates: T[] = []
  const duplicateGroups = new Map<string, T[]>()
  const uniqueItems: T[] = []
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
function createCompositeKeyFromAllColumns(item: Record<string, any>): string {
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
