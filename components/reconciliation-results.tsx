"use client"

import { useState, useEffect, useRef } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Download, Search, AlertCircle, CheckCircle2, X, FileDown, FileText } from "lucide-react"
import { exportToExcel, exportCategoryToExcel, type ExportCategory } from "@/lib/export-utils"
import type { ColumnMapping } from "./column-mapper"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { ProgressIndicator } from "./progress-indicator"
import { DuplicateGroupDisplay } from "./duplicate-group-display"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

// Update the ReconciliationResultsProps interface
interface ReconciliationResultsProps {
  results: {
    matched: any[]
    inFile1Only: any[]
    inFile2Only: any[]
    duplicatesInFile1: any[]
    duplicatesInFile2: any[]
    duplicateGroupsInFile1?: any[][]
    duplicateGroupsInFile2?: any[][]
    columnMappings: ColumnMapping[]
    file1SheetName: string
    file2SheetName: string
    summary: {
      totalInFile1: number
      totalInFile2: number
      matched: number
      inFile1Only: number
      inFile2Only: number
      duplicatesInFile1: number
      duplicatesInFile2: number
    }
  }
}

const PAGE_SIZE = 50 // Number of records per page

export function ReconciliationResults({ results }: ReconciliationResultsProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const [currentTab, setCurrentTab] = useState("summary")
  const [isExporting, setIsExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState({ stage: "", percent: 0 })
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportErrorDetails, setExportErrorDetails] = useState<string | null>(null)
  const [showExportDialog, setShowExportDialog] = useState(false)
  const [exportResult, setExportResult] = useState<{ url?: string; fileName?: string } | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [paginatedData, setPaginatedData] = useState<any[]>([])
  const [totalPages, setTotalPages] = useState(1)
  const [initialRender, setInitialRender] = useState(true)
  const [exportTimeout, setExportTimeout] = useState<NodeJS.Timeout | null>(null)
  const [currentExportCategory, setCurrentExportCategory] = useState<ExportCategory | null>(null)

  // Use a ref to track if component is mounted to prevent state updates after unmount
  const isMounted = useRef(true)

  useEffect(() => {
    return () => {
      isMounted.current = false

      // Clean up any blob URLs when component unmounts
      if (exportResult?.url) {
        URL.revokeObjectURL(exportResult.url)
      }

      // Clear any pending timeouts
      if (exportTimeout) {
        clearTimeout(exportTimeout)
      }
    }
  }, [])

  // Get the data for the current tab
  const getCurrentTabData = () => {
    switch (currentTab) {
      case "matched":
        return results.matched || []
      case "file1Only":
        return results.inFile1Only || []
      case "file2Only":
        return results.inFile2Only || []
      case "duplicates_file1":
        return results.duplicatesInFile1 || []
      case "duplicates_file2":
        return results.duplicatesInFile2 || []
      default:
        return []
    }
  }

  // Filter data based on search term
  const filterData = (data: any[]) => {
    if (!searchTerm || !Array.isArray(data)) return data || []

    return data.filter((item) => {
      if (!item) return false

      return Object.values(item).some(
        (value) =>
          value !== null && value !== undefined && String(value).toLowerCase().includes(searchTerm.toLowerCase()),
      )
    })
  }

  // Update paginated data when tab, search, or page changes
  useEffect(() => {
    if (initialRender) {
      setInitialRender(false)
      return
    }

    const tabData = getCurrentTabData()
    const filteredData = filterData(tabData)
    setTotalPages(Math.max(1, Math.ceil(filteredData.length / PAGE_SIZE)))

    // Reset to first page when tab or search changes
    if (currentPage > totalPages) {
      setCurrentPage(1)
    }

    const start = (currentPage - 1) * PAGE_SIZE
    const end = start + PAGE_SIZE
    setPaginatedData(filteredData.slice(start, end))
  }, [currentTab, searchTerm, currentPage, initialRender])

  // Handle tab change
  useEffect(() => {
    if (["matched", "file1Only", "file2Only", "duplicates_file1", "duplicates_file2"].includes(currentTab)) {
      setCurrentPage(1) // Reset to first page when tab changes
    }
  }, [currentTab])

  // Handle page change
  const handlePageChange = (page: number) => {
    setCurrentPage(page)
  }

  // Handle export for a specific category
  const handleCategoryExport = async (category: ExportCategory) => {
    try {
      // Reset state
      setIsExporting(true)
      setExportError(null)
      setExportErrorDetails(null)
      setExportResult(null)
      setShowExportDialog(true)
      setCurrentExportCategory(category)
      setExportProgress({ stage: `Preparing ${category} export`, percent: 0 })

      // Clear any existing timeout
      if (exportTimeout) {
        clearTimeout(exportTimeout)
        setExportTimeout(null)
      }

      // Validate results data
      if (!results || typeof results !== "object") {
        throw new Error("Invalid results data for export")
      }

      // Prepare export data - ensure all arrays are valid and handle null/undefined values
      const exportData = {
        ...results,
        matched: Array.isArray(results.matched) ? results.matched.filter(Boolean) : [],
        inFile1Only: Array.isArray(results.inFile1Only) ? results.inFile1Only.filter(Boolean) : [],
        inFile2Only: Array.isArray(results.inFile2Only) ? results.inFile2Only.filter(Boolean) : [],
        duplicatesInFile1: Array.isArray(results.duplicatesInFile1) ? results.duplicatesInFile1.filter(Boolean) : [],
        duplicatesInFile2: Array.isArray(results.duplicatesInFile2) ? results.duplicatesInFile2.filter(Boolean) : [],
        // Handle duplicate groups specially
        duplicateGroupsInFile1: Array.isArray(results.duplicateGroupsInFile1)
          ? results.duplicateGroupsInFile1.filter((group) => Array.isArray(group) && group.length > 0)
          : [],
        duplicateGroupsInFile2: Array.isArray(results.duplicateGroupsInFile2)
          ? results.duplicateGroupsInFile2.filter((group) => Array.isArray(group) && group.length > 0)
          : [],
        // Ensure summary and other required properties exist
        summary: results.summary || {
          totalInFile1: 0,
          totalInFile2: 0,
          matched: 0,
          inFile1Only: 0,
          inFile2Only: 0,
          duplicatesInFile1: 0,
          duplicatesInFile2: 0,
        },
        columnMappings: Array.isArray(results.columnMappings) ? results.columnMappings : [],
        file1SheetName: results.file1SheetName || "Sheet1",
        file2SheetName: results.file2SheetName || "Sheet2",
      }

      // Set a timeout to abort if export takes too long
      const timeout = setTimeout(() => {
        if (isMounted.current) {
          setExportError("Export timed out. The dataset may be too large to export in the browser.")
          setIsExporting(false)
        }
      }, 300000) // 5 minutes timeout

      setExportTimeout(timeout)

      try {
        // Use the appropriate export function based on category
        const exportResult = await exportCategoryToExcel(
          exportData,
          category,
          "reconciliation_report",
          (stage, percent) => {
            if (isMounted.current) {
              setExportProgress({ stage, percent })
            }
          },
        )

        // Clear the timeout since export completed
        clearTimeout(timeout)
        setExportTimeout(null)

        if (!exportResult.success) {
          throw new Error(exportResult.error || "Export failed")
        }

        // Store the export result for download
        if (isMounted.current) {
          setExportResult({
            url: exportResult.url,
            fileName: exportResult.fileName,
          })

          // Keep the dialog open for a moment to show completion
          setExportProgress({ stage: "Export complete!", percent: 100 })
        }
      } catch (error) {
        clearTimeout(timeout)
        setExportTimeout(null)
        throw error
      }
    } catch (error) {
      console.error("Error during export:", error)

      if (isMounted.current) {
        setExportError(error instanceof Error ? error.message : "Export failed. Please try again.")

        if (error instanceof Error && error.stack) {
          setExportErrorDetails(error.stack)
        }
      }
    } finally {
      if (isMounted.current) {
        setIsExporting(false)
      }
    }
  }

  // Handle full export (all categories)
  const handleFullExport = async () => {
    try {
      // Reset state
      setIsExporting(true)
      setExportError(null)
      setExportErrorDetails(null)
      setExportResult(null)
      setShowExportDialog(true)
      setCurrentExportCategory("full")
      setExportProgress({ stage: "Preparing export", percent: 0 })

      // Clear any existing timeout
      if (exportTimeout) {
        clearTimeout(exportTimeout)
        setExportTimeout(null)
      }

      // Validate results data
      if (!results || typeof results !== "object") {
        throw new Error("Invalid results data for export")
      }

      // Prepare export data - ensure all arrays are valid and handle null/undefined values
      const exportData = {
        ...results,
        matched: Array.isArray(results.matched) ? results.matched.filter(Boolean) : [],
        inFile1Only: Array.isArray(results.inFile1Only) ? results.inFile1Only.filter(Boolean) : [],
        inFile2Only: Array.isArray(results.inFile2Only) ? results.inFile2Only.filter(Boolean) : [],
        duplicatesInFile1: Array.isArray(results.duplicatesInFile1) ? results.duplicatesInFile1.filter(Boolean) : [],
        duplicatesInFile2: Array.isArray(results.duplicatesInFile2) ? results.duplicatesInFile2.filter(Boolean) : [],
        // Handle duplicate groups specially
        duplicateGroupsInFile1: Array.isArray(results.duplicateGroupsInFile1)
          ? results.duplicateGroupsInFile1.filter((group) => Array.isArray(group) && group.length > 0)
          : [],
        duplicateGroupsInFile2: Array.isArray(results.duplicateGroupsInFile2)
          ? results.duplicateGroupsInFile2.filter((group) => Array.isArray(group) && group.length > 0)
          : [],
        // Ensure summary and other required properties exist
        summary: results.summary || {
          totalInFile1: 0,
          totalInFile2: 0,
          matched: 0,
          inFile1Only: 0,
          inFile2Only: 0,
          duplicatesInFile1: 0,
          duplicatesInFile2: 0,
        },
        columnMappings: Array.isArray(results.columnMappings) ? results.columnMappings : [],
        file1SheetName: results.file1SheetName || "Sheet1",
        file2SheetName: results.file2SheetName || "Sheet2",
      }

      // Get the total number of records to export
      const totalRecords =
        exportData.matched.length +
        exportData.inFile1Only.length +
        exportData.inFile2Only.length +
        exportData.duplicatesInFile1.length +
        exportData.duplicatesInFile2.length

      // Show warning for large datasets
      if (totalRecords > 10000) {
        setExportProgress({
          stage: "Preparing to export a large dataset. This may take a while...",
          percent: 0,
        })
        // Give UI time to update
        await new Promise((resolve) => setTimeout(resolve, 100))
      }

      // For very large datasets, suggest category-specific exports instead
      if (totalRecords > 100000) {
        setExportProgress({
          stage: "Analyzing dataset size...",
          percent: 10,
        })

        // Wait a moment to show the message
        await new Promise((resolve) => setTimeout(resolve, 500))

        setExportError(
          `This dataset is very large (${totalRecords.toLocaleString()} records). To prevent browser crashes, please export specific categories individually instead of the full report.`,
        )
        setIsExporting(false)
        return
      }

      // Set a timeout to abort if export takes too long
      const timeout = setTimeout(() => {
        if (isMounted.current) {
          setExportError("Export timed out. The dataset may be too large to export in the browser.")
          setIsExporting(false)
        }
      }, 300000) // 5 minutes timeout

      setExportTimeout(timeout)

      try {
        const exportResult = await exportToExcel(exportData, "reconciliation_report", (stage, percent) => {
          if (isMounted.current) {
            setExportProgress({ stage, percent })
          }
        })

        // Clear the timeout since export completed
        clearTimeout(timeout)
        setExportTimeout(null)

        if (!exportResult.success) {
          throw new Error(exportResult.error || "Export failed")
        }

        // Store the export result for download
        if (isMounted.current) {
          setExportResult({
            url: exportResult.url,
            fileName: exportResult.fileName,
          })

          // Keep the dialog open for a moment to show completion
          setExportProgress({ stage: "Export complete!", percent: 100 })
        }
      } catch (error) {
        clearTimeout(timeout)
        setExportTimeout(null)
        throw error
      }
    } catch (error) {
      console.error("Error during export:", error)

      if (isMounted.current) {
        setExportError(error instanceof Error ? error.message : "Export failed. Please try again.")

        if (error instanceof Error && error.stack) {
          setExportErrorDetails(error.stack)
        }
      }
    } finally {
      if (isMounted.current) {
        setIsExporting(false)
      }
    }
  }

  const downloadExportedFile = () => {
    if (!exportResult?.url || !exportResult?.fileName) {
      setExportError("No file available for download. Please try exporting again.")
      return
    }

    try {
      // Create a new blob from the URL to ensure it's fresh
      fetch(exportResult.url)
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`)
          }
          return response.blob()
        })
        .then((blob) => {
          if (!blob || blob.size === 0) {
            throw new Error("Downloaded file is empty")
          }

          // Create a new URL for the blob
          const freshUrl = URL.createObjectURL(blob)

          // Create and click a download link
          const link = document.createElement("a")
          link.href = freshUrl
          link.download = exportResult.fileName
          document.body.appendChild(link)
          link.click()
          document.body.removeChild(link)

          // Clean up the URL object after a short delay
          setTimeout(() => {
            URL.revokeObjectURL(freshUrl)
            // Don't close the dialog yet
          }, 100)
        })
        .catch((error) => {
          console.error("Error downloading file:", error)
          setExportError(`Failed to download the file: ${error.message}`)
        })
    } catch (error) {
      console.error("Error initiating download:", error)
      setExportError(`Failed to initiate the download: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const closeExportDialog = () => {
    setShowExportDialog(false)
    setCurrentExportCategory(null)

    // Clean up any blob URLs
    if (exportResult?.url) {
      URL.revokeObjectURL(exportResult.url)
      setExportResult(null)
    }
  }

  // Get the export category display name
  const getExportCategoryName = (category: ExportCategory | null): string => {
    switch (category) {
      case "matched":
        return "Matched Transactions"
      case "inFile1Only":
        return "File 1 Only Transactions"
      case "inFile2Only":
        return "File 2 Only Transactions"
      case "duplicatesInFile1":
        return "File 1 Duplicates"
      case "duplicatesInFile2":
        return "File 2 Duplicates"
      case "full":
        return "Full Report"
      default:
        return "Report"
    }
  }

  // Calculate percentages for summary
  const matchedPercentFile1 =
    results.summary.totalInFile1 > 0 ? ((results.summary.matched / results.summary.totalInFile1) * 100).toFixed(1) : "0"

  const unmatchedPercentFile1 =
    results.summary.totalInFile1 > 0
      ? ((results.summary.inFile1Only / results.summary.totalInFile1) * 100).toFixed(1)
      : "0"

  const duplicatesPercentFile1 =
    results.summary.totalInFile1 > 0
      ? ((results.summary.duplicatesInFile1 / results.summary.totalInFile1) * 100).toFixed(1)
      : "0"

  const unmatchedPercentFile2 =
    results.summary.totalInFile2 > 0
      ? ((results.summary.inFile2Only / results.summary.totalInFile2) * 100).toFixed(1)
      : "0"

  const duplicatesPercentFile2 =
    results.summary.totalInFile2 > 0
      ? ((results.summary.duplicatesInFile2 / results.summary.totalInFile2) * 100).toFixed(1)
      : "0"

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
            <div>
              <CardTitle>Reconciliation Results</CardTitle>
              <CardDescription>
                Comparison of transactions between the two workbooks
                <div className="mt-1 flex flex-wrap gap-2">
                  <Badge variant="outline">Sheet 1: {results.file1SheetName}</Badge>
                  <Badge variant="outline">Sheet 2: {results.file2SheetName}</Badge>
                </div>
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    <span className="hidden sm:inline">Export</span>
                    <span className="sm:hidden">Export</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>Export Options</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => handleFullExport()}>
                    <Download className="mr-2 h-4 w-4" />
                    Full Report
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => handleCategoryExport("matched")}
                    disabled={!results.matched || results.matched.length === 0}
                  >
                    <FileDown className="mr-2 h-4 w-4" />
                    Matched Transactions
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleCategoryExport("inFile1Only")}
                    disabled={!results.inFile1Only || results.inFile1Only.length === 0}
                  >
                    <FileDown className="mr-2 h-4 w-4" />
                    File 1 Only Transactions
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleCategoryExport("inFile2Only")}
                    disabled={!results.inFile2Only || results.inFile2Only.length === 0}
                  >
                    <FileDown className="mr-2 h-4 w-4" />
                    File 2 Only Transactions
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleCategoryExport("duplicatesInFile1")}
                    disabled={!results.duplicatesInFile1 || results.duplicatesInFile1.length === 0}
                  >
                    <FileDown className="mr-2 h-4 w-4" />
                    File 1 Duplicates
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleCategoryExport("duplicatesInFile2")}
                    disabled={!results.duplicatesInFile2 || results.duplicatesInFile2.length === 0}
                  >
                    <FileDown className="mr-2 h-4 w-4" />
                    File 2 Duplicates
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button onClick={handleFullExport} disabled={isExporting} className="flex items-center gap-2">
                <Download className="h-4 w-4" />
                <span className="hidden sm:inline">Export Full Report</span>
                <span className="sm:hidden">Export</span>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={currentTab} onValueChange={setCurrentTab}>
            <div className="flex flex-col justify-between items-start mb-4 gap-4">
              <div className="w-full overflow-x-auto pb-2">
                <TabsList className="w-full">
                  <TabsTrigger value="summary" className="text-xs sm:text-sm">
                    Summary
                  </TabsTrigger>
                  <TabsTrigger value="matched" className="text-xs sm:text-sm whitespace-nowrap">
                    Matched ({Array.isArray(results.matched) ? results.matched.length : 0})
                  </TabsTrigger>
                  <TabsTrigger value="file1Only" className="text-xs sm:text-sm whitespace-nowrap">
                    File 1 Only ({Array.isArray(results.inFile1Only) ? results.inFile1Only.length : 0})
                  </TabsTrigger>
                  <TabsTrigger value="file2Only" className="text-xs sm:text-sm whitespace-nowrap">
                    File 2 Only ({Array.isArray(results.inFile2Only) ? results.inFile2Only.length : 0})
                  </TabsTrigger>
                  <TabsTrigger value="duplicates_file1" className="text-xs sm:text-sm whitespace-nowrap">
                    File 1 Dupes ({Array.isArray(results.duplicatesInFile1) ? results.duplicatesInFile1.length : 0})
                  </TabsTrigger>
                  <TabsTrigger value="duplicates_file2" className="text-xs sm:text-sm whitespace-nowrap">
                    File 2 Dupes ({Array.isArray(results.duplicatesInFile2) ? results.duplicatesInFile2.length : 0})
                  </TabsTrigger>
                </TabsList>
              </div>

              {currentTab !== "summary" && (
                <div className="flex gap-2 w-full sm:w-auto">
                  <div className="relative flex-1 sm:w-64">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search..."
                      className="pl-8"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                  </div>

                  {/* Add download button for current tab */}
                  {currentTab === "matched" && results.matched && results.matched.length > 0 && (
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => handleCategoryExport("matched")}
                      title="Download matched transactions"
                    >
                      <FileDown className="h-4 w-4" />
                    </Button>
                  )}
                  {currentTab === "file1Only" && results.inFile1Only && results.inFile1Only.length > 0 && (
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => handleCategoryExport("inFile1Only")}
                      title="Download File 1 only transactions"
                    >
                      <FileDown className="h-4 w-4" />
                    </Button>
                  )}
                  {currentTab === "file2Only" && results.inFile2Only && results.inFile2Only.length > 0 && (
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => handleCategoryExport("inFile2Only")}
                      title="Download File 2 only transactions"
                    >
                      <FileDown className="h-4 w-4" />
                    </Button>
                  )}
                  {currentTab === "duplicates_file1" &&
                    results.duplicatesInFile1 &&
                    results.duplicatesInFile1.length > 0 && (
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => handleCategoryExport("duplicatesInFile1")}
                        title="Download File 1 duplicates"
                      >
                        <FileDown className="h-4 w-4" />
                      </Button>
                    )}
                  {currentTab === "duplicates_file2" &&
                    results.duplicatesInFile2 &&
                    results.duplicatesInFile2.length > 0 && (
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => handleCategoryExport("duplicatesInFile2")}
                        title="Download File 2 duplicates"
                      >
                        <FileDown className="h-4 w-4" />
                      </Button>
                    )}
                </div>
              )}
            </div>

            <TabsContent value="summary">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg flex justify-between items-center">
                      <span>Matched Transactions</span>
                      {results.matched && results.matched.length > 0 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleCategoryExport("matched")}
                          title="Download matched transactions"
                          className="h-6 w-6"
                        >
                          <FileDown className="h-4 w-4" />
                        </Button>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold">{results.summary.matched}</p>
                    <p className="text-sm text-muted-foreground">{matchedPercentFile1}% of File 1</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">Unmatched Transactions</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold">{results.summary.inFile1Only + results.summary.inFile2Only}</p>
                    <div className="flex flex-col gap-2 mt-1">
                      <div className="flex justify-between items-center">
                        <Badge variant="outline">
                          File 1: {results.summary.inFile1Only} ({unmatchedPercentFile1}%)
                        </Badge>
                        {results.inFile1Only && results.inFile1Only.length > 0 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleCategoryExport("inFile1Only")}
                            title="Download File 1 only transactions"
                            className="h-6 w-6"
                          >
                            <FileDown className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                      <div className="flex justify-between items-center">
                        <Badge variant="outline">
                          File 2: {results.summary.inFile2Only} ({unmatchedPercentFile2}%)
                        </Badge>
                        {results.inFile2Only && results.inFile2Only.length > 0 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleCategoryExport("inFile2Only")}
                            title="Download File 2 only transactions"
                            className="h-6 w-6"
                          >
                            <FileDown className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">Duplicate Transactions</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold">
                      {results.summary.duplicatesInFile1 + results.summary.duplicatesInFile2}
                    </p>
                    <div className="flex flex-col gap-2 mt-1">
                      <div className="flex justify-between items-center">
                        <Badge variant="outline">
                          File 1: {results.summary.duplicatesInFile1} ({duplicatesPercentFile1}%)
                        </Badge>
                        {results.duplicatesInFile1 && results.duplicatesInFile1.length > 0 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleCategoryExport("duplicatesInFile1")}
                            title="Download File 1 duplicates"
                            className="h-6 w-6"
                          >
                            <FileDown className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                      <div className="flex justify-between items-center">
                        <Badge variant="outline">
                          File 2: {results.summary.duplicatesInFile2} ({duplicatesPercentFile2}%)
                        </Badge>
                        {results.duplicatesInFile2 && results.duplicatesInFile2.length > 0 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleCategoryExport("duplicatesInFile2")}
                            title="Download File 2 duplicates"
                            className="h-6 w-6"
                          >
                            <FileDown className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="mb-6">
                <h3 className="text-lg font-medium mb-2">Matching Criteria</h3>
                <div className="border rounded-md p-4">
                  <div className="grid grid-cols-2 gap-2 font-medium mb-2 pb-2 border-b">
                    <div>File 1 Column</div>
                    <div>File 2 Column</div>
                  </div>
                  {Array.isArray(results.columnMappings) &&
                    results.columnMappings.map((mapping, index) => (
                      <div key={index} className="grid grid-cols-2 gap-2 py-1">
                        <div>{formatColumnName(mapping.file1Column)}</div>
                        <div>{formatColumnName(mapping.file2Column)}</div>
                      </div>
                    ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">File 1 Summary</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span>Total Transactions:</span>
                        <span className="font-medium">{results.summary.totalInFile1}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Matched:</span>
                        <span className="font-medium">
                          {results.summary.matched} ({matchedPercentFile1}%)
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Unmatched:</span>
                        <span className="font-medium">
                          {results.summary.inFile1Only} ({unmatchedPercentFile1}%)
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Duplicates:</span>
                        <span className="font-medium">
                          {results.summary.duplicatesInFile1} ({duplicatesPercentFile1}%)
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">File 2 Summary</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span>Total Transactions:</span>
                        <span className="font-medium">{results.summary.totalInFile2}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Matched:</span>
                        <span className="font-medium">{results.summary.matched}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Unmatched:</span>
                        <span className="font-medium">
                          {results.summary.inFile2Only} ({unmatchedPercentFile2}%)
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Duplicates:</span>
                        <span className="font-medium">
                          {results.summary.duplicatesInFile2} ({duplicatesPercentFile2}%)
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="duplicates_file1">
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-medium">Duplicates in File 1</h3>
                  {results.duplicatesInFile1 && results.duplicatesInFile1.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCategoryExport("duplicatesInFile1")}
                      className="flex items-center gap-2"
                    >
                      <FileDown className="h-4 w-4" />
                      Download
                    </Button>
                  )}
                </div>

                {results.duplicateGroupsInFile1 && results.duplicateGroupsInFile1.length > 0 ? (
                  <DuplicateGroupDisplay
                    groups={results.duplicateGroupsInFile1}
                    title={`${results.duplicateGroupsInFile1.length} Duplicate Groups Found in File 1`}
                  />
                ) : results.duplicatesInFile1 && results.duplicatesInFile1.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          {Object.keys(results.duplicatesInFile1[0] || {}).map((key) => (
                            <th key={key} className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                              {formatColumnName(key)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedData.map((item, index) => (
                          <tr key={index} className="border-b hover:bg-muted/20">
                            {Object.entries(item).map(([key, value]) => (
                              <td key={key} className="px-4 py-2 text-sm">
                                {value !== null && value !== undefined ? String(value) : ""}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {/* Pagination */}
                    {totalPages > 1 && (
                      <div className="flex justify-center mt-4">
                        <div className="flex space-x-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handlePageChange(1)}
                            disabled={currentPage === 1}
                          >
                            First
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handlePageChange(currentPage - 1)}
                            disabled={currentPage === 1}
                          >
                            Previous
                          </Button>
                          <span className="px-4 py-2 text-sm">
                            Page {currentPage} of {totalPages}
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handlePageChange(currentPage + 1)}
                            disabled={currentPage === totalPages}
                          >
                            Next
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handlePageChange(totalPages)}
                            disabled={currentPage === totalPages}
                          >
                            Last
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-muted-foreground">No duplicates found in File 1</p>
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="duplicates_file2">
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-medium">Duplicates in File 2</h3>
                  {results.duplicatesInFile2 && results.duplicatesInFile2.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCategoryExport("duplicatesInFile2")}
                      className="flex items-center gap-2"
                    >
                      <FileDown className="h-4 w-4" />
                      Download
                    </Button>
                  )}
                </div>

                {results.duplicateGroupsInFile2 && results.duplicateGroupsInFile2.length > 0 ? (
                  <DuplicateGroupDisplay
                    groups={results.duplicateGroupsInFile2}
                    title={`${results.duplicateGroupsInFile2.length} Duplicate Groups Found in File 2`}
                  />
                ) : results.duplicatesInFile2 && results.duplicatesInFile2.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          {Object.keys(results.duplicatesInFile2[0] || {}).map((key) => (
                            <th key={key} className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                              {formatColumnName(key)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedData.map((item, index) => (
                          <tr key={index} className="border-b hover:bg-muted/20">
                            {Object.entries(item).map(([key, value]) => (
                              <td key={key} className="px-4 py-2 text-sm">
                                {value !== null && value !== undefined ? String(value) : ""}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {/* Pagination */}
                    {totalPages > 1 && (
                      <div className="flex justify-center mt-4">
                        <div className="flex space-x-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handlePageChange(1)}
                            disabled={currentPage === 1}
                          >
                            First
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handlePageChange(currentPage - 1)}
                            disabled={currentPage === 1}
                          >
                            Previous
                          </Button>
                          <span className="px-4 py-2 text-sm">
                            Page {currentPage} of {totalPages}
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handlePageChange(currentPage + 1)}
                            disabled={currentPage === totalPages}
                          >
                            Next
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handlePageChange(totalPages)}
                            disabled={currentPage === totalPages}
                          >
                            Last
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-muted-foreground">No duplicates found in File 2</p>
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="matched">
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-medium">Matched Transactions</h3>
                  {results.matched && results.matched.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCategoryExport("matched")}
                      className="flex items-center gap-2"
                    >
                      <FileDown className="h-4 w-4" />
                      Download
                    </Button>
                  )}
                </div>

                {results.matched && results.matched.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          {Object.keys(results.matched[0] || {})
                            .filter((key) => key !== "_matchedWith")
                            .map((key) => (
                              <th key={key} className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                                {formatColumnName(key)}
                              </th>
                            ))}
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedData.map((item, index) => (
                          <tr key={index} className="border-b hover:bg-muted/20">
                            {Object.entries(item)
                              .filter(([key]) => key !== "_matchedWith")
                              .map(([key, value]) => (
                                <td key={key} className="px-4 py-2 text-sm">
                                  {value !== null && value !== undefined ? String(value) : ""}
                                </td>
                              ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {/* Pagination */}
                    {totalPages > 1 && (
                      <div className="flex justify-center mt-4">
                        <div className="flex space-x-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handlePageChange(1)}
                            disabled={currentPage === 1}
                          >
                            First
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handlePageChange(currentPage - 1)}
                            disabled={currentPage === 1}
                          >
                            Previous
                          </Button>
                          <span className="px-4 py-2 text-sm">
                            Page {currentPage} of {totalPages}
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handlePageChange(currentPage + 1)}
                            disabled={currentPage === totalPages}
                          >
                            Next
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handlePageChange(totalPages)}
                            disabled={currentPage === totalPages}
                          >
                            Last
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-muted-foreground">No matched transactions found</p>
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="file1Only">
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-medium">File 1 Only Transactions</h3>
                  {results.inFile1Only && results.inFile1Only.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCategoryExport("inFile1Only")}
                      className="flex items-center gap-2"
                    >
                      <FileDown className="h-4 w-4" />
                      Download
                    </Button>
                  )}
                </div>

                {results.inFile1Only && results.inFile1Only.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          {Object.keys(results.inFile1Only[0] || {}).map((key) => (
                            <th key={key} className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                              {formatColumnName(key)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedData.map((item, index) => (
                          <tr key={index} className="border-b hover:bg-muted/20">
                            {Object.entries(item).map(([key, value]) => (
                              <td key={key} className="px-4 py-2 text-sm">
                                {value !== null && value !== undefined ? String(value) : ""}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {/* Pagination */}
                    {totalPages > 1 && (
                      <div className="flex justify-center mt-4">
                        <div className="flex space-x-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handlePageChange(1)}
                            disabled={currentPage === 1}
                          >
                            First
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handlePageChange(currentPage - 1)}
                            disabled={currentPage === 1}
                          >
                            Previous
                          </Button>
                          <span className="px-4 py-2 text-sm">
                            Page {currentPage} of {totalPages}
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handlePageChange(currentPage + 1)}
                            disabled={currentPage === totalPages}
                          >
                            Next
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handlePageChange(totalPages)}
                            disabled={currentPage === totalPages}
                          >
                            Last
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-muted-foreground">No unmatched transactions found in File 1</p>
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="file2Only">
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-medium">File 2 Only Transactions</h3>
                  {results.inFile2Only && results.inFile2Only.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCategoryExport("inFile2Only")}
                      className="flex items-center gap-2"
                    >
                      <FileDown className="h-4 w-4" />
                      Download
                    </Button>
                  )}
                </div>

                {results.inFile2Only && results.inFile2Only.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          {Object.keys(results.inFile2Only[0] || {}).map((key) => (
                            <th key={key} className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                              {formatColumnName(key)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedData.map((item, index) => (
                          <tr key={index} className="border-b hover:bg-muted/20">
                            {Object.entries(item).map(([key, value]) => (
                              <td key={key} className="px-4 py-2 text-sm">
                                {value !== null && value !== undefined ? String(value) : ""}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {/* Pagination */}
                    {totalPages > 1 && (
                      <div className="flex justify-center mt-4">
                        <div className="flex space-x-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handlePageChange(1)}
                            disabled={currentPage === 1}
                          >
                            First
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handlePageChange(currentPage - 1)}
                            disabled={currentPage === 1}
                          >
                            Previous
                          </Button>
                          <span className="px-4 py-2 text-sm">
                            Page {currentPage} of {totalPages}
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handlePageChange(currentPage + 1)}
                            disabled={currentPage === totalPages}
                          >
                            Next
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handlePageChange(totalPages)}
                            disabled={currentPage === totalPages}
                          >
                            Last
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-muted-foreground">No unmatched transactions found in File 2</p>
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Export Dialog */}
      <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {exportError
                ? "Export Error"
                : exportResult
                  ? "Export Complete"
                  : `Exporting ${getExportCategoryName(currentExportCategory)}...`}
            </DialogTitle>
            <DialogDescription>
              {exportError
                ? "There was an error exporting your data."
                : exportResult
                  ? "Your data has been exported successfully."
                  : "Please wait while your data is being exported."}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            {isExporting && <ProgressIndicator stage={exportProgress.stage} percent={exportProgress.percent} />}

            {exportError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription className="space-y-2">
                  <p>{exportError}</p>
                  {exportErrorDetails && (
                    <details className="text-xs mt-2">
                      <summary>Technical Details</summary>
                      <pre className="mt-2 w-full max-h-48 overflow-auto p-2 rounded bg-slate-950 text-slate-50">
                        {exportErrorDetails}
                      </pre>
                    </details>
                  )}
                </AlertDescription>
              </Alert>
            )}

            {exportResult && !exportError && (
              <Alert className="bg-green-50 border-green-200">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <AlertTitle className="text-green-800">Success</AlertTitle>
                <AlertDescription className="text-green-700">
                  Your file is ready to download: {exportResult.fileName}
                </AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter className="flex sm:justify-between">
            <Button variant="outline" onClick={closeExportDialog} disabled={isExporting}>
              <X className="mr-2 h-4 w-4" />
              Close
            </Button>
            {exportResult && !exportError && (
              <Button onClick={downloadExportedFile} disabled={isExporting}>
                <FileDown className="mr-2 h-4 w-4" />
                Download
              </Button>
            )}
            {exportError && (
              <Button
                onClick={() =>
                  currentExportCategory === "full"
                    ? handleFullExport()
                    : currentExportCategory
                      ? handleCategoryExport(currentExportCategory)
                      : handleFullExport()
                }
                disabled={isExporting}
              >
                <Download className="mr-2 h-4 w-4" />
                Try Again
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function formatColumnName(name: string): string {
  if (!name) return ""
  return name
    .replace(/_/g, " ")
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (str) => str.toUpperCase())
    .trim()
}
