# assign-agent-license.ps1
# Assigns Microsoft 365 licenses to the Portfolio Manager agentic user
# Run this AFTER creating the agent instance in Teams (which creates the agentic user)

param(
    [string]$AgentUpn = "<YOUR_AGENT_UPN>"
)

Write-Host "Portfolio Manager Digital Worker — License Assignment" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan

# Connect to Graph if not already
$ctx = Get-MgContext
if (-not $ctx) {
    Write-Host "Connecting to Microsoft Graph..."
    Connect-MgGraph -Scopes "User.ReadWrite.All", "Directory.ReadWrite.All", "Organization.Read.All"
}

# Find the agentic user
Write-Host "`nLooking for agent user: $AgentUpn"
$user = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/users?`$filter=userPrincipalName eq '$AgentUpn'&`$select=id,displayName,userPrincipalName,assignedLicenses" -OutputType Json | ConvertFrom-Json

if ($user.value.Count -eq 0) {
    Write-Host "Agent user not found yet. The user is created when you:" -ForegroundColor Yellow
    Write-Host "  1. Upload manifest.zip to M365 Admin Center (Agents > Upload custom agent)" -ForegroundColor Gray
    Write-Host "  2. Configure the blueprint in Teams Developer Portal" -ForegroundColor Gray
    Write-Host "  3. Create an agent instance from Teams > Apps" -ForegroundColor Gray
    Write-Host "`nOnce the agent instance is created, re-run this script." -ForegroundColor Yellow
    exit 1
}

$userId = $user.value[0].id
$displayName = $user.value[0].displayName
Write-Host "Found: $displayName ($AgentUpn) — ID: $userId" -ForegroundColor Green

# Get available license SKUs
$skus = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/subscribedSkus" -OutputType Json | ConvertFrom-Json

# Licenses to assign
$licensesToAssign = @()

# 1. Microsoft 365 E5 (no Teams) — includes Exchange mailbox
$e5 = $skus.value | Where-Object { $_.skuPartNumber -eq "Microsoft_365_E5_(no_Teams)" }
if ($e5 -and ($e5.prepaidUnits.enabled - $e5.consumedUnits) -gt 0) {
    $licensesToAssign += @{ skuId = $e5.skuId }
    Write-Host "  + Microsoft 365 E5 (no Teams) — mailbox, OneDrive" -ForegroundColor Green
} else {
    Write-Host "  ! Microsoft 365 E5 (no Teams) — not available" -ForegroundColor Yellow
}

# 2. Microsoft Teams Enterprise — Teams presence
$teams = $skus.value | Where-Object { $_.skuPartNumber -eq "Microsoft_Teams_Enterprise_New" }
if ($teams -and ($teams.prepaidUnits.enabled - $teams.consumedUnits) -gt 0) {
    $licensesToAssign += @{ skuId = $teams.skuId }
    Write-Host "  + Microsoft Teams Enterprise — Teams access" -ForegroundColor Green
} else {
    Write-Host "  ! Microsoft Teams Enterprise — not available" -ForegroundColor Yellow
}

# 3. Microsoft Agent Frontier — Agent 365 capabilities
$frontier = $skus.value | Where-Object { $_.skuPartNumber -eq "MICROSOFT_AGENT_FRONTIER_NO_TEAMS" }
if ($frontier -and ($frontier.prepaidUnits.enabled - $frontier.consumedUnits) -gt 0) {
    $licensesToAssign += @{ skuId = $frontier.skuId }
    Write-Host "  + Agent Frontier — Agent 365 features" -ForegroundColor Green
} else {
    Write-Host "  ! Agent Frontier — not available" -ForegroundColor Yellow
}

if ($licensesToAssign.Count -eq 0) {
    Write-Host "`nNo licenses available to assign!" -ForegroundColor Red
    exit 1
}

# Assign licenses
Write-Host "`nAssigning $($licensesToAssign.Count) license(s) to $displayName..."
$body = @{
    addLicenses = $licensesToAssign
    removeLicenses = @()
} | ConvertTo-Json -Depth 5

try {
    Invoke-MgGraphRequest -Method POST -Uri "https://graph.microsoft.com/v1.0/users/$userId/assignLicense" -Body $body -ContentType "application/json" -OutputType Json | Out-Null
    Write-Host "Licenses assigned successfully!" -ForegroundColor Green
    Write-Host "`nMailbox and Teams provisioning will complete in ~15 minutes." -ForegroundColor Cyan
} catch {
    Write-Host "Failed to assign licenses: $_" -ForegroundColor Red
}

# Verify
Write-Host "`nVerifying license assignment..."
$updated = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/users/$userId/licenseDetails" -OutputType Json | ConvertFrom-Json
foreach ($lic in $updated.value) {
    Write-Host "  Licensed: $($lic.skuPartNumber)" -ForegroundColor Green
}

Write-Host "`n=====================================================" -ForegroundColor Cyan
Write-Host "Done! The agent user will have a mailbox in ~15 minutes." -ForegroundColor Green
