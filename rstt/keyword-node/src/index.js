import { EventSource } from "eventsource";
import https from "https";
import http from "http";
import net from "net";
import tls from "tls";

// Read API key and workstation ID from environment variables
const AGENTSTATION_API_KEY = process.env.AGENTSTATION_API_KEY;
const WORKSTATION_ID = process.env.WORKSTATION_ID;

// Set configurable constants with environment variable fallbacks
const SSE_TIMEOUT_MS = parseInt(process.env.SSE_TIMEOUT_MS || "210000", 10); // 3.5 minutes
const KEYWORD = process.env.KEYWORD || "robot";
const RESTART_DELAY_MS = parseInt(process.env.RESTART_DELAY_MS || "1000", 10);

// Enable verbose logging by default for debugging
if (!process.env.VERBOSE_LOGGING) {
  process.env.VERBOSE_LOGGING = "true";
}

// Add a flag to track the first connection at the module level
let isFirstConnection = true;

// Track if we're currently speaking
let isSpeaking = false;
let activeSpeechSocket = null; // Track the active socket used for speech requests

// Add the long text as a constant at the module level for easy access
const LONG_TEXT =
  "The chat bot joined the meeting and greeted everyone warmly. She listened carefully to the discussion, noting key points and observing the flow of conversation. When her name was mentioned, she responded promptly with insightful input, ensuring her answers were clear and relevant. As the meeting progressed, she detected a moment of silence and took the opportunity to summarize key takeaways. Before leaving, she thanked everyone for their time and assured them she was always available for assistance.";

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

// Function to interrupt the current speech
function interruptSpeech() {
  const wasSpeaking = isSpeaking;
  isSpeaking = false;

  if (wasSpeaking) {
    console.log("🤖 Interrupting speech with RST...");

    // Use the actual speech socket if available
    if (activeSpeechSocket) {
      try {
        console.log("🤖 Sending RST to active speech connection");

        // Enable verbose logging for debugging
        const isVerboseLogging = process.env.VERBOSE_LOGGING === "true";

        if (isVerboseLogging) {
          console.log(`Socket type: ${activeSpeechSocket.constructor.name}`);
          console.log(
            `Socket has resetAndDestroy: ${
              typeof activeSpeechSocket.resetAndDestroy === "function"
                ? "yes"
                : "no"
            }`
          );
        }

        // Since we're using a direct net.Socket now, we can call resetAndDestroy directly
        if (typeof activeSpeechSocket.resetAndDestroy === "function") {
          // Try to set NoDelay to ensure immediate transmission
          activeSpeechSocket.setNoDelay(true);

          // Send RST packet
          const result = activeSpeechSocket.resetAndDestroy();
          console.log(
            `🤖 resetAndDestroy() called with result: ${
              result !== undefined ? result : "undefined"
            }`
          );

          // Keep a reference to the socket
          const socketToDestroy = activeSpeechSocket;

          // Clear the reference so new requests can be made immediately
          activeSpeechSocket = null;

          // Wait a moment to ensure the RST has time to be sent before we completely discard the socket
          console.log("🤖 Waiting briefly for RST packet to be sent...");
          setTimeout(() => {
            console.log("🤖 RST packet should have been transmitted by now");
            // Extra sanity check - fully discard the socket if needed
            if (socketToDestroy && !socketToDestroy.destroyed) {
              console.log("🤖 Ensuring socket is fully destroyed");
              try {
                socketToDestroy.destroy();
              } catch (e) {
                // Ignore any errors during final cleanup
              }
            }
          }, 100); // 100ms pause

          console.log("🤖 Speech interrupt initiated successfully");
          return true;
        } else {
          console.log(
            "🤖 resetAndDestroy not available, using regular destroy"
          );
          activeSpeechSocket.destroy();
          console.log("🤖 Speech interrupted via socket destroy");
          activeSpeechSocket = null;
          return true;
        }
      } catch (error) {
        console.error("🤖 Error interrupting speech:", error.message);
        // If anything goes wrong, still clear the socket reference
        activeSpeechSocket = null;
        return false;
      }
    } else {
      console.log("🤖 No active socket found");
      return false;
    }
  }

  return false;
}

// Function to make a direct TCP request with full control over the socket for RST interruption
function makeTCPRequest(options) {
  const {
    hostname,
    port = 443,
    path,
    method = "POST",
    headers = {},
    body = null,
    useTLS = true,
    onInterrupt = null,
  } = options;

  return new Promise((resolve, reject) => {
    // Create a raw TCP socket
    const socket = new net.Socket();
    let responseData = "";
    let responseHeaders = {};
    let statusCode = null;
    let handleDataAsResponse = false;
    let tlsSocket = null;

    // Store this socket for interruption
    activeSpeechSocket = socket;

    const formatHeaders = () => {
      // Format the headers for the HTTP request
      let formattedHeaders = `${method} ${path} HTTP/1.1\r\n`;
      formattedHeaders += `Host: ${hostname}\r\n`;

      // Add the other headers
      for (const [key, value] of Object.entries(headers)) {
        formattedHeaders += `${key}: ${value}\r\n`;
      }

      // Add Content-Length if we have a body
      const bodyContent = body
        ? typeof body === "string"
          ? body
          : JSON.stringify(body)
        : "";
      const contentLength = Buffer.byteLength(bodyContent);
      formattedHeaders += `Content-Length: ${contentLength}\r\n`;

      // End headers
      formattedHeaders += "\r\n";

      // Add body if present
      if (bodyContent) {
        formattedHeaders += bodyContent;
      }

      return formattedHeaders;
    };

    const parseResponse = (data) => {
      if (!handleDataAsResponse) {
        // First chunk - extract status code and headers
        const responseText = data.toString();
        const lines = responseText.split("\r\n");

        // Extract status from first line "HTTP/1.1 200 OK"
        const statusLine = lines[0];
        const statusMatch = statusLine.match(/HTTP\/\d\.\d\s+(\d+)\s+.*/);
        if (statusMatch) {
          statusCode = parseInt(statusMatch[1], 10);
        }

        // Extract headers
        let headerSection = true;
        let bodyStartIndex = 0;

        for (let i = 1; i < lines.length; i++) {
          const line = lines[i];

          if (line === "") {
            headerSection = false;
            bodyStartIndex = i + 1;
            break;
          }

          if (headerSection) {
            const [key, ...valueParts] = line.split(":");
            const value = valueParts.join(":").trim();
            responseHeaders[key.toLowerCase()] = value;
          }
        }

        // Collect response body from remaining lines
        if (!headerSection && bodyStartIndex < lines.length) {
          responseData = lines.slice(bodyStartIndex).join("\r\n");
        }

        handleDataAsResponse = true;
      } else {
        // Subsequent chunks - just append to the body
        responseData += data.toString();
      }
    };

    socket.on("error", (err) => {
      console.log(`TCP socket error: ${err.code} - ${err.message}`);
      // Handle error, but if it's ECONNRESET and we have interruption enabled, don't treat as error
      if (err.code === "ECONNRESET" && onInterrupt) {
        console.log(
          "Detected TCP connection reset - this is expected during interruption"
        );
        onInterrupt();
        resolve({ interrupted: true });
      } else {
        reject(err);
      }
    });

    // For secure connections (HTTPS)
    if (useTLS) {
      socket.connect(port, hostname, () => {
        console.log(
          `TCP socket connected to ${hostname}:${port}, upgrading to TLS`
        );

        // Once connected, upgrade to TLS
        tlsSocket = tls.connect({
          socket: socket,
          servername: hostname,
          rejectUnauthorized: true,
        });

        // Important: after TLS upgrade, we need to track the TLS socket too
        // This ensures we have access to the underlying socket for proper interruption
        tlsSocket._tcpSocket = socket;

        // Store both sockets for interruption - the raw one has resetAndDestroy
        activeSpeechSocket = socket;

        // Now work with the TLS socket
        tlsSocket.on("error", (err) => {
          console.log(`TLS socket error: ${err.message}`);
          if (err.code === "ECONNRESET" && onInterrupt) {
            onInterrupt();
            resolve({ interrupted: true });
          } else {
            reject(err);
          }
        });

        tlsSocket.on("data", (data) => {
          parseResponse(data);
        });

        tlsSocket.on("end", () => {
          console.log("TLS connection ended normally");
          resolve({
            statusCode,
            headers: responseHeaders,
            data: responseData,
          });
        });

        // Send the HTTP request
        tlsSocket.write(formatHeaders());
      });
    }
    // For regular HTTP
    else {
      socket.connect(port, hostname, () => {
        socket.on("data", (data) => {
          parseResponse(data);
        });

        socket.on("end", () => {
          resolve({
            statusCode,
            headers: responseHeaders,
            data: responseData,
          });
        });

        // Send the HTTP request
        socket.write(formatHeaders());
      });
    }
  });
}

/**
 * Makes an HTTP request with the option to interrupt it with RST packets (legacy version)
 * @param {Object} options Request options
 * @param {boolean} options.enableRSTInterruption Whether this request can be interrupted with RST
 * @returns {Promise} A promise that resolves with the response
 */
function makeInterruptibleRequest(options) {
  const {
    protocol = "https:",
    hostname,
    port = protocol === "https:" ? 443 : 80,
    path,
    method = "GET",
    headers = {},
    body = null,
    enableRSTInterruption = false,
    onInterrupt = null,
  } = options;

  // If we're asking for RST interruption, use the direct TCP method
  if (enableRSTInterruption) {
    return makeTCPRequest({
      hostname,
      port,
      path,
      method,
      headers,
      body,
      useTLS: protocol === "https:",
      onInterrupt,
    });
  }

  // Otherwise use the standard HTTP/HTTPS module
  return new Promise((resolve, reject) => {
    const requestModule = protocol === "https:" ? https : http;

    const requestOptions = {
      hostname,
      port,
      path,
      method,
      headers,
    };

    const req = requestModule.request(requestOptions, (res) => {
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data,
        });
      });
    });

    req.on("error", (error) => {
      reject(error);
    });

    // Send the body if provided
    if (body) {
      req.write(typeof body === "string" ? body : JSON.stringify(body));
    }

    req.end();
  });
}

// Function to speak text via the Agent Station API
async function speakText(text, workstationId, languageCode = "en-US") {
  // Interrupt any ongoing speech - but don't wait, to avoid timing issues
  if (isSpeaking) {
    interruptSpeech();
  }

  // Reset state before starting new speech
  isSpeaking = true;

  console.log(
    `🤖 🔊 Speaking: "${text.substring(0, 50)}${text.length > 50 ? "..." : ""}"`
  );

  try {
    const response = await makeInterruptibleRequest({
      protocol: "https:",
      hostname: "api.agentstation.ai",
      path: `/v1/workstations/${workstationId}/audio/speak`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${AGENTSTATION_API_KEY}`,
      },
      body: {
        text: text,
        language_code: languageCode,
      },
      enableRSTInterruption: true,
      onInterrupt: () => {
        console.log("🤖 Speech was interrupted intentionally");
        isSpeaking = false;
      },
    });

    if (response.interrupted) {
      console.log("🤖 Speech was interrupted");
    } else {
      console.log(`🔗 Speech request status: ${response.statusCode}`);
      console.log("🤖 🔊 Speech completed");
    }

    // Ensure we reset the isSpeaking state
    isSpeaking = false;
    // Clear the socket reference since we're done with it
    activeSpeechSocket = null;
    return response;
  } catch (error) {
    console.error("Error in speakText:", error);
    // Ensure we reset the state even on error
    isSpeaking = false;
    // Clear the socket reference on error too
    activeSpeechSocket = null;
    throw error;
  }
}

// Update the placeholder speak function to use the new speakText function
function speak(message) {
  // Still log the message
  console.log(message);
  // Now actually speak it
  return speakText(message, WORKSTATION_ID);
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

      // If the transcript contains the keyword, highlight it and take action based on current state
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

        // Check if we're currently speaking
        console.log(
          `Current speaking state: ${isSpeaking ? "SPEAKING" : "NOT SPEAKING"}`
        );

        if (isSpeaking) {
          // If speaking, interrupt the speech but keep transcription running
          console.log("🤖 Keyword detected during speech - interrupting");
          interruptSpeech();
          // Give a brief moment before allowing the next keyword detection
          // This helps prevent immediate re-triggering
          setTimeout(() => {
            console.log("🤖 Now ready to detect keywords again");
          }, 500);
        } else {
          // If not speaking, start speaking the long text
          console.log("🤖 Keyword detected - starting speech");
          speakText(LONG_TEXT, WORKSTATION_ID)
            .then(() => {
              console.log(
                "🤖 Speech completed normally - ready for next keyword"
              );
            })
            .catch((err) => {
              // Only log non-interruption errors
              if (
                err.code !== "ECONNRESET" &&
                err.message !== "Speech interrupted"
              ) {
                console.error("🤖 Error during speech:", err.message);
              }
              // Make sure we're ready for the next cycle
              console.log(
                "🤖 Speech ended (interrupted or error) - ready for next keyword"
              );
            });
        }

        // Set the flag to indicate keyword was detected
        keywordDetected = true;
        // Reset consecutive detection flag
        consecutiveKeywordDetection = false;
      } else {
        // Reset consecutive detection flag if no keyword was detected
        consecutiveKeywordDetection = false;
      }
    } catch (error) {
      console.error("Error processing final transcript:", error.message);
      console.error(error.stack); // Add stack trace for better debugging
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

// Keep the keyboard shortcut for manual speech interruption
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on("data", (key) => {
  // Ctrl+C exits the program
  if (key.toString() === "\u0003") {
    process.exit();
  }

  // Spacebar interrupts speech
  if (key.toString() === " ") {
    if (interruptSpeech()) {
      console.log("Speech interrupted by user");
    } else {
      console.log("No active speech to interrupt");
    }
  }

  // 's' key starts speaking the long text (for testing)
  if (key.toString().toLowerCase() === "s") {
    console.log("🤖 Starting to speak long text (triggered by 's' key)");
    speakText(LONG_TEXT, WORKSTATION_ID).catch((err) => {
      // Only log non-interruption errors
      if (err.code !== "ECONNRESET") {
        console.error("🤖 Error during speech:", err.message);
      }
    });
  }
});
console.log(
  "Press SPACE to interrupt speech, 'S' to start speaking, Ctrl+C to exit"
);
