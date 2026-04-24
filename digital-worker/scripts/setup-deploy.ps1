# Portfolio Manager Digital Worker
# Deployment setup script for Agent 365

# ── Prerequisites ──
# 1. .NET 8.0 SDK installed (for Agent 365 CLI)
# 2. Azure CLI authenticated (az login)
# 3. Node.js 18+ installed
# 4. Part of the Agent 365 Frontier preview program

Write-Host "Portfolio Manager Digital Worker — Setup & Deployment" -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan

# ── Step 1: Install Agent 365 CLI ──
Write-Host "`n[Step 1] Installing Agent 365 CLI..." -ForegroundColor Yellow
dotnet tool install --global Microsoft.Agents.A365.DevTools.Cli --prerelease 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "CLI already installed, updating..." -ForegroundColor Gray
    dotnet tool update --global Microsoft.Agents.A365.DevTools.Cli --prerelease
}
Write-Host "Verifying CLI installation:"
a365 --version

# ── Step 2: Authenticate with Azure ──
Write-Host "`n[Step 2] Ensuring Azure authentication..." -ForegroundColor Yellow
$account = az account show 2>$null | ConvertFrom-Json
if (-not $account) {
    Write-Host "Please sign in to Azure..."
    az login
}
Write-Host "Signed in as: $($account.user.name)" -ForegroundColor Green
Write-Host "Subscription: $($account.name)" -ForegroundColor Green

# ── Step 3: Initialize Agent 365 configuration ──
Write-Host "`n[Step 3] Initializing Agent 365 configuration..." -ForegroundColor Yellow
Write-Host "Running: a365 config init"
Write-Host "Follow the interactive prompts to configure your agent." -ForegroundColor Gray
Write-Host ""
Write-Host "Key settings to provide:" -ForegroundColor Gray
Write-Host "  - Client App ID: Your custom Entra app registration" -ForegroundColor Gray
Write-Host "  - Project path: $(Get-Location)" -ForegroundColor Gray
Write-Host "  - Manager email: Your admin account email" -ForegroundColor Gray
Write-Host "  - Agent UPN: portfoliomanager@yourtenant.onmicrosoft.com" -ForegroundColor Gray
Write-Host ""

# Uncomment to run interactively:
# a365 config init

# ── Step 4: Setup MCP server permissions ──
Write-Host "`n[Step 4] Adding MCP server permissions..." -ForegroundColor Yellow
Write-Host "Adding Mail, Calendar, and Teams MCP servers for the digital worker..."

# These add the A365 platform MCP servers (Mail, Calendar, Teams)
# a365 develop add-mcp-servers mcp_MailTools
# a365 develop add-mcp-servers mcp_CalendarTools
# a365 develop add-mcp-servers mcp_TeamsTools

Write-Host "MCP servers configured in ToolingManifest.json" -ForegroundColor Green

# ── Step 5: Add custom Graph permissions ──
Write-Host "`n[Step 5] Configuring Graph API permissions..." -ForegroundColor Yellow
# The agent needs these permissions for autonomous operation:
# - Mail.Read, Mail.Send: Read and send emails
# - Calendars.Read, Calendars.ReadWrite: Read calendar, create meeting summaries
# - Chat.Create, Chat.ReadWrite: Create Teams chats, send messages
# - User.Read: Read user profiles
# - OnlineMeetings.Read: Read meeting details

# a365 config permissions `
#   --resource-app-id 00000003-0000-0000-c000-000000000000 `
#   --scopes Mail.Read,Mail.Send,Calendars.Read,Calendars.ReadWrite,Chat.Create,Chat.ReadWrite,User.Read,OnlineMeetings.Read

# ── Step 6: Setup agent blueprint ──
Write-Host "`n[Step 6] Setting up agent blueprint..." -ForegroundColor Yellow
Write-Host "This creates Azure infrastructure, registers the agent blueprint,"
Write-Host "and configures API permissions."
Write-Host ""

# a365 setup all

# ── Step 7: Build and deploy ──
Write-Host "`n[Step 7] Building and deploying..." -ForegroundColor Yellow

# Install dependencies
Write-Host "Installing npm dependencies..."
# npm install

# Build TypeScript
Write-Host "Building TypeScript..."
# npm run build

# Deploy to Azure
Write-Host "Deploying to Azure Web App..."
# a365 deploy

# ── Step 8: Publish to admin center ──
Write-Host "`n[Step 8] Publishing to Microsoft 365 admin center..." -ForegroundColor Yellow
# a365 publish

# ── Step 9: Create agent instance ──
Write-Host "`n[Step 9] Create agent instance..." -ForegroundColor Yellow
Write-Host "After publishing, create the agent instance in Teams:" -ForegroundColor Gray
Write-Host "  1. Open Microsoft Teams" -ForegroundColor Gray
Write-Host "  2. Go to Apps" -ForegroundColor Gray
Write-Host "  3. Search for 'Portfolio Manager'" -ForegroundColor Gray
Write-Host "  4. Select 'Add' to create an agent instance" -ForegroundColor Gray
Write-Host ""
Write-Host "The agent will appear in your org chart, reporting to you." -ForegroundColor Gray
Write-Host "It will have its own mailbox and be @mentionable in Teams/Outlook." -ForegroundColor Gray

Write-Host "`n====================================================" -ForegroundColor Cyan
Write-Host "Setup script complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Uncomment and run the a365 commands above" -ForegroundColor Gray
Write-Host "  2. Complete the interactive config wizard" -ForegroundColor Gray
Write-Host "  3. A Global Administrator must grant OAuth2 consent" -ForegroundColor Gray
Write-Host "  4. Assign Microsoft 365 E5 license to the agent user" -ForegroundColor Gray
Write-Host "  5. Wait ~15 minutes for mailbox provisioning" -ForegroundColor Gray
Write-Host ""
Write-Host "For testing locally:" -ForegroundColor Yellow
Write-Host "  npm install" -ForegroundColor Gray
Write-Host "  cp .env.template .env  # fill in your values" -ForegroundColor Gray
Write-Host "  npm run dev" -ForegroundColor Gray
Write-Host "  npm run test-tool  # opens Agents Playground" -ForegroundColor Gray
