#!/bin/bash
# Exit on error
set -e

# Default values
DEFAULT_ZOOM_MEETING_URL=""
DEFAULT_WORKSTATION_ID="default-workstation-id"

# Check if required environment variables are set, otherwise use defaults
if [ -z "$AGENTSTATION_API_KEY" ]; then
    echo "Error: AGENTSTATION_API_KEY environment variable is not set"
    exit 1
fi

# Use default value for ZOOM_MEETING_URL if not set
if [ -z "$ZOOM_MEETING_URL" ]; then
    echo "Warning: ZOOM_MEETING_URL environment variable is not set, using default value"
    ZOOM_MEETING_URL=$DEFAULT_ZOOM_MEETING_URL
fi

# Use default value for WORKSTATION_ID if not set, otherwise create a new one
if [ -z "$WORKSTATION_ID" ]; then
    echo "WORKSTATION_ID environment variable is not set"
    
    # Create workstation and capture its ID if we don't have a preset WORKSTATION_ID
    echo "Creating workstation..."
    WORKSTATION_ID=$(curl -X POST -L "https://api.agentstation.ai/v1/workstations" \
      -H 'Content-Type: application/json' \
      -H "Authorization: Bearer $AGENTSTATION_API_KEY" \
      -d '{"name": "MyChatBot","type": "default"}' | jq -r '.id')
    
    echo "Created workstation with ID: $WORKSTATION_ID"
else
    echo "Using provided WORKSTATION_ID: $WORKSTATION_ID"
fi

# Join meeting
echo "Joining meeting..."
curl -L "https://api.agentstation.ai/v1/workstations/$WORKSTATION_ID/meeting/join" \
-H 'Content-Type: application/json' \
-H "Authorization: Bearer $AGENTSTATION_API_KEY" \
-d '{ "invite_url": "'$ZOOM_MEETING_URL'", "name": "MyChatBot" }'

# sleep for 5 seconds to allow the workstation to join the meeting and unmute itself
sleep 5

# Speak first message
echo "Speaking first message..."
curl -L -X POST "https://api.agentstation.ai/v1/workstations/$WORKSTATION_ID/audio/speak" \
-H "Authorization: Bearer $AGENTSTATION_API_KEY" \
-d '{ "text": "I am a Chat Bot. Thanks for inviting me to this meeting." }'

# sleep for 500ms for human-like pause effect
sleep 0.5

# Speak second message
echo "Speaking second message..."
curl -L -X POST "https://api.agentstation.ai/v1/workstations/$WORKSTATION_ID/audio/speak" \
-H "Authorization: Bearer $AGENTSTATION_API_KEY" \
-d '{ "text": "Chat bot joined the meeting and greeted everyone warmly. She listened carefully to the discussion, noting key points and observing the flow of conversation. When her name was mentioned, she responded promptly with insightful input, ensuring her answers were clear and relevant. As the meeting progressed, she detected a moment of silence and took the opportunity to summarize key takeaways. Before leaving, she thanked everyone for their time and assured them she was always available for assistance." }'