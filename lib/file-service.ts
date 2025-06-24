// File service to handle Excel file operations
import * as XLSX from "xlsx"

export type ProgressCallback = (stage: string, percent: number) => void

// Get sheets from an Excel file
export async function getWorkbookSheets(file: File, onProgress?: ProgressCallback): Promise<string[]> {
  return new Promise((resolve, reject) => {
    onProgress?.("Reading file...", 10)
    const reader = new FileReader()

    reader.onload = (e) => {
      try {
        onProgress?.("Processing workbook...", 40)
        const data = e.target?.result
        if (!data) {
          throw new Error("Failed to read file data")
        }

        const workbook = XLSX.read(data, { type: "binary" })
        if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
          throw new Error("No sheets found in the workbook")
        }

        onProgress?.("Extracting sheets...", 80)
        resolve(workbook.SheetNames)
      } catch (error) {
        reject(error)
      } finally {
        onProgress?.("Complete", 100)
      }
    }

    reader.onerror = (error) => {
      reject(error || new Error("Failed to read file"))
    }

    reader.readAsBinaryString(file)
  })
}

// Get columns from a specific sheet
export async function getSheetColumns(file: File, sheetName: string, onProgress?: ProgressCallback): Promise<string[]> {
  return new Promise((resolve, reject) => {
    onProgress?.("Reading file...", 10)
    const reader = new FileReader()

    reader.onload = (e) => {
      try {
        onProgress?.("Processing workbook...", 30)
        const data = e.target?.result
        if (!data) {
          throw new Error("Failed to read file data")
        }

        const workbook = XLSX.read(data, { type: "binary" })
        if (!workbook || !workbook.SheetNames) {
          throw new Error("Invalid workbook format")
        }

        onProgress?.("Locating sheet...", 50)
        if (!workbook.SheetNames.includes(sheetName)) {
          throw new Error(`Sheet "${sheetName}" not found in workbook`)
        }

        const worksheet = workbook.Sheets[sheetName]
        if (!worksheet) {
          throw new Error(`Sheet "${sheetName}" is empty or invalid`)
        }

        onProgress?.("Extracting columns...", 70)
        // Get the range of the sheet
        const range = XLSX.utils.decode_range(worksheet["!ref"] || "A1")

        // If the sheet is empty or has only one row with no data
        if (range.e.r < 0) {
          throw new Error(`Sheet "${sheetName}" is empty`)
        }

        // Get the headers (first row)
        const headers: string[] = []

        // Loop through the first row to get headers
        for (let C = range.s.c; C <= range.e.c; ++C) {
          const cell = worksheet[XLSX.utils.encode_cell({ r: range.s.r, c: C })]
          headers.push(cell ? String(cell.v) : `Column_${C + 1}`)
        }

        if (headers.length === 0) {
          // If no headers found, create default column names
          const defaultHeaders = []
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
            defaultHeaders.push(`Column_${i + 1}`)
          }

          if (defaultHeaders.length === 0) {
            throw new Error(`No data found in sheet "${sheetName}"`)
          }

          onProgress?.("Complete", 100)
          resolve(defaultHeaders)
        } else {
          onProgress?.("Complete", 100)
          resolve(headers)
        }
      } catch (error) {
        reject(error)
      }
    }

    reader.onerror = (error) => {
      reject(error || new Error("Failed to read file"))
    }

    reader.readAsBinaryString(file)
  })
}

// Get data from a specific sheet
export async function getSheetData(file: File, sheetName: string, onProgress?: ProgressCallback): Promise<any[]> {
  return new Promise((resolve, reject) => {
    onProgress?.("Reading file...", 10)
    const reader = new FileReader()

    reader.onload = async (e) => {
      try {
        onProgress?.("Processing workbook...", 30)
        const data = e.target?.result
        if (!data) {
          throw new Error("Failed to read file data")
        }

        const workbook = XLSX.read(data, { type: "binary" })
        if (!workbook || !workbook.SheetNames) {
          throw new Error("Invalid workbook format")
        }

        onProgress?.("Locating sheet...", 40)
        if (!workbook.SheetNames.includes(sheetName)) {
          throw new Error(`Sheet "${sheetName}" not found in workbook`)
        }

        const worksheet = workbook.Sheets[sheetName]
        if (!worksheet) {
          throw new Error(`Sheet "${sheetName}" is empty or invalid`)
        }

        onProgress?.("Converting data...", 60)
        // Convert to JSON with headers
        const jsonData = XLSX.utils.sheet_to_json(worksheet, {
          raw: false, // Convert all data types
          dateNF: "yyyy-mm-dd", // Date format
        })

        if (!jsonData || jsonData.length === 0) {
          throw new Error(`No data found in sheet "${sheetName}"`)
        }

        // Process data in chunks to avoid memory issues
        onProgress?.("Processing data...", 80)
        const totalRows = jsonData.length

        // For large datasets, yield to the main thread occasionally
        if (totalRows > 5000) {
          // Process in chunks
          for (let i = 0; i < totalRows; i += 5000) {
            await new Promise((resolve) => setTimeout(resolve, 0))
            onProgress?.(`Processing rows ${i + 1} to ${Math.min(i + 5000, totalRows)}...`, 80 + (i / totalRows) * 20)
          }
        }

        onProgress?.("Complete", 100)
        resolve(jsonData as any[])
      } catch (error) {
        reject(error)
      }
    }

    reader.onerror = (error) => {
      reject(error || new Error("Failed to read file"))
    }

    reader.readAsBinaryString(file)
  })
}

// Store worker instance globally within the module to reuse
let fileWorker: Worker | null = null
import workerUrl from "./file-loader-worker.ts?url" // Import the worker URL

function getWorker(): Worker {
  if (!fileWorker) {
    // Use the imported URL to instantiate the worker
    fileWorker = new Worker(workerUrl, {
      type: "module", // ESM worker
    })
  }
  return fileWorker
}

export async function* getSheetDataStreamed(
  file: File, // Pass the File object directly
  sheetName: string,
  onProgress?: ProgressCallback,
): AsyncGenerator<any[], void, void> {
  const worker = getWorker()

  // Send message to worker to start loading data, passing the File object
  worker.postMessage({
    type: "loadData",
    fileObject: file, // Changed from fileBuffer to fileObject
    fileName: file.name,
    sheetName,
  })

  // Return an async generator
  try {
    for await (const event of messageChannel(worker)) {
      const message = event.data
      switch (message.type) {
        case "dataChunk":
          yield message.data // Yield the chunk of row objects
          break
        case "progress":
          onProgress?.(message.stage, message.percent)
          break
        case "dataEnd":
          return // Signal end of stream
        case "error":
          if (message.originalType === "loadData" || !message.originalType) {
            console.error("Error from file-loader-worker (loadData):", message.error)
            throw new Error(`Worker error processing sheet data: ${message.error}`)
          }
          // For errors from other types (loadSheets, loadColumns), they might be handled by other listeners.
          // Or we might want to reject here too if the current operation is implicitly tied.
          // For now, only fail hard on loadData errors in this specific generator.
          break
        default:
          // Ignore other message types not relevant to this stream (e.g., sheets, columns responses for other calls)
          break
      }
    }
  } finally {
    // Optional: Decide on worker termination strategy.
    // If the worker is frequently reused, don't terminate it here.
    // If it's per-operation, then terminate.
    // For now, assuming it's reused, so no termination here.
    // terminateFileWorker(); // if we want to terminate after each stream.
  }
}

// Helper to convert worker messages to an async iterable
async function* messageChannel(worker: Worker) {
  const messageQueue: MessageEvent[] = []
  let resolveNextMessage: ((value: MessageEvent) => void) | null = null

  const messageHandler = (event: MessageEvent) => {
    if (resolveNextMessage) {
      resolveNextMessage(event)
      resolveNextMessage = null
    } else {
      messageQueue.push(event)
    }
  }

  const errorHandler = (event: ErrorEvent) => {
    // This will cause the awaiting promise in the loop to reject
    if (resolveNextMessage) {
      resolveNextMessage(new MessageEvent("error", { data: { type: "error", error: event.message } }) as any)
      resolveNextMessage = null
    } else {
      messageQueue.push(new MessageEvent("error", { data: { type: "error", error: event.message } }) as any)
    }
    console.error("Worker error event:", event)
  }

  worker.addEventListener("message", messageHandler)
  worker.addEventListener("error", errorHandler)

  try {
    while (true) {
      if (messageQueue.length > 0) {
        yield messageQueue.shift()!
      } else {
        yield await new Promise<MessageEvent>((resolve) => {
          resolveNextMessage = resolve
        })
      }
    }
  } finally {
    worker.removeEventListener("message", messageHandler)
    worker.removeEventListener("error", errorHandler)
  }
}

// Clean up resources when done
export function terminateFileWorker() {
  if (fileWorker) {
    fileWorker.terminate()
    fileWorker = null
    console.log("File worker terminated.")
  }
}

// Functions to get sheets and columns can also be refactored to use the worker
// For now, they remain as they are, but show a pattern if we want to change them.

// Example: Refactored getWorkbookSheets using the worker (Optional Enhancement)
export async function getWorkbookSheetsWithWorker(file: File, onProgress?: ProgressCallback): Promise<string[]> {
  return new Promise(async (resolve, reject) => {
    const worker = getWorker()
    // No ArrayBuffer conversion here, pass File object directly as per Step 1 changes
    // const fileBuffer = await file.arrayBuffer(); // This line would be removed or worker handles it

    const messageListener = (event: MessageEvent) => {
      const { type, sheets, status, error, stage, percent, originalType } = event.data;
      if (originalType !== "loadSheets" && type !== "progress" && type !== "error") return; // Filter messages for this call

      if (type === "sheets" && status === "success") {
        worker.removeEventListener("message", messageListener);
        resolve(sheets);
      } else if (type === "sheets" && status === "error") {
        worker.removeEventListener("message", messageListener);
        reject(new Error(error || "Failed to load sheets from worker"));
      } else if (type === "progress" && originalType === "loadSheets") {
        onProgress?.(stage, percent);
      } else if (type === "error" && originalType === "loadSheets") {
         worker.removeEventListener("message", messageListener);
        reject(new Error(error || "Generic error from worker while loading sheets"));
      }
    };
    worker.addEventListener("message", messageListener);
    // Pass File object directly
    worker.postMessage({ type: "loadSheets", fileObject: file, fileName: file.name });
  });
}

export async function getSheetColumnsWithWorker(
  file: File,
  sheetName: string,
  onProgress?: ProgressCallback,
): Promise<string[]> {
  return new Promise(async (resolve, reject) => {
    const worker = getWorker();

    const messageListener = (event: MessageEvent) => {
      const { type, columns, status, error, stage, percent, originalType } = event.data;
      // Filter messages specifically for this 'loadColumns' operation
      if (originalType !== "loadColumns" && type !== "progress" && type !== "error") return;


      if (type === "columns" && status === "success") {
        worker.removeEventListener("message", messageListener);
        resolve(columns);
      } else if (type === "columns" && status === "error") {
        worker.removeEventListener("message", messageListener);
        reject(new Error(error || "Failed to load columns from worker"));
      } else if (type === "progress" && originalType === "loadColumns") {
        onProgress?.(stage, percent);
      } else if (type === "error" && originalType === "loadColumns") {
         worker.removeEventListener("message", messageListener);
        reject(new Error(error || "Generic error from worker while loading columns"));
      }
    };

    worker.addEventListener("message", messageListener);
    // Pass File object and sheetName
    worker.postMessage({ type: "loadColumns", fileObject: file, sheetName, fileName: file.name });
  });
}
