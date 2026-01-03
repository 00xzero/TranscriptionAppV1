$projectId = "13bcdde4-88cb-4557-a582-94bd8e053c62"

Write-Host "Testing DOCX export..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:8000/projects/$projectId/export/docx" -OutFile "test.docx"
    Write-Host "Success! File size: $((Get-Item test.docx).Length) bytes" -ForegroundColor Green
    Remove-Item test.docx
} catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Response: $($_.Exception.Response.StatusCode)" -ForegroundColor Red
}
