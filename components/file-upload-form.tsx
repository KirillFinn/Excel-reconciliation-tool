"use client"

import React from "react"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { FileUploader } from "./file-uploader"
import { ReconciliationResults } from "./reconciliation-results"
import { SheetSelector } from "./sheet-selector"
import { ColumnMapper, type ColumnMapping } from "./column-mapper"
import { processFiles } from "@/lib/reconciliation"
import { getWorkbookSheets, getSheetColumns, terminateFileWorker } from "@/lib/file-service"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Loader2 } from "lucide-react"
import { Steps } from "./steps"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AlertCircle } from "lucide-react"
import { ProgressIndicator } from "./progress-indicator"

export function FileUploadForm() {
  const [file1, setFile1] = useState<File | null>(null)
  const [file2, setFile2] = useState<File | null>(null)
  const [sheets1, setSheets1] = useState<string[]>([])
  const [sheets2, setSheets2] = useState<string[]>([])
  const [selectedSheet1, setSelectedSheet1] = useState<string>("")
  const [selectedSheet2, setSelectedSheet2] = useState<string>("")
  const [file1Columns, setFile1Columns] = useState<string[]>([])
  const [file2Columns, setFile2Columns] = useState<string[]>([])
  const [columnMappings, setColumnMappings] = useState<ColumnMapping[]>([])
  const [results, setResults] = useState<any>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isLoadingSheets, setIsLoadingSheets] = useState(false)
  const [isLoadingColumns, setIsLoadingColumns] = useState(false)
  const [activeTab, setActiveTab] = useState("upload")
  const [currentStep, setCurrentStep] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState({ stage: "", percent: 0 })
  const [showProgress, setShowProgress] = useState(false)

  // Clean up web worker on unmount
  React.useEffect(() => {
    return () => {
      terminateFileWorker()
    }
  }, [])

  const handleFileChange = async (fileNum: 1 | 2, file: File | null) => {
    setError(null)
    setShowProgress(false)

    if (fileNum === 1) {
      setFile1(file)
      setSheets1([])
      setSelectedSheet1("")
      setFile1Columns([])
    } else {
      setFile2(file)
      setSheets2([])
      setSelectedSheet2("")
      setFile2Columns([])
    }

    // Reset steps if files change
    if (currentStep > 1) {
      setCurrentStep(1)
    }

    if (results) {
      setResults(null)
    }

    if (file) {
      setIsLoadingSheets(true)
      setShowProgress(true)
      setProgress({ stage: `Loading sheets from ${fileNum === 1 ? "File 1" : "File 2"}...`, percent: 0 })

      try {
        const sheetNames = await getWorkbookSheets(file, (stage, percent) => {
          setProgress({ stage, percent })
        })

        if (fileNum === 1) {
          setSheets1(sheetNames)
          setSelectedSheet1(sheetNames[0] || "")
        } else {
          setSheets2(sheetNames)
          setSelectedSheet2(sheetNames[0] || "")
        }

        setShowProgress(false)
      } catch (error) {
        console.error(`Error loading sheets from file ${fileNum}:`, error)
        setError(`Error loading sheets from file ${fileNum}. Please check the file format.`)
        setShowProgress(false)
      } finally {
        setIsLoadingSheets(false)
      }
    }
  }

  const handleSheetChange = async (fileNum: 1 | 2, sheetName: string) => {
    setError(null)

    if (fileNum === 1) {
      setSelectedSheet1(sheetName)
      setFile1Columns([])
    } else {
      setSelectedSheet2(sheetName)
      setFile2Columns([])
    }

    // Reset column mappings when sheets change
    setColumnMappings([])

    if (results) {
      setResults(null)
    }
  }

  // Update the handleNextStep function to handle empty sheets better
  const handleNextStep = async () => {
    setError(null)

    if (currentStep === 1 && file1 && file2 && selectedSheet1 && selectedSheet2) {
      // Load columns if not already loaded
      setIsLoadingColumns(true)
      setShowProgress(true)
      try {
        let columns1: string[] = []
        let columns2: string[] = []

        try {
          setProgress({ stage: "Loading columns from File 1...", percent: 0 })
          columns1 = await getSheetColumns(file1, selectedSheet1, (stage, percent) => {
            setProgress({ stage: `File 1: ${stage}`, percent })
          })
        } catch (error: any) {
          throw new Error(`Error in File 1: ${error.message}`)
        }

        try {
          setProgress({ stage: "Loading columns from File 2...", percent: 0 })
          columns2 = await getSheetColumns(file2, selectedSheet2, (stage, percent) => {
            setProgress({ stage: `File 2: ${stage}`, percent })
          })
        } catch (error: any) {
          throw new Error(`Error in File 2: ${error.message}`)
        }

        if (columns1.length === 0 && columns2.length === 0) {
          throw new Error("Both sheets appear to be empty. Please select sheets with data.")
        }

        setFile1Columns(columns1)
        setFile2Columns(columns2)
        setCurrentStep(2)
        setShowProgress(false)
      } catch (error: any) {
        console.error("Error loading columns:", error)
        setError(error.message || "Error loading columns. Please check that your selected sheets contain data.")
        setShowProgress(false)
      } finally {
        setIsLoadingColumns(false)
      }
    }
  }

  const handleSaveMapping = (mappings: ColumnMapping[]) => {
    setColumnMappings(mappings)
    setCurrentStep(3)
  }

  const handleCompare = async () => {
    setError(null)

    if (!file1 || !file2 || !selectedSheet1 || !selectedSheet2 || columnMappings.length === 0) return

    setIsProcessing(true)
    setShowProgress(true)
    setProgress({ stage: "Starting reconciliation...", percent: 0 })

    try {
      const reconciliationResults = await processFiles(
        file1,
        file2,
        selectedSheet1,
        selectedSheet2,
        columnMappings,
        (stage, percent) => {
          setProgress({ stage, percent })
        },
      )

      setResults(reconciliationResults)
      setActiveTab("results")
      setShowProgress(false)
    } catch (error: any) {
      console.error("Error processing files:", error)
      setError(error.message || "Error processing files. Please check the file format and try again.")
      setShowProgress(false)
    } finally {
      setIsProcessing(false)
    }
  }

  const resetForm = () => {
    setFile1(null)
    setFile2(null)
    setSheets1([])
    setSheets2([])
    setSelectedSheet1("")
    setSelectedSheet2("")
    setFile1Columns([])
    setFile2Columns([])
    setColumnMappings([])
    setResults(null)
    setActiveTab("upload")
    setCurrentStep(1)
    setError(null)
    setShowProgress(false)
  }

  const canProceedToColumnMapping =
    file1 && file2 && selectedSheet1 && selectedSheet2 && !isLoadingSheets && !isLoadingColumns

  const canCompare = file1 && file2 && selectedSheet1 && selectedSheet2 && columnMappings.length > 0 && !isProcessing

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="max-w-4xl mx-auto">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="upload">Setup</TabsTrigger>
        <TabsTrigger value="results" disabled={!results}>
          Results
        </TabsTrigger>
      </TabsList>

      <TabsContent value="upload">
        <Steps currentStep={currentStep} className="mb-8 mt-4" />

        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {showProgress && (
          <div className="mb-6">
            <ProgressIndicator stage={progress.stage} percent={progress.percent} />
          </div>
        )}

        {currentStep === 1 && (
          <Card>
            <CardContent className="pt-6 space-y-6">
              <div className="space-y-2">
                <Label htmlFor="file1">Workbook 1</Label>
                <FileUploader
                  id="file1"
                  file={file1}
                  setFile={(file) => handleFileChange(1, file)}
                  accept=".xlsx,.xls"
                />
                {sheets1.length > 0 && (
                  <div className="mt-2">
                    <SheetSelector
                      label="Select Sheet from Workbook 1"
                      sheets={sheets1}
                      selectedSheet={selectedSheet1}
                      onSelectSheet={(sheet) => handleSheetChange(1, sheet)}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Make sure the selected sheet contains data with column headers in the first row.
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="file2">Workbook 2</Label>
                <FileUploader
                  id="file2"
                  file={file2}
                  setFile={(file) => handleFileChange(2, file)}
                  accept=".xlsx,.xls"
                />
                {sheets2.length > 0 && (
                  <div className="mt-2">
                    <SheetSelector
                      label="Select Sheet from Workbook 2"
                      sheets={sheets2}
                      selectedSheet={selectedSheet2}
                      onSelectSheet={(sheet) => handleSheetChange(2, sheet)}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Make sure the selected sheet contains data with column headers in the first row.
                    </p>
                  </div>
                )}
              </div>

              <div className="flex justify-center pt-4">
                <Button onClick={handleNextStep} disabled={!canProceedToColumnMapping} className="w-full sm:w-auto">
                  {isLoadingSheets || isLoadingColumns ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Loading...
                    </>
                  ) : (
                    "Next: Map Columns"
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {currentStep === 2 && (
          <ColumnMapper
            file1Columns={file1Columns}
            file2Columns={file2Columns}
            onSaveMapping={handleSaveMapping}
            onCancel={() => setCurrentStep(1)}
          />
        )}

        {currentStep === 3 && (
          <Card>
            <CardContent className="pt-6">
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-medium mb-2">Files and Sheets Selected</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 border rounded-md">
                      <p className="font-medium">Workbook 1</p>
                      <p className="text-sm text-muted-foreground">{file1?.name}</p>
                      <p className="text-sm mt-2">
                        Sheet: <span className="font-medium">{selectedSheet1}</span>
                      </p>
                    </div>
                    <div className="p-4 border rounded-md">
                      <p className="font-medium">Workbook 2</p>
                      <p className="text-sm text-muted-foreground">{file2?.name}</p>
                      <p className="text-sm mt-2">
                        Sheet: <span className="font-medium">{selectedSheet2}</span>
                      </p>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-medium mb-2">Column Mappings</h3>
                  <div className="border rounded-md p-4">
                    <div className="grid grid-cols-2 gap-2 font-medium mb-2 pb-2 border-b">
                      <div>File 1 Column</div>
                      <div>File 2 Column</div>
                    </div>
                    {columnMappings.map((mapping, index) => (
                      <div key={index} className="grid grid-cols-2 gap-2 py-1 text-sm">
                        <div>{formatColumnName(mapping.file1Column)}</div>
                        <div>{formatColumnName(mapping.file2Column)}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex justify-between pt-4">
                  <Button variant="outline" onClick={() => setCurrentStep(2)}>
                    Back to Column Mapping
                  </Button>
                  <Button onClick={handleCompare} disabled={!canCompare}>
                    {isProcessing ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      "Run Comparison"
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </TabsContent>

      <TabsContent value="results">
        {results && (
          <>
            <ReconciliationResults results={results} />
            <div className="flex justify-center mt-6">
              <Button onClick={resetForm} variant="outline" className="mr-2">
                Start New Comparison
              </Button>
            </div>
          </>
        )}
      </TabsContent>
    </Tabs>
  )
}

function formatColumnName(name: string): string {
  return name
    .replace(/_/g, " ")
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (str) => str.toUpperCase())
    .trim()
}
