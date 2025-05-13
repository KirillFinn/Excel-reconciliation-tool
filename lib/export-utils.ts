import * as XLSX from "xlsx"
import type { ColumnMapping } from "@/components/column-mapper"

// Create a type for the export progress callback
export type ExportProgressCallback = (stage: string, percent: number) => void

// Create a type for the export result
export type ExportResult = {
  success: boolean
  url?: string
  fileName?: string
  error?: string
  errorDetails?: any
}

// Define export categories
export type ExportCategory =
  | "matched"
  | "inFile1Only"
  | "inFile2Only"
  | "duplicatesInFile1"
  | "duplicatesInFile2"
  | "full"

// Category display names for file naming
const CATEGORY_NAMES: Record<ExportCategory, string> = {
  matched: "Matched_Transactions",
  inFile1Only: "File1_Only_Transactions",
  inFile2Only: "File2_Only_Transactions",
  duplicatesInFile1: "File1_Duplicates",
  duplicatesInFile2: "File2_Duplicates",
  full: "Full_Report",
}

// Maximum number of rows to process in a single chunk
const MAX_CHUNK_SIZE = 2000

// Maximum time (ms) to spend on a single processing operation before yielding to UI
const MAX_PROCESSING_TIME = 100

// Maximum blob size (in bytes) - most browsers have a limit around 2GB
// We'll set a conservative limit of 500MB to be safe
const MAX_BLOB_SIZE = 500 * 1024 * 1024

/**
 * Export a specific category of reconciliation data to Excel
 */
export async function exportCategoryToExcel(
  data: any,
  category: ExportCategory,
  fileName: string,
  onProgress?: ExportProgressCallback,
): Promise<ExportResult> {
  try {
    // Report initial progress
    onProgress?.(`Initializing ${category} export`, 0)

    // Validate input data
    if (!data) {
      throw new Error("No data provided for export")
    }

    // Create a new workbook
    const wb = XLSX.utils.book_new()

    // Allow UI to update
    await sleep(10)

    // Add summary sheet with basic info
    try {
      const summaryData = createCategorySummarySheet(data, category)
      const summaryWs = XLSX.utils.aoa_to_sheet(summaryData)
      XLSX.utils.book_append_sheet(wb, summaryWs, "Summary")
      onProgress?.("Created summary sheet", 20)
    } catch (error) {
      console.error("Error creating summary sheet:", error)
      onProgress?.("Error creating summary sheet", 100)
      return {
        success: false,
        error: "Failed to create summary sheet",
        errorDetails: error instanceof Error ? error.message : String(error),
      }
    }

    // Get the data for the specific category
    let categoryData: any[] = []
    let sheetName = "Data"

    switch (category) {
      case "matched":
        categoryData = Array.isArray(data.matched) ? data.matched.filter(Boolean) : []
        sheetName = "Matched Transactions"
        break
      case "inFile1Only":
        categoryData = Array.isArray(data.inFile1Only) ? data.inFile1Only.filter(Boolean) : []
        sheetName = "File 1 Only"
        break
      case "inFile2Only":
        categoryData = Array.isArray(data.inFile2Only) ? data.inFile2Only.filter(Boolean) : []
        sheetName = "File 2 Only"
        break
      case "duplicatesInFile1":
        categoryData = Array.isArray(data.duplicatesInFile1) ? data.duplicatesInFile1.filter(Boolean) : []
        sheetName = "Duplicates in File 1"

        // Also include duplicate groups if available
        if (
          data.duplicateGroupsInFile1 &&
          Array.isArray(data.duplicateGroupsInFile1) &&
          data.duplicateGroupsInFile1.length > 0
        ) {
          try {
            const flattenedGroups = data.duplicateGroupsInFile1.flat().filter(Boolean)
            if (flattenedGroups.length > 0) {
              await processSheetData(wb, "Duplicate Groups", flattenedGroups, 40, 60, onProgress)
            }
          } catch (error) {
            console.error("Error processing duplicate groups:", error)
            // Continue with export even if this fails
          }
        }
        break
      case "duplicatesInFile2":
        categoryData = Array.isArray(data.duplicatesInFile2) ? data.duplicatesInFile2.filter(Boolean) : []
        sheetName = "Duplicates in File 2"

        // Also include duplicate groups if available
        if (
          data.duplicateGroupsInFile2 &&
          Array.isArray(data.duplicateGroupsInFile2) &&
          data.duplicateGroupsInFile2.length > 0
        ) {
          try {
            const flattenedGroups = data.duplicateGroupsInFile2.flat().filter(Boolean)
            if (flattenedGroups.length > 0) {
              await processSheetData(wb, "Duplicate Groups", flattenedGroups, 40, 60, onProgress)
            }
          } catch (error) {
            console.error("Error processing duplicate groups:", error)
            // Continue with export even if this fails
          }
        }
        break
      case "full":
        // This should never happen as we use exportToExcel for full reports
        return exportToExcel(data, fileName, onProgress)
    }

    // Check if the dataset is too large
    if (categoryData.length > 100000) {
      onProgress?.(`Warning: Large dataset detected (${categoryData.length.toLocaleString()} rows)`, 40)
      await sleep(500) // Give time for the UI to update
    }

    // Process the category data
    if (categoryData.length > 0) {
      try {
        await processSheetData(wb, sheetName, categoryData, 30, 80, onProgress)
      } catch (error) {
        console.error(`Error processing ${category} data:`, error)
        onProgress?.(`Error processing ${category} data`, 100)
        return {
          success: false,
          error: `Failed to process ${category} data: ${error instanceof Error ? error.message : String(error)}`,
          errorDetails: error instanceof Error ? error.stack : String(error),
        }
      }
    } else {
      // Add an empty sheet with a message
      const ws = XLSX.utils.aoa_to_sheet([["No data available for this category"]])
      XLSX.utils.book_append_sheet(wb, ws, sheetName)
      onProgress?.(`No data available for ${category}`, 80)
    }

    onProgress?.("Generating Excel file", 90)

    try {
      // Add this before the safelyWriteWorkbook call in exportCategoryToExcel
      await attemptMemoryCleanup()
      // Write the workbook to a buffer
      const wbout = await safelyWriteWorkbook(wb, onProgress)

      // Check if the output is too large for a blob
      if (wbout.byteLength > MAX_BLOB_SIZE) {
        throw new Error(
          `The generated Excel file is too large (${Math.round(wbout.byteLength / (1024 * 1024))}MB) for browser download. Try exporting a smaller subset of data.`,
        )
      }

      // Create the blob
      const blob = new Blob([wbout], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })

      // Create a URL for the blob
      const url = URL.createObjectURL(blob)
      const categoryName = CATEGORY_NAMES[category] || category
      const formattedFileName = `${fileName}_${categoryName}_${formatDate(new Date())}.xlsx`

      // Report completion
      onProgress?.("Export complete", 100)

      return {
        success: true,
        url,
        fileName: formattedFileName,
      }
    } catch (error) {
      console.error("Error generating Excel file:", error)
      onProgress?.("Error generating Excel file", 100)
      return {
        success: false,
        error: `Failed to generate Excel file: ${error instanceof Error ? error.message : String(error)}`,
        errorDetails: error instanceof Error ? error.stack : String(error),
      }
    }
  } catch (error) {
    console.error("Export error:", error)
    onProgress?.("Export failed", 100)
    return {
      success: false,
      error: `Export failed: ${error instanceof Error ? error.message : String(error)}`,
      errorDetails: error instanceof Error ? error.stack : String(error),
    }
  }
}

// Create a summary sheet for a specific category export
function createCategorySummarySheet(data: any, category: ExportCategory) {
  // Validate data structure
  if (!data) {
    return [["No data available for summary"]]
  }

  const summaryRows = [
    ["Reconciliation Report - " + CATEGORY_NAMES[category]],
    [""],
    ["Generated on", formatDate(new Date())],
    [""],
    ["File 1 Sheet", data.file1SheetName || "Unknown"],
    ["File 2 Sheet", data.file2SheetName || "Unknown"],
    [""],
  ]

  // Add category-specific information
  switch (category) {
    case "matched":
      summaryRows.push(
        ["Matched transactions", data.summary?.matched || 0],
        [
          "Percentage of File 1",
          data.summary?.totalInFile1 > 0
            ? ((data.summary.matched / data.summary.totalInFile1) * 100).toFixed(2) + "%"
            : "0%",
        ],
        [
          "Percentage of File 2",
          data.summary?.totalInFile2 > 0
            ? ((data.summary.matched / data.summary.totalInFile2) * 100).toFixed(2) + "%"
            : "0%",
        ],
      )
      break
    case "inFile1Only":
      summaryRows.push(
        ["Transactions in File 1 only", data.summary?.inFile1Only || 0],
        [
          "Percentage of File 1",
          data.summary?.totalInFile1 > 0
            ? ((data.summary.inFile1Only / data.summary.totalInFile1) * 100).toFixed(2) + "%"
            : "0%",
        ],
      )
      break
    case "inFile2Only":
      summaryRows.push(
        ["Transactions in File 2 only", data.summary?.inFile2Only || 0],
        [
          "Percentage of File 2",
          data.summary?.totalInFile2 > 0
            ? ((data.summary.inFile2Only / data.summary.totalInFile2) * 100).toFixed(2) + "%"
            : "0%",
        ],
      )
      break
    case "duplicatesInFile1":
      summaryRows.push(
        ["Duplicates in File 1", data.summary?.duplicatesInFile1 || 0],
        [
          "Percentage of File 1",
          data.summary?.totalInFile1 > 0
            ? ((data.summary.duplicatesInFile1 / data.summary.totalInFile1) * 100).toFixed(2) + "%"
            : "0%",
        ],
        [
          "Number of duplicate groups",
          Array.isArray(data.duplicateGroupsInFile1) ? data.duplicateGroupsInFile1.length : 0,
        ],
      )
      break
    case "duplicatesInFile2":
      summaryRows.push(
        ["Duplicates in File 2", data.summary?.duplicatesInFile2 || 0],
        [
          "Percentage of File 2",
          data.summary?.totalInFile2 > 0
            ? ((data.summary.duplicatesInFile2 / data.summary.totalInFile2) * 100).toFixed(2) + "%"
            : "0%",
        ],
        [
          "Number of duplicate groups",
          Array.isArray(data.duplicateGroupsInFile2) ? data.duplicateGroupsInFile2.length : 0,
        ],
      )
      break
  }

  // Add column mappings
  summaryRows.push([""], ["Column Mappings"], ["File 1 Column", "File 2 Column", "Exact Match"])

  // Add the column mappings
  if (Array.isArray(data.columnMappings)) {
    data.columnMappings.forEach((mapping: ColumnMapping) => {
      summaryRows.push([mapping.file1Column || "", mapping.file2Column || "", mapping.isExactMatch ? "Yes" : "No"])
    })
  } else {
    summaryRows.push(["No column mappings available"])
  }

  return summaryRows
}

export async function exportToExcel(
  data: any,
  fileName: string,
  onProgress?: ExportProgressCallback,
): Promise<ExportResult> {
  try {
    // Report initial progress
    onProgress?.("Initializing export", 0)

    // Validate input data
    if (!data) {
      throw new Error("No data provided for export")
    }

    // Estimate total data size to check if it's too large
    const estimatedSize = estimateDataSize(data)
    if (estimatedSize > MAX_BLOB_SIZE) {
      throw new Error(
        `The dataset is too large (approximately ${Math.round(estimatedSize / (1024 * 1024))}MB) to export as a single file. Try exporting smaller subsets of data.`,
      )
    }

    // Create a new workbook
    const wb = XLSX.utils.book_new()

    // Allow UI to update
    await sleep(10)
    onProgress?.("Creating summary sheet", 5)

    // Add summary sheet
    try {
      const summaryData = createSummarySheet(data)
      const summaryWs = XLSX.utils.aoa_to_sheet(summaryData)
      XLSX.utils.book_append_sheet(wb, summaryWs, "Summary")
    } catch (error) {
      console.error("Error creating summary sheet:", error)
      onProgress?.("Error creating summary sheet", 100)
      return {
        success: false,
        error: "Failed to create summary sheet",
        errorDetails: error instanceof Error ? error.message : String(error),
      }
    }

    // Process matched data
    if (data.matched && Array.isArray(data.matched) && data.matched.length > 0) {
      try {
        await processSheetData(wb, "Matched", data.matched, 10, 35, onProgress)
      } catch (error) {
        console.error("Error processing matched data:", error)
        onProgress?.("Error processing matched data", 100)
        return {
          success: false,
          error: "Failed to process matched data",
          errorDetails: error instanceof Error ? error.message : String(error),
        }
      }
    } else {
      onProgress?.("No matched data to export", 35)
    }

    // Process File 1 only data
    if (data.inFile1Only && Array.isArray(data.inFile1Only) && data.inFile1Only.length > 0) {
      try {
        await processSheetData(wb, "In File 1 Only", data.inFile1Only, 35, 55, onProgress)
      } catch (error) {
        console.error("Error processing File 1 data:", error)
        onProgress?.("Error processing File 1 data", 100)
        return {
          success: false,
          error: "Failed to process File 1 data",
          errorDetails: error instanceof Error ? error.message : String(error),
        }
      }
    } else {
      onProgress?.("No File 1 only data to export", 55)
    }

    // Process File 2 only data
    if (data.inFile2Only && Array.isArray(data.inFile2Only) && data.inFile2Only.length > 0) {
      try {
        await processSheetData(wb, "In File 2 Only", data.inFile2Only, 55, 75, onProgress)
      } catch (error) {
        console.error("Error processing File 2 data:", error)
        onProgress?.("Error processing File 2 data", 100)
        return {
          success: false,
          error: "Failed to process File 2 data",
          errorDetails: error instanceof Error ? error.message : String(error),
        }
      }
    } else {
      onProgress?.("No File 2 only data to export", 75)
    }

    // Process duplicates
    if (data.duplicatesInFile1 && Array.isArray(data.duplicatesInFile1) && data.duplicatesInFile1.length > 0) {
      try {
        await processSheetData(wb, "Duplicates in File 1", data.duplicatesInFile1, 75, 85, onProgress)
      } catch (error) {
        console.error("Error processing duplicates in File 1:", error)
        onProgress?.("Error processing duplicates in File 1", 100)
        return {
          success: false,
          error: "Failed to process duplicates in File 1",
          errorDetails: error instanceof Error ? error.message : String(error),
        }
      }
    } else {
      onProgress?.("No duplicates in File 1 to export", 85)
    }

    if (data.duplicatesInFile2 && Array.isArray(data.duplicatesInFile2) && data.duplicatesInFile2.length > 0) {
      try {
        await processSheetData(wb, "Duplicates in File 2", data.duplicatesInFile2, 85, 95, onProgress)
      } catch (error) {
        console.error("Error processing duplicates in File 2:", error)
        onProgress?.("Error processing duplicates in File 2", 100)
        return {
          success: false,
          error: "Failed to process duplicates in File 2",
          errorDetails: error instanceof Error ? error.message : String(error),
        }
      }
    } else {
      onProgress?.("No duplicates in File 2 to export", 95)
    }

    // Process duplicate groups if they exist
    if (
      data.duplicateGroupsInFile1 &&
      Array.isArray(data.duplicateGroupsInFile1) &&
      data.duplicateGroupsInFile1.length > 0
    ) {
      try {
        // Flatten the duplicate groups for export
        const flattenedGroups = data.duplicateGroupsInFile1.flat().filter(Boolean)
        if (flattenedGroups.length > 0) {
          await processSheetData(wb, "Duplicate Groups File 1", flattenedGroups, 90, 92.5, onProgress)
        }
      } catch (error) {
        console.error("Error processing duplicate groups in File 1:", error)
        // Continue with export even if this fails
      }
    }

    if (
      data.duplicateGroupsInFile2 &&
      Array.isArray(data.duplicateGroupsInFile2) &&
      data.duplicateGroupsInFile2.length > 0
    ) {
      try {
        // Flatten the duplicate groups for export
        const flattenedGroups = data.duplicateGroupsInFile2.flat().filter(Boolean)
        if (flattenedGroups.length > 0) {
          await processSheetData(wb, "Duplicate Groups File 2", flattenedGroups, 92.5, 95, onProgress)
        }
      } catch (error) {
        console.error("Error processing duplicate groups in File 2:", error)
        // Continue with export even if this fails
      }
    }

    onProgress?.("Generating Excel file", 95)

    try {
      // Add this before the safelyWriteWorkbook call in exportToExcel
      await attemptMemoryCleanup()
      // Write the workbook to a buffer using a more memory-efficient approach
      const wbout = await safelyWriteWorkbook(wb, onProgress)

      // Check if the output is too large for a blob
      if (wbout.byteLength > MAX_BLOB_SIZE) {
        throw new Error(
          `The generated Excel file is too large (${Math.round(wbout.byteLength / (1024 * 1024))}MB) for browser download. Try exporting smaller subsets of data.`,
        )
      }

      // Create the blob in one go
      const blob = new Blob([wbout], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })

      // Create a URL for the blob
      const url = URL.createObjectURL(blob)
      const formattedFileName = `${fileName}_${formatDate(new Date())}.xlsx`

      // Report completion
      onProgress?.("Export complete", 100)

      return {
        success: true,
        url,
        fileName: formattedFileName,
      }
    } catch (error) {
      console.error("Error generating Excel file:", error)
      onProgress?.("Error generating Excel file", 100)
      return {
        success: false,
        error: "Failed to generate Excel file",
        errorDetails: error instanceof Error ? error.message : String(error),
      }
    }
  } catch (error) {
    console.error("Export error:", error)
    onProgress?.("Export failed", 100)
    return {
      success: false,
      error: "Export failed",
      errorDetails: error instanceof Error ? error.message : String(error),
    }
  }
}

// Safely write workbook to avoid memory issues
async function safelyWriteWorkbook(workbook: XLSX.WorkBook, onProgress?: ExportProgressCallback): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    try {
      onProgress?.("Generating Excel file...", 95)

      // Use a timeout to prevent UI freezing
      setTimeout(() => {
        try {
          // Use a try-catch block specifically around the XLSX.write operation
          let buffer: Uint8Array
          try {
            buffer = XLSX.write(workbook, {
              type: "array",
              bookType: "xlsx",
              compression: true, // Enable compression to reduce file size
            })
          } catch (writeError) {
            // Handle specific XLSX write errors
            if (writeError instanceof Error) {
              if (writeError.message.includes("Maximum call stack size exceeded")) {
                throw new Error(
                  "The Excel file is too complex to generate. Try reducing the amount of data or splitting it into multiple exports.",
                )
              } else if (writeError.message.includes("out of memory")) {
                throw new Error(
                  "Browser ran out of memory while generating the Excel file. Try exporting smaller subsets of data.",
                )
              }
            }
            throw writeError
          }

          resolve(buffer)
        } catch (error) {
          reject(error)
        }
      }, 0)
    } catch (error) {
      reject(error)
    }
  })
}

// Helper function to process sheet data in chunks
async function processSheetData(
  workbook: XLSX.WorkBook,
  sheetName: string,
  data: any[],
  startProgress: number,
  endProgress: number,
  onProgress?: ExportProgressCallback,
): Promise<void> {
  // Validate input
  if (!Array.isArray(data)) {
    throw new Error(`Invalid data for sheet "${sheetName}": expected array, got ${typeof data}`)
  }

  // If data is empty, create an empty sheet
  if (data.length === 0) {
    const ws = XLSX.utils.aoa_to_sheet([["No data available"]])
    XLSX.utils.book_append_sheet(workbook, ws, sheetName)
    return
  }

  // Filter out null or undefined items
  const validData = data.filter((item) => item !== null && item !== undefined)

  if (validData.length === 0) {
    const ws = XLSX.utils.aoa_to_sheet([["No valid data available"]])
    XLSX.utils.book_append_sheet(workbook, ws, sheetName)
    return
  }

  // If data has _matchedWith, we need special processing
  const hasMatchedWith = validData.length > 0 && validData[0] !== null && "_matchedWith" in validData[0]

  // Determine optimal chunk size based on data complexity
  const estimatedRowSize = JSON.stringify(validData[0]).length
  const chunkSize = Math.max(1, Math.min(MAX_CHUNK_SIZE, Math.floor(5000000 / estimatedRowSize)))

  const totalChunks = Math.ceil(validData.length / chunkSize)

  // For very large datasets, limit the number of rows to prevent browser crashes
  const MAX_SAFE_ROWS = 50000
  if (validData.length > MAX_SAFE_ROWS) {
    onProgress?.(
      `Warning: Limiting ${sheetName} to ${MAX_SAFE_ROWS.toLocaleString()} rows to prevent browser crashes`,
      (startProgress + endProgress) / 2,
    )

    // Wait a moment to show the warning
    await new Promise((resolve) => setTimeout(resolve, 500))

    // Truncate the data
    const truncatedData = validData.slice(0, MAX_SAFE_ROWS)

    // Add a note about truncation
    try {
      const ws = XLSX.utils.aoa_to_sheet([
        [
          `Note: This sheet has been limited to ${MAX_SAFE_ROWS.toLocaleString()} rows out of ${validData.length.toLocaleString()} total rows to prevent browser crashes.`,
        ],
        [`To export the full dataset, try exporting specific categories separately or use a desktop application.`],
        [""],
      ])

      // Add the actual data
      if (hasMatchedWith) {
        const processedData = truncatedData.map((item) => processMatchedItem(item)).filter(Boolean)
        XLSX.utils.sheet_add_json(ws, processedData, { origin: 3 })
      } else {
        XLSX.utils.sheet_add_json(ws, truncatedData, { origin: 3 })
      }

      XLSX.utils.book_append_sheet(workbook, ws, sheetName)
      onProgress?.(`Processed ${MAX_SAFE_ROWS.toLocaleString()} rows for ${sheetName}`, endProgress)
      return
    } catch (error) {
      throw new Error(
        `Error processing truncated data for sheet "${sheetName}": ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  if (totalChunks <= 1 && validData.length <= MAX_CHUNK_SIZE) {
    // For smaller datasets, process all at once
    onProgress?.(`Processing ${sheetName} data...`, (startProgress + endProgress) / 2)

    let processedData: any[] = []

    try {
      // If we have matched data, process it specially
      if (hasMatchedWith) {
        processedData = validData.map((item) => processMatchedItem(item)).filter(Boolean)
      } else {
        processedData = [...validData]
      }
    } catch (error) {
      throw new Error(
        `Error processing data for sheet "${sheetName}": ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    // Add the sheet to the workbook
    try {
      if (processedData.length === 0) {
        const ws = XLSX.utils.aoa_to_sheet([["No valid data available after processing"]])
        XLSX.utils.book_append_sheet(workbook, ws, sheetName)
      } else {
        const ws = XLSX.utils.json_to_sheet(processedData)
        XLSX.utils.book_append_sheet(workbook, ws, sheetName)
      }
    } catch (error) {
      throw new Error(`Error creating sheet "${sheetName}": ${error instanceof Error ? error.message : String(error)}`)
    }
  } else {
    // For larger datasets, process in chunks
    onProgress?.(`Processing ${sheetName} data in chunks...`, startProgress)

    // First, create headers from the first item
    let headers: string[] = []
    try {
      const sampleItem = hasMatchedWith ? processMatchedItem(validData[0]) : validData[0]
      if (sampleItem) {
        headers = Object.keys(sampleItem)
      } else {
        throw new Error(`Cannot extract headers from first item in "${sheetName}" - item is null or invalid`)
      }
    } catch (error) {
      throw new Error(
        `Error extracting headers for sheet "${sheetName}": ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    // Create worksheet with headers
    let ws: XLSX.WorkSheet
    try {
      if (headers.length === 0) {
        ws = XLSX.utils.aoa_to_sheet([["No valid headers found"]])
      } else {
        ws = XLSX.utils.json_to_sheet([{}], { header: headers })
      }
      XLSX.utils.book_append_sheet(workbook, ws, sheetName)
    } catch (error) {
      throw new Error(
        `Error creating sheet "${sheetName}" with headers: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    // Process data in chunks
    let rowIndex = 1 // Start after header row
    let errorCount = 0
    const MAX_ERRORS = 10

    for (let i = 0; i < validData.length; i += chunkSize) {
      const startTime = Date.now()
      const end = Math.min(i + chunkSize, validData.length)
      const chunk = validData.slice(i, end)

      // Process this chunk
      try {
        for (let j = 0; j < chunk.length; j++) {
          const item = chunk[j]
          if (item === null || item === undefined) continue

          let processedItem: any
          try {
            processedItem = hasMatchedWith ? processMatchedItem(item) : item
          } catch (error) {
            console.error(`Error processing item at index ${i + j}:`, error)
            errorCount++
            if (errorCount > MAX_ERRORS) {
              throw new Error(
                `Too many errors (${errorCount}) while processing data. The last error was: ${error instanceof Error ? error.message : String(error)}`,
              )
            }
            continue // Skip this item and continue with the next
          }

          if (!processedItem) continue

          // Add row to worksheet
          try {
            XLSX.utils.sheet_add_json(ws, [processedItem], {
              skipHeader: true,
              origin: rowIndex,
            })
            rowIndex++
          } catch (error) {
            console.error(`Error adding row ${rowIndex} to sheet:`, error)
            errorCount++
            if (errorCount > MAX_ERRORS) {
              throw new Error(
                `Too many errors (${errorCount}) while adding rows. The last error was: ${error instanceof Error ? error.message : String(error)}`,
              )
            }
            // Continue with next item
          }

          // Yield to UI thread if processing takes too long
          if (j % 100 === 0 && Date.now() - startTime > MAX_PROCESSING_TIME) {
            await sleep(0)
          }
        }
      } catch (error) {
        throw new Error(
          `Error processing chunk ${i}-${end} for sheet "${sheetName}": ${error instanceof Error ? error.message : String(error)}`,
        )
      }

      // Report progress
      const progressPercent = startProgress + ((i + chunk.length) / validData.length) * (endProgress - startProgress)
      onProgress?.(`Processing ${sheetName} (${Math.round((end / validData.length) * 100)}%)`, progressPercent)

      // Allow UI to update between chunks
      await sleep(0)
    }
  }
}

// Helper function to process matched items
function processMatchedItem(item: any): any {
  // Handle null/undefined
  if (!item) return null

  // If it doesn't have _matchedWith, return as is
  if (!item._matchedWith) {
    return item
  }

  try {
    // Create a new object without the _matchedWith property
    const { _matchedWith, ...mainItem } = item

    // If _matchedWith exists, add its properties with a prefix
    if (_matchedWith && typeof _matchedWith === "object") {
      Object.entries(_matchedWith).forEach(([key, value]) => {
        // Skip adding duplicate keys that would overwrite existing ones
        if (!(key in mainItem)) {
          mainItem[`File2_${key}`] = value
        }
      })
    }

    return mainItem
  } catch (error) {
    console.error("Error processing matched item:", error, item)
    // Return a safe fallback
    const safeItem = { ...item }
    delete safeItem._matchedWith
    safeItem.error = "Failed to process matched item"
    return safeItem
  }
}

// Create the summary sheet data
function createSummarySheet(data: any) {
  // Validate data structure
  if (!data) {
    return [["No data available for summary"]]
  }

  return [
    ["Reconciliation Summary"],
    [""],
    ["Generated on", formatDate(new Date())],
    [""],
    ["File 1 Sheet", data.file1SheetName || "Unknown"],
    ["File 2 Sheet", data.file2SheetName || "Unknown"],
    [""],
    ["Total transactions in File 1", data.summary?.totalInFile1 || 0],
    ["Total transactions in File 2", data.summary?.totalInFile2 || 0],
    ["Matched transactions", data.summary?.matched || 0],
    ["Transactions in File 1 only", data.summary?.inFile1Only || 0],
    ["Transactions in File 2 only", data.summary?.inFile2Only || 0],
    ["Duplicates in File 1", data.summary?.duplicatesInFile1 || 0],
    ["Duplicates in File 2", data.summary?.duplicatesInFile2 || 0],
    [""],
    ["Column Mappings"],
    ["File 1 Column", "File 2 Column", "Exact Match"],
    // Add column mappings
    ...(Array.isArray(data.columnMappings)
      ? data.columnMappings.map((mapping: ColumnMapping) => [
          mapping.file1Column || "",
          mapping.file2Column || "",
          mapping.isExactMatch ? "Yes" : "No",
        ])
      : [["No column mappings available"]]),
  ]
}

function formatDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  const hours = String(date.getHours()).padStart(2, "0")
  const minutes = String(date.getMinutes()).padStart(2, "0")
  return `${year}-${month}-${day}_${hours}-${minutes}`
}

// Helper sleep function
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Estimate the size of the data to be exported
function estimateDataSize(data: any): number {
  let totalSize = 0

  // Helper function to estimate object size
  function estimateObjectSize(obj: any): number {
    if (!obj) return 0

    // Use JSON.stringify as a rough estimate
    try {
      return JSON.stringify(obj).length
    } catch (e) {
      // If stringify fails, make a conservative estimate
      return 1000
    }
  }

  // Estimate size of each data section
  if (data.matched && Array.isArray(data.matched)) {
    totalSize += data.matched.reduce((size, item) => size + estimateObjectSize(item), 0)
  }

  if (data.inFile1Only && Array.isArray(data.inFile1Only)) {
    totalSize += data.inFile1Only.reduce((size, item) => size + estimateObjectSize(item), 0)
  }

  if (data.inFile2Only && Array.isArray(data.inFile2Only)) {
    totalSize += data.inFile2Only.reduce((size, item) => size + estimateObjectSize(item), 0)
  }

  if (data.duplicatesInFile1 && Array.isArray(data.duplicatesInFile1)) {
    totalSize += data.duplicatesInFile1.reduce((size, item) => size + estimateObjectSize(item), 0)
  }

  if (data.duplicatesInFile2 && Array.isArray(data.duplicatesInFile2)) {
    totalSize += data.duplicatesInFile2.reduce((size, item) => size + estimateObjectSize(item), 0)
  }

  // Add overhead for Excel format (roughly 1.5x)
  return totalSize * 1.5
}

/**
 * Attempts to free up memory by triggering garbage collection
 * Note: This is a best-effort function and may not actually free memory
 * since JavaScript doesn't provide direct access to garbage collection
 */
async function attemptMemoryCleanup(): Promise<void> {
  // Create and discard large objects to encourage garbage collection
  try {
    // Store current objects that might be referenced
    const oldObjects: any[] = []

    // Create some pressure on the garbage collector
    for (let i = 0; i < 10; i++) {
      oldObjects.push(new Array(1000000).fill(0))
    }

    // Clear the references
    oldObjects.length = 0

    // Wait a bit to allow GC to potentially run
    await new Promise((resolve) => setTimeout(resolve, 100))
  } catch (e) {
    // Ignore any errors, this is just a best-effort function
  }
}
