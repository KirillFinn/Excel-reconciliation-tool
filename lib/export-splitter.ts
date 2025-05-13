import * as XLSX from "xlsx"
import type { ExportProgressCallback } from "./export-utils"

// Maximum rows per sheet
const MAX_ROWS_PER_SHEET = 100000

// Maximum sheets per workbook
const MAX_SHEETS_PER_WORKBOOK = 10

/**
 * Splits large datasets into multiple Excel files if needed
 * @param data The data to split
 * @param fileName Base file name
 * @param onProgress Progress callback
 * @returns Array of file blobs with their names
 */
export async function splitLargeExport(
  data: Record<string, any[]>,
  fileName: string,
  onProgress?: ExportProgressCallback,
): Promise<Array<{ blob: Blob; fileName: string }>> {
  // Check if we need to split the data
  const totalRows = Object.values(data).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0)

  // If data is small enough, don't split
  if (totalRows <= MAX_ROWS_PER_SHEET && Object.keys(data).length <= MAX_SHEETS_PER_WORKBOOK) {
    return []
  }

  onProgress?.("Preparing to split large dataset", 0)

  const results: Array<{ blob: Blob; fileName: string }> = []
  let currentFileIndex = 1
  let currentWorkbook = XLSX.utils.book_new()
  let currentSheetCount = 0
  let processedSheets = 0
  const totalSheets = Object.keys(data).length

  // Process each sheet
  for (const [sheetName, sheetData] of Object.entries(data)) {
    if (!Array.isArray(sheetData) || sheetData.length === 0) continue

    // If this sheet would exceed the max rows per sheet, split it
    if (sheetData.length > MAX_ROWS_PER_SHEET) {
      // Split this sheet into multiple sheets
      const chunks = Math.ceil(sheetData.length / MAX_ROWS_PER_SHEET)

      for (let i = 0; i < chunks; i++) {
        const start = i * MAX_ROWS_PER_SHEET
        const end = Math.min(start + MAX_ROWS_PER_SHEET, sheetData.length)
        const chunkData = sheetData.slice(start, end)
        const chunkName = `${sheetName} (${i + 1}/${chunks})`

        // If adding this sheet would exceed the max sheets per workbook, create a new workbook
        if (currentSheetCount >= MAX_SHEETS_PER_WORKBOOK) {
          // Finalize current workbook
          const wbBlob = new Blob([XLSX.write(currentWorkbook, { bookType: "xlsx", type: "array" })], {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          })

          results.push({
            blob: wbBlob,
            fileName: `${fileName}_part${currentFileIndex}.xlsx`,
          })

          // Start a new workbook
          currentWorkbook = XLSX.utils.book_new()
          currentSheetCount = 0
          currentFileIndex++
        }

        // Add sheet to current workbook
        const ws = XLSX.utils.json_to_sheet(chunkData)
        XLSX.utils.book_append_sheet(currentWorkbook, ws, chunkName)
        currentSheetCount++

        // Report progress
        processedSheets++
        onProgress?.(`Processing sheet ${processedSheets}/${totalSheets}`, (processedSheets / totalSheets) * 100)

        // Yield to UI thread
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    } else {
      // If adding this sheet would exceed the max sheets per workbook, create a new workbook
      if (currentSheetCount >= MAX_SHEETS_PER_WORKBOOK) {
        // Finalize current workbook
        const wbBlob = new Blob([XLSX.write(currentWorkbook, { bookType: "xlsx", type: "array" })], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        })

        results.push({
          blob: wbBlob,
          fileName: `${fileName}_part${currentFileIndex}.xlsx`,
        })

        // Start a new workbook
        currentWorkbook = XLSX.utils.book_new()
        currentSheetCount = 0
        currentFileIndex++
      }

      // Add sheet to current workbook
      const ws = XLSX.utils.json_to_sheet(sheetData)
      XLSX.utils.book_append_sheet(currentWorkbook, ws, sheetName)
      currentSheetCount++

      // Report progress
      processedSheets++
      onProgress?.(`Processing sheet ${processedSheets}/${totalSheets}`, (processedSheets / totalSheets) * 100)

      // Yield to UI thread
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }

  // Finalize last workbook if it has sheets
  if (currentSheetCount > 0) {
    const wbBlob = new Blob([XLSX.write(currentWorkbook, { bookType: "xlsx", type: "array" })], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })

    results.push({
      blob: wbBlob,
      fileName: `${fileName}_part${currentFileIndex}.xlsx`,
    })
  }

  onProgress?.("Split complete", 100)
  return results
}
