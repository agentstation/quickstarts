import { EventSource } from "eventsource";

// Read API key and workstation ID from environment variables
const AGENTSTATION_API_KEY = process.env.AGENTSTATION_API_KEY;
const WORKSTATION_ID = process.env.WORKSTATION_ID;

// Set configurable constants with environment variable fallbacks
const SSE_TIMEOUT_MS = parseInt(process.env.SSE_TIMEOUT_MS || "210000", 10); // 3.5 minutes
const KEYWORD = process.env.KEYWORD || "robot";
const RESTART_DELAY_MS = parseInt(process.env.RESTART_DELAY_MS || "1000", 10);

// Add a flag to track the first connection at the module level
let isFirstConnection = true;

// Validate required AGENTSTATION_API_KEY environment variable
if (!AGENTSTATION_API_KEY) {
  console.error("Error: AGENTSTATION_API_KEY environment variable is required");
  process.exit(1);
}

// Validate required WORKSTATION_ID environment variable
if (!WORKSTATION_ID) {
  console.error("Error: WORKSTATION_ID environment variable is required");
  process.exit(1);
}

// Log the first 10 characters of the API key for debugging purposes
console.log(
  "Using API key starting with:",
  AGENTSTATION_API_KEY
    ? AGENTSTATION_API_KEY.substring(0, 16) + "..."
    : "undefined"
);

// Simple placeholder function to 'speak' a message
function speak(message) {
  console.log(message);
}

// Function to listen for the keyword
function listenForKeyword(workstationId, reconnectAttempt = 0) {
  const url = `https://api.agentstation.ai/v1/workstations/${workstationId}/audio/listen?stream=true&indicators=false&utterance=false`;

  // Record the time when the connection is opened
  const startTime = Date.now();

  // Set a flag when timeout is exceeded, but don't close connection yet
  let timeoutExceeded = false;

  // Track if we've spoken a final transcript before
  let hasFinalTranscript = false;

  // Track if the keyword was detected in the last final transcript
  let keywordDetected = false;

  // Track consecutive keyword detections
  let consecutiveKeywordDetection = false;

  // Update the EventSource initialization to use custom fetch for headers
  const eventSource = new EventSource(url, {
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        headers: {
          ...init?.headers,
          Authorization: `Bearer ${AGENTSTATION_API_KEY}`,
        },
      }),
  });

  // Set a timeout timer
  const timeoutTimer = setTimeout(() => {
    timeoutExceeded = true;
  }, SSE_TIMEOUT_MS);

  // Debug when connection opens
  eventSource.onopen = () => {
    // Only log connection messages on the very first connection
    if (isFirstConnection) {
      console.log("🔗 Connection to SSE stream has been opened successfully");
      console.log(`🎤 Listening for keyword: "${KEYWORD}"`);
      isFirstConnection = false;
    }
  };

  // Listen for partial transcripts
  eventSource.addEventListener("partial", (event) => {
    try {
      const data = JSON.parse(event.data);
      let transcript = data.transcript.trim();
      const confidence = data.confidence || 0;

      // For partial transcripts, add "..." suffix and use a different prefix
      // If we've had a final transcript before, move cursor up one line to override it
      if (hasFinalTranscript) {
        // Move cursor up the appropriate number of lines and clear them
        if (keywordDetected) {
          // Move up 2 lines (keyword alert + response message)
          // The final transcript line was already replaced by the keyword alert
          process.stdout.write("\x1b[2A\x1b[K"); // Move up 2 lines and clear first line
          process.stdout.write("\n"); // Move down to the second line
          process.stdout.write("\x1b[K"); // Clear the second line
          process.stdout.write("\x1b[1A"); // Move back up to the first line
          keywordDetected = false;
        } else {
          // Move up 1 line (just the final transcript)
          process.stdout.write("\x1b[1A\x1b[K");
        }
        hasFinalTranscript = false;
        // Reset consecutive detection flag when starting a new partial
        consecutiveKeywordDetection = false;
      }
      // Overwrite the same line, clearing any previous output
      process.stdout.write(`\r\x1b[K💬 ${transcript}...`);
    } catch (error) {
      console.error("Error processing partial transcript:", error);
    }
  });

  // Listen for speech ended event - simplified logic
  eventSource.addEventListener("speech_ended", () => {
    // If timeout exceeded or we've been connected long enough, reconnect
    if (timeoutExceeded || Date.now() - startTime >= SSE_TIMEOUT_MS) {
      reconnect();
    }
  });

  // Listen for final transcripts
  eventSource.addEventListener("final", (event) => {
    try {
      const data = JSON.parse(event.data);
      const transcript = data.transcript.trim();
      const confidence = data.confidence || 0;

      // Function to get color-coded confidence indicator
      const getConfidenceIndicator = (confidence) => {
        // Convert confidence to a percentage
        const confidencePercent = Math.round(confidence * 100);

        // Color coding based on confidence level
        if (confidencePercent < 70) {
          // Red for low confidence
          return `\x1b[31m[${confidencePercent}% confidence]\x1b[0m`;
        } else if (confidencePercent < 90) {
          // Yellow for medium confidence
          return `\x1b[33m[${confidencePercent}% confidence]\x1b[0m`;
        } else {
          // Green for high confidence
          return `\x1b[32m[${confidencePercent}% confidence]\x1b[0m`;
        }
      };

      // Get the color-coded confidence indicator
      const confidenceIndicator = getConfidenceIndicator(confidence);

      // If this is a consecutive keyword detection, we need to handle differently
      if (keywordDetected) {
        consecutiveKeywordDetection = true;
        // Don't write a new final transcript line, just continue with keyword detection
      } else {
        // If we already have a final transcript and this is not after a keyword detection,
        // move the cursor up to replace the previous final transcript
        if (hasFinalTranscript && !consecutiveKeywordDetection) {
          // Move up 1 line to replace the previous final transcript
          process.stdout.write("\x1b[1A\x1b[K");
        }

        // Replace the partial line with the final transcript
        // Use a checkmark for final transcripts and include the confidence indicator
        process.stdout.write(
          `\r\x1b[K✅ ${transcript} ${confidenceIndicator}\n`
        );
      }

      // Set the flag to indicate we've had a final transcript
      hasFinalTranscript = true;

      // Reset keyword detected flag - we'll set it again if needed
      keywordDetected = false;

      // If the transcript contains the keyword, highlight it and speak a message
      if (transcript && new RegExp(`\\b${KEYWORD}\\b`, "i").test(transcript)) {
        // Highlight the keyword in the console output with asterisks
        const highlightedTranscript = transcript.replace(
          new RegExp(`\\b(${KEYWORD})\\b`, "gi"),
          "**$1**"
        );

        // Handle consecutive keyword detections differently
        if (consecutiveKeywordDetection) {
          // Move up 2 lines (previous keyword alert + previous response message)
          process.stdout.write("\x1b[2A\x1b[K");
        } else {
          // Move cursor up one line to replace the final transcript line
          process.stdout.write("\x1b[1A\x1b[K");
        }

        // Write the keyword detection message with confidence indicator
        process.stdout.write(
          `🚨 keyword '${KEYWORD}' heard: "${highlightedTranscript}" ${confidenceIndicator}\n`
        );

        speak("🤖 Hello! How can I assist you?");

        // Set the flag to indicate keyword was detected
        keywordDetected = true;
        // Reset consecutive detection flag
        consecutiveKeywordDetection = false;
      } else {
        // Reset consecutive detection flag if no keyword was detected
        consecutiveKeywordDetection = false;
      }
    } catch (error) {
      console.error("Error processing final transcript:", error);
    }
  });

  // Improved error handling with a single handler
  eventSource.onerror = (error) => {
    console.error("SSE Connection Error:");
    if (error.status) {
      console.error(`HTTP error status: ${error.status}`);
    }
    if (error.message) {
      console.error(`Error message: ${error.message}`);
    }

    reconnect(true);
  };

  // Add these constants for better reconnection handling
  const MAX_RECONNECT_ATTEMPTS = parseInt(
    process.env.MAX_RECONNECT_ATTEMPTS || "10",
    10
  );
  const BASE_RECONNECT_DELAY_MS = parseInt(
    process.env.BASE_RECONNECT_DELAY_MS || "1000",
    10
  );
  const MAX_RECONNECT_DELAY_MS = parseInt(
    process.env.MAX_RECONNECT_DELAY_MS || "30000",
    10
  );

  // Helper function for reconnecting with exponential backoff
  const reconnect = (isError = false) => {
    // Clear any existing timeout
    clearTimeout(timeoutTimer);

    // Close the connection if it's still open
    if (eventSource.readyState !== 2) {
      // 2 = CLOSED
      eventSource.close();
    }

    // Calculate delay with exponential backoff if this is an error
    let delay = RESTART_DELAY_MS;
    if (isError) {
      // Reset reconnect attempts if we've been connected for a while
      if (Date.now() - startTime > 60000) {
        // 1 minute of successful connection
        reconnectAttempt = 0;
      }

      // Increment reconnect attempts
      reconnectAttempt++;

      // Apply exponential backoff with jitter
      if (reconnectAttempt > 1) {
        const backoffDelay = Math.min(
          BASE_RECONNECT_DELAY_MS * Math.pow(1.5, reconnectAttempt - 1),
          MAX_RECONNECT_DELAY_MS
        );
        // Add some randomness (jitter) to prevent synchronized reconnections
        delay = backoffDelay + Math.random() * 1000;
      }

      // Check if we've reached the maximum number of attempts
      if (
        MAX_RECONNECT_ATTEMPTS > 0 &&
        reconnectAttempt > MAX_RECONNECT_ATTEMPTS
      ) {
        console.error(
          `Maximum reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Giving up.`
        );
        process.exit(1);
      }

      console.log(
        `Reconnecting in ${Math.round(
          delay / 1000
        )} seconds... (Attempt ${reconnectAttempt})`
      );
    } else {
      // Reset reconnect attempts for normal restarts
      reconnectAttempt = 0;
    }

    // Schedule reconnection
    setTimeout(() => listenForKeyword(workstationId, reconnectAttempt), delay);
  };
}

// Start listening for the keyword
listenForKeyword(WORKSTATION_ID);
