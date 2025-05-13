/**
 * Utility functions for handling large datasets efficiently
 */

/**
 * Process a large array in chunks to avoid memory issues
 * @param array The array to process
 * @param chunkSize The size of each chunk
 * @param processor The function to process each chunk
 * @param onProgress Optional callback for progress updates
 */
export async function processArrayInChunks<T, R>(
  array: T[],
  chunkSize: number,
  processor: (chunk: T[], chunkIndex: number) => Promise<R[]> | R[],
  onProgress?: (processed: number, total: number) => void,
): Promise<R[]> {
  if (!Array.isArray(array)) {
    throw new Error("Input must be an array")
  }

  const result: R[] = []
  const totalItems = array.length
  const totalChunks = Math.ceil(totalItems / chunkSize)

  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize
    const end = Math.min(start + chunkSize, totalItems)
    const chunk = array.slice(start, end)

    // Process this chunk
    const processedChunk = await processor(chunk, i)
    result.push(...processedChunk)

    // Report progress
    if (onProgress) {
      onProgress(end, totalItems)
    }

    // Yield to the main thread to prevent UI freezing
    if (i < totalChunks - 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }

  return result
}

/**
 * Safely stringify a value, handling circular references and large objects
 * @param value The value to stringify
 * @param maxDepth Maximum depth to traverse
 * @param maxLength Maximum length of the resulting string
 */
export function safeStringify(value: any, maxDepth = 3, maxLength = 10000): string {
  const seen = new WeakSet()

  function replacer(key: string, value: any, depth = 0): any {
    // Check for circular references
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) {
        return "[Circular Reference]"
      }
      seen.add(value)

      // Check depth
      if (depth >= maxDepth) {
        if (Array.isArray(value)) {
          return `[Array(${value.length})]`
        }
        return "[Object]"
      }

      // Handle arrays and objects
      if (Array.isArray(value)) {
        return value.map((item, index) => replacer(String(index), item, depth + 1))
      }

      const obj: Record<string, any> = {}
      for (const k in value) {
        if (Object.prototype.hasOwnProperty.call(value, k)) {
          obj[k] = replacer(k, value[k], depth + 1)
        }
      }
      return obj
    }

    return value
  }

  try {
    const result = JSON.stringify(value, (key, val) => replacer(key, val))
    if (result && result.length > maxLength) {
      return result.substring(0, maxLength) + "...[truncated]"
    }
    return result
  } catch (error) {
    return `[Error during stringify: ${error instanceof Error ? error.message : String(error)}]`
  }
}

/**
 * Estimate the memory size of an object (rough approximation)
 * @param object The object to measure
 */
export function estimateObjectSize(object: any): number {
  const objectList = new WeakSet()

  function sizeOf(value: any): number {
    if (value === null) return 0

    const type = typeof value
    if (type === "boolean") return 4
    if (type === "number") return 8
    if (type === "string") return value.length * 2
    if (type === "object") {
      if (objectList.has(value)) return 0
      objectList.add(value)

      let size = 0
      if (Array.isArray(value)) {
        size = 40 // Array overhead
        for (let i = 0; i < value.length; i++) {
          size += sizeOf(value[i])
        }
      } else {
        size = 40 // Object overhead
        for (const key in value) {
          if (Object.prototype.hasOwnProperty.call(value, key)) {
            size += key.length * 2 // Key size
            size += sizeOf(value[key]) // Value size
          }
        }
      }
      return size
    }
    return 0 // Functions, undefined, etc.
  }

  return sizeOf(object)
}
