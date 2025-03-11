import { EventSource } from "eventsource";
import net from "net";
import https from "https";
import tls from "tls";

// Read API key and workstation ID from environment variables
const AGENTSTATION_API_KEY = process.env.AGENTSTATION_API_KEY;
const WORKSTATION_ID = process.env.WORKSTATION_ID;

// Set configurable constants with environment variable fallbacks
const SSE_TIMEOUT_MS = parseInt(process.env.SSE_TIMEOUT_MS || "210000", 10); // 3.5 minutes
const KEYWORD = process.env.KEYWORD || "robot";
const RESTART_DELAY_MS = parseInt(process.env.RESTART_DELAY_MS || "1000", 10);

// Add a flag to track the first connection at the module level
let isFirstConnection = true;

// Track if we're currently speaking
let isSpeaking = false;

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

/**
 * RST Interrupt Utility - A collection of methods for sending RST packets to interrupt TCP connections
 */
class RSTInterruptUtility {
  /**
   * Create a new socket and send an RST packet to the specified host and port
   * @param {Object} options Configuration options
   * @param {string} options.host Target host
   * @param {number} options.port Target port
   * @param {string} options.path Request path
   * @param {Object} options.headers HTTP headers to include
   * @param {string} options.method HTTP method
   * @param {string} options.body Request body
   * @param {boolean} options.useTLS Whether to use TLS/SSL
   * @param {Function} options.onSuccess Callback when RST is sent successfully
   * @param {Function} options.onError Callback when an error occurs
   * @returns {boolean} Whether the interrupt was initiated
   */
  static sendRSTPacket({
    host = "api.agentstation.ai",
    port = 443,
    path = "/",
    headers = {},
    method = "POST",
    body = "{}",
    useTLS = true,
    onSuccess = null,
    onError = null,
  } = {}) {
    // Simplified logging - just a single log when starting
    const isVerboseLogging = process.env.VERBOSE_LOGGING === "true";

    try {
      // Create a new TCP socket for each request (no reuse)
      const socket = new net.Socket();

      // Set up error handling
      socket.on("error", (err) => {
        if (isVerboseLogging) {
          console.log(`RST socket error (expected): ${err.message}`);
        }
        if (onError) onError(err);
      });

      // Connect to the server
      socket.connect(port, host, () => {
        if (isVerboseLogging) {
          console.log(`RST interrupt: Connected to ${host}:${port}`);
        }

        // If TLS is requested, upgrade the connection
        if (useTLS) {
          const tlsOptions = {
            socket: socket,
            servername: host,
            rejectUnauthorized: true,
          };

          const tlsSocket = tls.connect(tlsOptions, () => {
            if (isVerboseLogging) {
              console.log(
                "RST interrupt: TLS connection established, sending request..."
              );
            }

            // Prepare headers
            const headerLines = Object.entries(headers)
              .map(([key, value]) => `${key}: ${value}`)
              .join("\r\n");

            // Format the request
            const request =
              `${method} ${path} HTTP/1.1\r\n` +
              `Host: ${host}\r\n` +
              headerLines +
              (headerLines ? "\r\n" : "") +
              `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n` +
              body;

            tlsSocket.write(request, () => {
              if (isVerboseLogging) {
                console.log(
                  "RST interrupt: Request sent, executing resetAndDestroy..."
                );
              }

              // Increase the delay to ensure the request is fully processed
              setTimeout(() => {
                try {
                  // Always use resetAndDestroy on the raw TCP socket
                  if (typeof socket.resetAndDestroy === "function") {
                    // Only log in verbose mode
                    if (isVerboseLogging) {
                      console.log("Executing resetAndDestroy() on socket");
                    }

                    // Try to force socket to flush data before destroying
                    socket.setNoDelay(true);

                    // Call resetAndDestroy and capture result
                    const result = socket.resetAndDestroy();

                    if (isVerboseLogging) {
                      console.log(
                        `resetAndDestroy() called, result: ${
                          result !== undefined ? result : "undefined"
                        }`
                      );
                    }

                    if (onSuccess) onSuccess();
                  } else {
                    if (isVerboseLogging) {
                      console.log(
                        "RST interrupt: resetAndDestroy() not available, using alternative..."
                      );
                    }
                    socket.destroy(new Error("Force close"));
                    if (onSuccess) onSuccess();
                  }
                } catch (err) {
                  console.error(`RST interrupt failed: ${err.message}`);
                  if (onError) onError(err);
                }
              }, 100); // Increased to 100ms from 10ms to ensure request is fully sent
            });
          });

          tlsSocket.on("error", (err) => {
            if (isVerboseLogging) {
              console.log(
                `TLS socket error (expected after RST): ${err.message}`
              );
            }
          });
        }
        // For non-TLS connections, send the request directly
        else {
          // Prepare headers
          const headerLines = Object.entries(headers)
            .map(([key, value]) => `${key}: ${value}`)
            .join("\r\n");

          // Format the request
          const request =
            `${method} ${path} HTTP/1.1\r\n` +
            `Host: ${host}\r\n` +
            headerLines +
            (headerLines ? "\r\n" : "") +
            `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n` +
            body;

          socket.write(request, () => {
            if (isVerboseLogging) {
              console.log(
                "RST interrupt: Request sent, executing resetAndDestroy..."
              );
            }

            // Increased delay for non-TLS case as well
            setTimeout(() => {
              try {
                if (typeof socket.resetAndDestroy === "function") {
                  // Only log in verbose mode
                  if (isVerboseLogging) {
                    console.log("Executing resetAndDestroy() on socket");
                  }

                  // Try to force socket to flush data before destroying
                  socket.setNoDelay(true);

                  // Call resetAndDestroy and capture result
                  const result = socket.resetAndDestroy();

                  if (isVerboseLogging) {
                    console.log(
                      `resetAndDestroy() called, result: ${
                        result !== undefined ? result : "undefined"
                      }`
                    );
                  }

                  if (onSuccess) onSuccess();
                } else {
                  if (isVerboseLogging) {
                    console.log(
                      "RST interrupt: resetAndDestroy() not available, using alternative..."
                    );
                  }
                  socket.destroy(new Error("Force close"));
                  if (onSuccess) onSuccess();
                }
              } catch (err) {
                console.error(`RST interrupt failed: ${err.message}`);
                if (onError) onError(err);
              }
            }, 100); // Increased to 100ms from 10ms to ensure request is fully sent
          });
        }
      });

      return true;
    } catch (error) {
      console.error(`Error initiating RST interrupt: ${error.message}`);
      if (onError) onError(error);
      return false;
    }
  }

  /**
   * Interrupt a speech stream on the Agent Station API
   * @param {string} workstationId The workstation ID
   * @param {string} apiKey The API key for authentication
   * @returns {boolean} Whether the interruption was initiated
   */
  static interruptSpeech(workstationId, apiKey) {
    // Make fewer attempts but with better timing
    const attemptCount = 2; // Reduce to 2 attempts to minimize noise
    let success = false;
    const isVerboseLogging = process.env.VERBOSE_LOGGING === "true";

    // Send first RST packet immediately
    success = this.sendRSTPacket({
      host: "api.agentstation.ai",
      port: 443,
      path: `/v1/workstations/${workstationId}/audio/speak`,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Connection: "close", // Add connection close header
      },
      method: "POST",
      body: '{"text":"interrupt"}',
      useTLS: true,
      onSuccess: () => {
        console.log("🤖 Speech interrupted successfully via RST");
        // Reset state after successful interrupt
        isSpeaking = false;
      },
      onError: (err) => {
        console.error("🤖 RST interrupt failed, but continuing: ", err.message);
        // Reset state even after failure to allow retrying
        isSpeaking = false;
      },
    });

    // Send additional attempt with longer delay
    if (attemptCount > 1) {
      setTimeout(() => {
        if (isVerboseLogging) {
          console.log("Sending backup RST packet...");
        }

        this.sendRSTPacket({
          host: "api.agentstation.ai",
          port: 443,
          path: `/v1/workstations/${workstationId}/audio/speak`,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            Connection: "close", // Add connection close header
          },
          method: "POST",
          body: '{"text":"interrupt"}',
          useTLS: true,
          // Don't log success for backup attempts to avoid confusion
          onSuccess: () => {
            if (isVerboseLogging) {
              console.log("Backup RST packet sent successfully");
            }
            isSpeaking = false;
          },
          onError: (err) => {
            if (isVerboseLogging) {
              console.log("Backup RST packet failed: " + err.message);
            }
            isSpeaking = false;
          },
        });
      }, 200); // Increased delay to 200ms for better separation
    }

    return success;
  }
}

// Function to interrupt the current speech
function interruptSpeech() {
  // Reset the speaking state immediately to allow for multiple interrupts
  const wasSpeaking = isSpeaking;
  isSpeaking = false;

  if (wasSpeaking) {
    console.log("🤖 Interrupting speech with RST...");

    // We don't need to store the return value anymore since we already reset the state
    RSTInterruptUtility.interruptSpeech(WORKSTATION_ID, AGENTSTATION_API_KEY);

    return true;
  }

  return false;
}

/**
 * Makes an HTTP request with the option to interrupt it with RST packets
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

  return new Promise((resolve, reject) => {
    const requestModule = protocol === "https:" ? https : require("http");

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
      // Don't treat ECONNRESET as an error if we're enabling RST interruption
      if (
        enableRSTInterruption &&
        (error.code === "ECONNRESET" ||
          error.message.includes("Socket forcibly closed"))
      ) {
        if (onInterrupt) onInterrupt();
        resolve({ interrupted: true });
      } else {
        reject(error);
      }
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

    // Ensure state is reset
    isSpeaking = false;
    return response;
  } catch (error) {
    console.error("Error in speech request:", error.message);
    // Ensure state is reset even in case of errors
    isSpeaking = false;
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
