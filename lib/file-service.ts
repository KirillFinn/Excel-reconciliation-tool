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

// Clean up resources when done
export function terminateFileWorker() {
  // No worker to terminate in this implementation
  // This is just a placeholder to maintain API compatibility
}
