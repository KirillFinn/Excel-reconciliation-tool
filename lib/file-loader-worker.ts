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

type DataResponse = {
  type: "data"
  data: any[]
  status: "success" | "error"
  error?: string
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

        sendProgress("Converting data...", 50)

        // Convert to JSON with headers
        const jsonData = XLSX.utils.sheet_to_json(ws, {
          raw: false, // Convert all data types
          dateNF: "yyyy-mm-dd", // Date format
        })

        sendProgress("Processing data...", 75)

        if (!jsonData || jsonData.length === 0) {
          throw new Error(`No data found in sheet "${sheetName}"`)
        }

        // Process data in chunks to avoid memory issues
        const chunkSize = 1000
        const totalRows = jsonData.length

        for (let i = 0; i < totalRows; i += chunkSize) {
          const chunk = jsonData.slice(i, i + chunkSize)
          const percentComplete = Math.min(75 + (i / totalRows) * 20, 95)

          sendProgress(
            `Processing row ${i + 1} to ${Math.min(i + chunkSize, totalRows)} of ${totalRows}...`,
            percentComplete,
          )

          // Allow UI to update between chunks
          await new Promise((resolve) => setTimeout(resolve, 0))
        }

        sendProgress("Processing complete", 100)

        self.postMessage({
          type: "data",
          data: jsonData,
          status: "success",
        } as DataResponse)
        break
    }
  } catch (error) {
    // Handle errors
    console.error("Worker error:", error)
    const errorMessage = error instanceof Error ? error.message : "Unknown error processing file"

    // Send error back to main thread
    self.postMessage({
      type: e.data.type === "loadSheets" ? "sheets" : e.data.type === "loadColumns" ? "columns" : "data",
      status: "error",
      error: errorMessage,
    })
  }
}

function sendProgress(stage: string, percent: number) {
  self.postMessage({
    type: "progress",
    stage,
    percent,
  } as ProgressUpdate)
}
