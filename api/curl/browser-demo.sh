#!/usr/bin/env bash
#
# agentstation_demo.sh
#
# Bash script demonstrating how to replicate the Puppeteer flows
# using AgentStation's REST API (instead of a Puppeteer client).
# Requires: curl, jq

set -euo pipefail

# --- Configuration ---
API_BASE_URL="https://stage.api.agentstation.dev/v1"
API_KEY="${AGENTSTATION_API_KEY}"
WORKSTATION_NAME="demo-workstation"
WORKSTATION_TYPE="default"
SEARCH_QUERY="agentstation.ai"

# --- Check Env ---
if [ -z "$API_KEY" ]; then
  echo "ERROR: AGENTSTATION_API_KEY environment variable not set."
  exit 1
fi

# --- Create Workstation ---
echo "🚀 Creating new workstation..."
CREATE_RESPONSE=$(curl -s -X POST "$API_BASE_URL/workstations" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d "{
    \"name\": \"$WORKSTATION_NAME\",
    \"type\": \"$WORKSTATION_TYPE\"
  }"
)

# Parse out the Workstation ID from the JSON
WORKSTATION_ID=$(echo "$CREATE_RESPONSE" | jq -r '.id // empty')

if [ -z "$WORKSTATION_ID" ] || [ "$WORKSTATION_ID" = "null" ]; then
  echo "❌ Failed to create workstation. Response was:"
  echo "$CREATE_RESPONSE"
  exit 1
fi

echo "✅ Workstation created: $WORKSTATION_ID"
echo "🔗 Visit https://app.agentstation.ai/workstations to see it."

sleep 2

echo "Starting recorder..."
RECORD_RESPONSE=$(curl -s -X POST "$API_BASE_URL/workstations/$WORKSTATION_ID/recorder/start" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json")


echo "🕒 Waiting for 10 seconds while workstation finishes setting up..."
sleep 10

echo "📱 Opening new browser page..."

# ------------------------------------------------------------------------------
# 1) Navigate to Google
# ------------------------------------------------------------------------------
echo "🌐 Navigating to google.com..."
NAVIGATE_RESPONSE=$(curl -s -X POST "$API_BASE_URL/workstations/$WORKSTATION_ID/browser/navigate" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d "{
    \"url\": \"https://www.google.com\"
  }")

echo "✅ Google homepage loaded successfully"

sleep 2

# ------------------------------------------------------------------------------
# 2) Type search query ("agentstation.ai")
# ------------------------------------------------------------------------------
echo "🔍 Preparing to search for '$SEARCH_QUERY'..."
echo "🔍 Typing '$SEARCH_QUERY' into Google search box..."
TYPE_RESPONSE=$(curl -s -X POST "$API_BASE_URL/workstations/$WORKSTATION_ID/browser/input" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d "{
    \"selector\": \"textarea[name=\\\"q\\\"]\",
    \"text\": \"$SEARCH_QUERY\"
  }")

sleep 2

# ------------------------------------------------------------------------------
# 3) Press Enter
# ------------------------------------------------------------------------------
echo "🚀 Pressing Enter to submit the search..."
KEY_RESPONSE=$(curl -s -X POST "$API_BASE_URL/workstations/$WORKSTATION_ID/browser/keyboard" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "event": "press",
    "text": "Enter"
  }')

echo "⏳ Waiting for search results to load..."
sleep 3

# ------------------------------------------------------------------------------
# 4) Click the first result (selector: h3.LC20lb)
# ------------------------------------------------------------------------------
echo "✨ Clicking on the first search result..."
CLICK_RESPONSE=$(curl -s -X POST "$API_BASE_URL/workstations/$WORKSTATION_ID/browser/click" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "selector": "h3.LC20lb"
  }')

echo "⌛ Waiting for AgentStation page to fully load..."
sleep 5
echo "✅ AgentStation page loaded successfully"

# ------------------------------------------------------------------------------
# 5) Navigate to https://agentstation.ai/launch
# ------------------------------------------------------------------------------
echo "🎯 Navigating directly to https://agentstation.ai/launch..."
NAVIGATE_RESPONSE=$(curl -s -X POST "$API_BASE_URL/workstations/$WORKSTATION_ID/browser/navigate" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "url": "https://agentstation.ai/launch"
  }')

echo "🎉 Successfully arrived at AgentStation launch page"

sleep 5

# ------------------------------------------------------------------------------
# 6) Clicking the "Launch" button
# ------------------------------------------------------------------------------
echo "🎯 Clicking the 'Launch' button..."
CLICK_RESPONSE=$(curl -s -X POST "$API_BASE_URL/workstations/$WORKSTATION_ID/browser/click" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "selector": ".launch-button"
  }')

echo "🚀 Clicked the 'Launch' button... go rocket go!"

sleep 10

echo "✨ Demo run completed successfully!"