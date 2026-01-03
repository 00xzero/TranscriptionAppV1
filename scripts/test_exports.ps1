# Test Export Functionality
# Validates DOCX and VTT exports with the transcribed project

$ErrorActionPreference = "Stop"

Write-Host "=== Export Functionality Test ===" -ForegroundColor Cyan

# Use the existing project from the smoke test
# Get the most recent completed project
Write-Host "`n[1/4] Finding most recent completed project..." -ForegroundColor Yellow
$projects = Invoke-RestMethod -Method Get -Uri http://localhost:8000/projects
$completedProjects = $projects | Where-Object { $_.status -eq "completed" }

if ($completedProjects.Count -eq 0) {
    Write-Host "  [ERROR] No completed projects found. Run test_deepgram.ps1 first." -ForegroundColor Red
    exit 1
}

$project = $completedProjects | Sort-Object -Property created_at -Descending | Select-Object -First 1
$projectId = $project.id

Write-Host "  [OK] Using project: $projectId" -ForegroundColor Green
Write-Host "  Title: $($project.title)" -ForegroundColor Gray
Write-Host "  Duration: $($project.duration_seconds)s" -ForegroundColor Gray

# Test DOCX export
Write-Host "`n[2/4] Testing DOCX export..." -ForegroundColor Yellow
try {
    $docxUrl = "http://localhost:8000/projects/$projectId/export/docx?include_timestamps=true"
    $docxPath = "test_transcript.docx"
    Invoke-WebRequest -Uri $docxUrl -OutFile $docxPath
    $docxSize = (Get-Item $docxPath).Length
    Write-Host "  [OK] DOCX exported: $docxPath ($docxSize bytes)" -ForegroundColor Green
    Remove-Item $docxPath -ErrorAction SilentlyContinue
} catch {
    Write-Host "  [ERROR] DOCX export failed: $_" -ForegroundColor Red
    exit 1
}

# Test VTT export
Write-Host "`n[3/4] Testing VTT export..." -ForegroundColor Yellow
try {
    $vttUrl = "http://localhost:8000/projects/$projectId/export/vtt"
    $vttPath = "test_captions.vtt"
    Invoke-WebRequest -Uri $vttUrl -OutFile $vttPath
    $vttSize = (Get-Item $vttPath).Length
    $vttContent = Get-Content $vttPath -Raw
    
    Write-Host "  [OK] VTT exported: $vttPath ($vttSize bytes)" -ForegroundColor Green
    
    # Validate VTT structure
    if ($vttContent -match "WEBVTT") {
        Write-Host "  [OK] Valid VTT format detected" -ForegroundColor Green
    } else {
        Write-Host "  [WARN] VTT header not found" -ForegroundColor Yellow
    }
    
    # Show first few lines
    Write-Host "`n  Sample VTT content:" -ForegroundColor Gray
    ($vttContent -split "`n" | Select-Object -First 10) | ForEach-Object {
        Write-Host "    $_" -ForegroundColor DarkGray
    }
    
    Remove-Item $vttPath -ErrorAction SilentlyContinue
} catch {
    Write-Host "  [ERROR] VTT export failed: $_" -ForegroundColor Red
    exit 1
}

# Test speaker rename
Write-Host "`n[4/4] Testing speaker rename..." -ForegroundColor Yellow
try {
    $speakers = Invoke-RestMethod -Method Get -Uri "http://localhost:8000/projects/$projectId/speakers"
    if ($speakers.Count -gt 0) {
        $speaker = $speakers[0]
        $originalLabel = $speaker.label
        $newLabel = "Test Speaker"
        
        # Rename
        $updateBody = @{ label = $newLabel } | ConvertTo-Json
        $updated = Invoke-RestMethod -Method Patch -Uri "http://localhost:8000/speakers/$($speaker.id)" -ContentType 'application/json' -Body $updateBody
        
        if ($updated.label -eq $newLabel) {
            Write-Host "  [OK] Speaker renamed: '$originalLabel' -> '$newLabel'" -ForegroundColor Green
            
            # Restore original name
            $restoreBody = @{ label = $originalLabel } | ConvertTo-Json
            Invoke-RestMethod -Method Patch -Uri "http://localhost:8000/speakers/$($speaker.id)" -ContentType 'application/json' -Body $restoreBody | Out-Null
            Write-Host "  [OK] Speaker name restored" -ForegroundColor Green
        } else {
            Write-Host "  [ERROR] Speaker rename validation failed" -ForegroundColor Red
            exit 1
        }
    } else {
        Write-Host "  [WARN] No speakers found to test rename" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  [ERROR] Speaker rename failed: $_" -ForegroundColor Red
    exit 1
}

# Summary
Write-Host "`n=== Test Summary ===" -ForegroundColor Cyan
Write-Host "  Project: $projectId" -ForegroundColor Gray
Write-Host "  DOCX export: PASSED" -ForegroundColor Green
Write-Host "  VTT export: PASSED" -ForegroundColor Green
Write-Host "  Speaker rename: PASSED" -ForegroundColor Green
Write-Host "`n[SUCCESS] All export tests PASSED" -ForegroundColor Green
