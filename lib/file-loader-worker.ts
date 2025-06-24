// Web Worker for handling Excel file processing
import * as XLSX from "xlsx"

// Define message types
type WorkerMessage = {
  type: "loadSheets" | "loadColumns" | "loadData"
  fileBuffer: ArrayBuffer
  fileName: string
  sheetName?: string
}

type SheetResponse = {
  type: "sheets"
  sheets: string[]
  status: "success" | "error"
  error?: string
}

type ColumnResponse = {
  type: "columns"
  columns: string[]
  status: "success" | "error"
  error?: string
}

type DataChunkResponse = {
  type: "dataChunk"
  data: any[]
}

type DataEndResponse = {
  type: "dataEnd"
}

type ErrorResponse = {
  type: "error"
  error: string
  originalType?: "loadSheets" | "loadColumns" | "loadData"
}

type ProgressUpdate = {
  type: "progress"
  stage: string
  percent: number
}

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  try {
    const { type, fileBuffer, fileName, sheetName } = e.data

    // Send initial progress update
    sendProgress("Reading file...", 10)

    // Read the workbook from the ArrayBuffer
    const workbook = XLSX.read(new Uint8Array(fileBuffer), { type: "array" })

    switch (type) {
      case "loadSheets":
        sendProgress("Extracting sheets...", 50)

        if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
          throw new Error("No sheets found in the workbook")
        }

        sendProgress("Processing complete", 100)
        self.postMessage({
          type: "sheets",
          sheets: workbook.SheetNames,
          status: "success",
        } as SheetResponse)
        break

      case "loadColumns":
        if (!sheetName) {
          throw new Error("Sheet name not provided")
        }

        sendProgress("Reading sheet structure...", 30)

        if (!workbook.SheetNames.includes(sheetName)) {
          throw new Error(`Sheet "${sheetName}" not found in workbook`)
        }

        const worksheet = workbook.Sheets[sheetName]
        if (!worksheet) {
          throw new Error(`Sheet "${sheetName}" is empty or invalid`)
        }

        sendProgress("Extracting column headers...", 60)

        // Get the range of the sheet
        const range = XLSX.utils.decode_range(worksheet["!ref"] || "A1")

        // Get the headers
        const headers: string[] = []

        // If the sheet is empty or has only one row with no data
        if (range.e.r < 0) {
          throw new Error(`Sheet "${sheetName}" is empty`)
        }

        // Loop through the first row to get headers
        for (let C = range.s.c; C <= range.e.c; ++C) {
          const cell = worksheet[XLSX.utils.encode_cell({ r: range.s.r, c: C })]
          headers.push(cell ? String(cell.v) : `Column_${C + 1}`)
        }

        sendProgress("Processing complete", 100)

        // Create default headers if none found
        if (headers.length === 0) {
          // Determine number of columns by checking a few rows
          let maxCols = 0
          for (let R = range.s.r; R <= Math.min(range.s.r + 5, range.e.r); ++R) {
            let colCount = 0
            for (let C = range.s.c; C <= range.e.c; ++C) {
              const cell = worksheet[XLSX.utils.encode_cell({ r: R, c: C })]
              if (cell) colCount = C + 1
            }
            maxCols = Math.max(maxCols, colCount)
          }

          // Create default column names
          for (let i = 0; i < maxCols; i++) {
            headers.push(`Column_${i + 1}`)
          }

          if (headers.length === 0) {
            throw new Error(`No data found in sheet "${sheetName}"`)
          }
        }

        self.postMessage({
          type: "columns",
          columns: headers,
          status: "success",
        } as ColumnResponse)
        break

      case "loadData":
        if (!sheetName) {
          throw new Error("Sheet name not provided")
        }

        sendProgress("Reading sheet data...", 30)

        if (!workbook.SheetNames.includes(sheetName)) {
          throw new Error(`Sheet "${sheetName}" not found in workbook`)
        }

        const ws = workbook.Sheets[sheetName]
        if (!ws) {
          throw new Error(`Sheet "${sheetName}" is empty or invalid`)
        }

        sendProgress("Converting sheet to array of arrays...", 50)

        // Convert to array of arrays (rows)
        const rowsAsArrays: any[][] = XLSX.utils.sheet_to_json(ws, {
          header: 1, // Important: creates array of arrays
          raw: false, // Convert all data types
          dateNF: "yyyy-mm-dd", // Date format for dates
          defval: null, // Default value for blank cells
          blankrows: false, // Skip blank rows
        })

        if (!rowsAsArrays || rowsAsArrays.length === 0) {
          throw new Error(`No data found in sheet "${sheetName}"`)
        }

        // Extract headers (first row)
        const headers = rowsAsArrays[0]
        const dataRows = rowsAsArrays.slice(1)
        const totalRows = dataRows.length

        if (totalRows === 0) {
          throw new Error(`No data rows found in sheet "${sheetName}" (only headers?)`)
        }

        sendProgress(`Processing ${totalRows} rows...`, 60)

        const chunkSize = 500 // Configurable chunk size for sending data
        let processedRows = 0

        for (let i = 0; i < totalRows; i += chunkSize) {
          const chunkEnd = Math.min(i + chunkSize, totalRows)
          const chunkRawRows = dataRows.slice(i, chunkEnd)
          const chunkObjects = chunkRawRows.map((rowArray) => {
            const rowObject: { [key: string]: any } = {}
            headers.forEach((header, index) => {
              if (header !== null && header !== undefined) { // Ensure header is valid
                rowObject[String(header)] = rowArray[index]
              }
            })
            return rowObject
          })

          processedRows += chunkObjects.length

          // Send data chunk
          self.postMessage({
            type: "dataChunk",
            data: chunkObjects,
          } as DataChunkResponse)

          const percentComplete = Math.min(60 + (processedRows / totalRows) * 35, 95) // 60% to 95% for this part
          sendProgress(
            `Processed ${processedRows} of ${totalRows} rows...`,
            percentComplete,
          )

          // Allow event loop to process other messages if needed, especially for very large chunks
          // Though for 500 rows, this might be optional.
          await new Promise((resolve) => setTimeout(resolve, 0))
        }

        sendProgress("All data processed and sent", 100)
        self.postMessage({ type: "dataEnd" } as DataEndResponse)
        break
    }
  } catch (error) {
    console.error("Worker error:", error)
    const errorMessage = error instanceof Error ? error.message : "Unknown error processing file"
    self.postMessage({
      type: "error",
      error: errorMessage,
      originalType: e.data.type, // Pass the original type to help context on main thread
    } as ErrorResponse)
  }
}

function sendProgress(stage: string, percent: number) {
  self.postMessage({
    type: "progress",
    stage,
    percent,
  } as ProgressUpdate)
}
