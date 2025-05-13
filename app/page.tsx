import { FileUploadForm } from "@/components/file-upload-form"

export default function Home() {
  return (
    <main className="container mx-auto py-10 px-4">
      <h1 className="text-3xl font-bold text-center mb-2">Kirill's Reconciliation Tool</h1>
      <p className="text-center text-muted-foreground mb-8">
        Compare data between two Excel workbooks and find discrepancies
      </p>
      <FileUploadForm />
    </main>
  )
}
