// Web Worker for handling Excel file processing
import * as XLSX from "xlsx"

// Define message types
type WorkerMessage = {
  type: "loadSheets" | "loadColumns" | "loadData"
  fileObject: File // Changed from fileBuffer to fileObject
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

// Wrap FileReader in a promise
function readFileAsArrayBuffer(file: File, onProgress: (percent: number) => void): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader() // FileReader is available in workers
    reader.onload = (event) => {
      resolve(event.target?.result as ArrayBuffer)
    }
    reader.onerror = (error) => {
      reject(error)
    }
    reader.onprogress = (event) => {
      if (event.lengthComputable) {
        const percentComplete = Math.round((event.loaded / event.total) * 100)
        onProgress(percentComplete)
      }
    }
    reader.readAsArrayBuffer(file)
  })
}

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  try {
    const { type, fileObject, fileName, sheetName } = e.data // Use fileObject

    sendProgress("Preparing file...", 5) // Initial stage

    let fileBuffer: ArrayBuffer
    try {
      // Read the File into an ArrayBuffer within the worker
      // Update progress specifically for file reading phase (e.g. 5% to 15% of overall)
      fileBuffer = await readFileAsArrayBuffer(fileObject, (percent) => {
         sendProgress(`Reading file content... ${percent}%`, 5 + Math.round(percent * 0.1)) // Scale to 5-15% range
      })
      sendProgress("File content loaded, parsing workbook...", 15)
    } catch (readError) {
      throw new Error(`Failed to read file into ArrayBuffer: ${readError instanceof Error ? readError.message : String(readError)}`)
    }

    // Read the workbook from the ArrayBuffer
    // Optimize XLSX.read based on the operation type
    let workbook: XLSX.WorkBook;
    const readOpts: XLSX.ParsingOptions = { type: "array", cellStyles: false };

    if (type === "loadSheets") {
      readOpts.bookSheets = true; // Only parse sheet names and basic structures
      readOpts.sheetStubs = false; // Create stubs, don't parse cell data for sheets listing
    } else if (sheetName) {
      // For loadColumns and loadData, if a sheetName is provided, try to parse only that sheet.
      // Note: The 'sheets' option in XLSX.read might still parse shared structures
      // but can be more efficient for targeted sheet operations.
      readOpts.sheets = sheetName;
    }

    // Add progress messages before and during XLSX.read
    sendProgress("Parsing workbook (may take a while for large files)...", 15);

    let parsingTimeout = setTimeout(() => {
    sendProgress("Still parsing workbook, please wait...", 18);
    }, 2000);

    let parsingTimeout2 = setTimeout(() => {
    sendProgress("Parsing is taking longer than expected...", 19);
    }, 5000);

    // Perform the (blocking) parse
    workbook = XLSX.read(new Uint8Array(fileBuffer), readOpts);

    clearTimeout(parsingTimeout);
    clearTimeout(parsingTimeout2);

    sendProgress("Workbook parsed.", 20);

    switch (type) {
      case "loadSheets":
        // This task now happens after initial 20% (file read + workbook parse)
        sendProgress("Extracting sheets...", 20 + 30); // Stage progress: 20% base + 30% for this = 50%

        if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
          throw new Error("No sheets found in the workbook");
        }

        sendProgress("Processing complete", 100); // Overall 100%
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
        // Progress: 20% base. This operation takes ~40% (20-60) for structure, then ~30% (60-90) for extraction.
        sendProgress("Reading sheet structure...", 20 + 10) // 30%

        if (!workbook.SheetNames.includes(sheetName)) {
          throw new Error(`Sheet "${sheetName}" not found in workbook`)
        }

        const worksheet = workbook.Sheets[sheetName]
        if (!worksheet) {
          throw new Error(`Sheet "${sheetName}" is empty or invalid`)
        }

        sendProgress("Extracting column headers...", 20 + 40) // 60%

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
        sendProgress("Column processing complete.", 100) // Overall 100% for this task
        self.postMessage({
          type: "columns",
          columns: headers,
          status: "success",
        } as ColumnResponse)
        break

      case "loadData":
        // This task now happens after initial 20% (file read + workbook parse)
        if (!sheetName) {
          throw new Error("Sheet name not provided")
        }

        sendProgress("Reading sheet data...", 20 + 5) // 25%

        if (!workbook.SheetNames.includes(sheetName)) {
          throw new Error(`Sheet "${sheetName}" not found in workbook`)
        }

        const ws = workbook.Sheets[sheetName]
        if (!ws) {
          throw new Error(`Sheet "${sheetName}" is empty or invalid`)
        }

        sendProgress("Converting sheet to array of arrays...", 20 + 15) // 35%

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

        // Base progress is 35%. Row processing will take up to 95%. So 60% of the total progress is for this loop.
        sendProgress(`Processing ${totalRows} rows...`, 35)

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

          // Calculate percent complete for this stage (max 60% of total progress for this loop)
          // Current progress = base (35%) + portion of this stage's allocated 60%
          const stagePercent = totalRows > 0 ? (processedRows / totalRows) : 1;
          const overallPercentComplete = Math.min(35 + Math.round(stagePercent * 60), 95);
          sendProgress(
            `Processed ${processedRows} of ${totalRows} rows...`,
            overallPercentComplete,
          )

          // Allow event loop to process other messages
          await new Promise((resolve) => setTimeout(resolve, 0))
        }

        sendProgress("All data processed and sent", 100) // Overall 100%
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
