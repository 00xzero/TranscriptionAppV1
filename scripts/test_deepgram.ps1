# Deepgram Integration Smoke Test
# Tests end-to-end transcription with Deepgram Nova 3

$ErrorActionPreference = "Stop"

Write-Host "=== Deepgram Integration Smoke Test ===" -ForegroundColor Cyan

# 1) Create project
Write-Host "`n[1/5] Creating project..." -ForegroundColor Yellow
$body = @{
    title = "Helsingborg Warehouse - Deepgram Test"
    filename = "helsingborg.mp4"
    content_type = "video/mp4"
} | ConvertTo-Json

$proj = Invoke-RestMethod -Method Post -Uri http://localhost:8000/projects -ContentType 'application/json' -Body $body
$projectId = $proj.project.id
$uploadUrl = $proj.upload_url

Write-Host "  [OK] Project created: $projectId" -ForegroundColor Green

# 2) Upload media
Write-Host "`n[2/5] Uploading media to MinIO..." -ForegroundColor Yellow
$mediaPath = "c:\Users\hamza\CascadeProjects\meeting-transciption-maker\example files\07. Helsingborg Warehouse Dump Request and Inbound Outbound flows contact support with Jorgan Andersson 10.09.25.mp4"

if (-not (Test-Path $mediaPath)) {
    Write-Host "  [ERROR] Media file not found: $mediaPath" -ForegroundColor Red
    exit 1
}

Invoke-WebRequest -Method Put -Uri $uploadUrl -InFile $mediaPath -ContentType "video/mp4" | Out-Null
Write-Host "  [OK] Media uploaded (20MB)" -ForegroundColor Green

# 3) Start transcription
Write-Host "`n[3/5] Starting Deepgram transcription..." -ForegroundColor Yellow
$startResp = Invoke-RestMethod -Method Post -Uri ("http://localhost:8000/projects/{0}/start" -f $projectId)
Write-Host "  [OK] Task enqueued: $($startResp.task_id)" -ForegroundColor Green

# 4) Poll for completion
Write-Host "`n[4/5] Waiting for transcription to complete..." -ForegroundColor Yellow
$maxPolls = 120  # 6 minutes max
$pollCount = 0

do {
    Start-Sleep -Seconds 3
    $pollCount++
    $p = Invoke-RestMethod -Method Get -Uri ("http://localhost:8000/projects/{0}" -f $projectId)
    Write-Host "  Status: $($p.status) - Poll $pollCount" -ForegroundColor Gray
    
    if ($pollCount -ge $maxPolls) {
        Write-Host "  [ERROR] Timeout waiting for completion" -ForegroundColor Red
        exit 1
    }
} while ($p.status -ne "completed" -and $p.status -ne "error")

if ($p.status -eq "error") {
    Write-Host "  [ERROR] Transcription failed with error status" -ForegroundColor Red
    exit 1
}

Write-Host "  [OK] Transcription completed in $($pollCount * 3)s" -ForegroundColor Green
Write-Host "  Duration: $($p.duration_seconds)s" -ForegroundColor Gray

# 5) Fetch and display segments
Write-Host "`n[5/5] Fetching transcript segments..." -ForegroundColor Yellow
$segments = Invoke-RestMethod -Method Get -Uri ("http://localhost:8000/projects/{0}/segments" -f $projectId)

Write-Host "  [OK] Retrieved $($segments.Count) segments" -ForegroundColor Green

# Fetch speakers
$speakers = Invoke-RestMethod -Method Get -Uri ("http://localhost:8000/projects/{0}/speakers" -f $projectId)
Write-Host "  [OK] Detected $($speakers.Count) speakers" -ForegroundColor Green

# Display sample
Write-Host "`n=== Sample Transcript (first 5 segments) ===" -ForegroundColor Cyan
$segments | Select-Object -First 5 | ForEach-Object {
    $startSec = [Math]::Round($_.start_ms / 1000, 1)
    $endSec = [Math]::Round($_.end_ms / 1000, 1)
    $speakerId = if ($_.speaker_id) { $_.speaker_id.Substring(0,8) } else { "none" }
    Write-Host "[$startSec - $endSec] Speaker $speakerId" -ForegroundColor DarkGray
    Write-Host "  $($_.text)" -ForegroundColor White
}

# Summary
Write-Host "`n=== Test Summary ===" -ForegroundColor Cyan
Write-Host "  Project ID: $projectId" -ForegroundColor Gray
Write-Host "  Status: $($p.status)" -ForegroundColor Green
Write-Host "  Duration: $($p.duration_seconds)s" -ForegroundColor Gray
Write-Host "  Segments: $($segments.Count)" -ForegroundColor Gray
Write-Host "  Speakers: $($speakers.Count)" -ForegroundColor Gray
Write-Host "`n[SUCCESS] Deepgram integration test PASSED" -ForegroundColor Green
