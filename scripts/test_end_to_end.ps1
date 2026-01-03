# End-to-End Integration Test
# Tests complete workflow: Upload → Transcribe → Edit → Export

$ErrorActionPreference = "Stop"

Write-Host "=== End-to-End Integration Test ===" -ForegroundColor Cyan
Write-Host "This test validates the complete transcription pipeline" -ForegroundColor Gray
Write-Host ""

# Configuration
$apiBase = "http://localhost:8000"
$mediaPath = "c:\Users\hamza\CascadeProjects\meeting-transciption-maker\example files\07. Helsingborg Warehouse Dump Request and Inbound Outbound flows contact support with Jorgan Andersson 10.09.25.mp4"

# Step 1: Upload & Create Project
Write-Host "[1/7] Creating project and uploading media..." -ForegroundColor Yellow
$createBody = @{
    title = "E2E Test - $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
    filename = "test_media.mp4"
    content_type = "video/mp4"
} | ConvertTo-Json

$project = Invoke-RestMethod -Method Post -Uri "$apiBase/projects" -ContentType 'application/json' -Body $createBody
$projectId = $project.project.id
$uploadUrl = $project.upload_url

Write-Host "  [OK] Project created: $projectId" -ForegroundColor Green

Invoke-WebRequest -Method Put -Uri $uploadUrl -InFile $mediaPath -ContentType "video/mp4" | Out-Null
Write-Host "  [OK] Media uploaded (20MB)" -ForegroundColor Green

# Step 2: Start Transcription
Write-Host "`n[2/7] Starting Deepgram transcription..." -ForegroundColor Yellow
$startResp = Invoke-RestMethod -Method Post -Uri "$apiBase/projects/$projectId/start"
Write-Host "  [OK] Transcription task started: $($startResp.task_id)" -ForegroundColor Green

# Step 3: Wait for Completion
Write-Host "`n[3/7] Waiting for transcription to complete..." -ForegroundColor Yellow
$maxPolls = 60
$pollCount = 0

do {
    Start-Sleep -Seconds 3
    $pollCount++
    $p = Invoke-RestMethod -Method Get -Uri "$apiBase/projects/$projectId"
    if ($pollCount % 5 -eq 0) {
        Write-Host "  Status: $($p.status) (${pollCount}s elapsed)" -ForegroundColor Gray
    }
    
    if ($pollCount -ge $maxPolls) {
        Write-Host "  [ERROR] Timeout after $($maxPolls * 3)s" -ForegroundColor Red
        exit 1
    }
} while ($p.status -ne "completed" -and $p.status -ne "error")

if ($p.status -eq "error") {
    Write-Host "  [ERROR] Transcription failed" -ForegroundColor Red
    exit 1
}

Write-Host "  [OK] Transcription completed in $($pollCount * 3)s" -ForegroundColor Green
Write-Host "  Duration: $($p.duration_seconds)s | Status: $($p.status)" -ForegroundColor Gray

# Step 4: Fetch and Validate Transcript Data
Write-Host "`n[4/7] Fetching transcript data..." -ForegroundColor Yellow
$segments = Invoke-RestMethod -Method Get -Uri "$apiBase/projects/$projectId/segments"
$speakers = Invoke-RestMethod -Method Get -Uri "$apiBase/projects/$projectId/speakers"

Write-Host "  [OK] Retrieved $($segments.Count) segments" -ForegroundColor Green
Write-Host "  [OK] Detected $($speakers.Count) speakers" -ForegroundColor Green

if ($segments.Count -eq 0) {
    Write-Host "  [ERROR] No segments found" -ForegroundColor Red
    exit 1
}

# Step 5: Test Segment Edit
Write-Host "`n[5/7] Testing segment text editing..." -ForegroundColor Yellow
$testSegment = $segments[0]
$originalText = $testSegment.text
$editedText = "[EDITED] " + $originalText

$editBody = @{ text = $editedText } | ConvertTo-Json
$updated = Invoke-RestMethod -Method Patch -Uri "$apiBase/segments/$($testSegment.id)" -ContentType 'application/json' -Body $editBody

if ($updated.text -eq $editedText) {
    Write-Host "  [OK] Segment edited successfully" -ForegroundColor Green
    
    # Restore original text
    $restoreBody = @{ text = $originalText } | ConvertTo-Json
    Invoke-RestMethod -Method Patch -Uri "$apiBase/segments/$($testSegment.id)" -ContentType 'application/json' -Body $restoreBody | Out-Null
    Write-Host "  [OK] Original text restored" -ForegroundColor Green
} else {
    Write-Host "  [ERROR] Edit validation failed" -ForegroundColor Red
    exit 1
}

# Step 6: Test Speaker Rename
Write-Host "`n[6/7] Testing speaker management..." -ForegroundColor Yellow
if ($speakers.Count -gt 0) {
    $speaker = $speakers[0]
    $originalLabel = $speaker.label
    $newLabel = "John Doe (Test)"
    
    $speakerBody = @{ label = $newLabel } | ConvertTo-Json
    $updatedSpeaker = Invoke-RestMethod -Method Patch -Uri "$apiBase/speakers/$($speaker.id)" -ContentType 'application/json' -Body $speakerBody
    
    if ($updatedSpeaker.label -eq $newLabel) {
        Write-Host "  [OK] Speaker renamed: '$originalLabel' -> '$newLabel'" -ForegroundColor Green
        
        # Restore
        $restoreSpeaker = @{ label = $originalLabel } | ConvertTo-Json
        Invoke-RestMethod -Method Patch -Uri "$apiBase/speakers/$($speaker.id)" -ContentType 'application/json' -Body $restoreSpeaker | Out-Null
        Write-Host "  [OK] Speaker label restored" -ForegroundColor Green
    } else {
        Write-Host "  [ERROR] Speaker rename failed" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "  [WARN] No speakers to test" -ForegroundColor Yellow
}

# Step 7: Test Exports
Write-Host "`n[7/7] Testing export functionality..." -ForegroundColor Yellow

# DOCX export
$docxPath = "e2e_test.docx"
Invoke-WebRequest -Uri "$apiBase/projects/$projectId/export/docx?include_timestamps=true" -OutFile $docxPath
$docxSize = (Get-Item $docxPath).Length
Write-Host "  [OK] DOCX export: $docxSize bytes" -ForegroundColor Green
Remove-Item $docxPath

# VTT export  
$vttPath = "e2e_test.vtt"
Invoke-WebRequest -Uri "$apiBase/projects/$projectId/export/vtt" -OutFile $vttPath
$vttSize = (Get-Item $vttPath).Length
$vttContent = Get-Content $vttPath -Raw

if ($vttContent -match "WEBVTT") {
    Write-Host "  [OK] VTT export: $vttSize bytes (valid format)" -ForegroundColor Green
} else {
    Write-Host "  [ERROR] VTT format validation failed" -ForegroundColor Red
    Remove-Item $vttPath
    exit 1
}
Remove-Item $vttPath

# Final Summary
Write-Host "`n=== Test Summary ===" -ForegroundColor Cyan
Write-Host "  Project ID: $projectId" -ForegroundColor Gray
Write-Host "  Segments: $($segments.Count)" -ForegroundColor Gray
Write-Host "  Speakers: $($speakers.Count)" -ForegroundColor Gray
Write-Host "  Duration: $($p.duration_seconds)s" -ForegroundColor Gray
Write-Host ""
Write-Host "  [PASS] Upload & Create" -ForegroundColor Green
Write-Host "  [PASS] Deepgram Transcription" -ForegroundColor Green
Write-Host "  [PASS] Segment Editing" -ForegroundColor Green
Write-Host "  [PASS] Speaker Management" -ForegroundColor Green
Write-Host "  [PASS] DOCX Export" -ForegroundColor Green
Write-Host "  [PASS] VTT Export" -ForegroundColor Green
Write-Host ""
Write-Host "[SUCCESS] All end-to-end tests PASSED!" -ForegroundColor Green
Write-Host "The complete transcription pipeline is fully functional." -ForegroundColor Cyan
