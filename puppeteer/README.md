# AgentStation Puppeteer Project

This project demonstrates how to use Puppeteer to connect to an AgentStation Workstation and perform an automated web browsing sequence.

## Setup

You can set up this project either using Devbox (recommended) or traditional installation.

### Option 1: Using Devbox (Recommended)

1. **Install Devbox**
   - Follow the installation instructions at [devbox.sh](https://www.jetpack.io/devbox)

2. **Clone the Repository**
   - Clone this repository to your local machine.

3. **Start Devbox Shell**

   ```bash
   devbox shell
   ```

   This will automatically set up the required Node.js environment.

### Option 2: Traditional Setup

1. **Prerequisites**
   - Ensure Node.js is installed on your system

2. **Navigate to the Puppeteer Directory**
   - Open a terminal and navigate to the `puppeteer` directory.

3. **Install Dependencies**
   - Run `npm install` to install the required dependencies.

4. **Set Up Environment Variables**
   - Set your AgentStation API key as an environment variable:

     ```bash
     export AGENTSTATION_API_KEY=your_api_key
     ```

## Usage

- Run the project using the following command:

  ```bash
  npm start
  ```

- The script will:
  1. Request a new workstation from the AgentStation API
  2. Wait for the workstation to initialize (10 seconds)
  3. Connect to the browser using Puppeteer
  4. Perform the following automated sequence:
     - Navigate to Google
     - Search for "agentstation.ai"
     - Click the first search result
     - Navigate to the AgentStation launch page
  5. Ask if you want to run another demo
  6. Clean up resources when finished

## Features

- Interactive demo that can be run multiple times
- Graceful error handling and resource cleanup
- Configurable timeouts and viewport settings
- Detailed console logging of each step
- Ability to monitor workstation status at [app.agentstation.ai/workstations](https://app.agentstation.ai/workstations)

## Environment Variables

Required environment variables:

- `AGENTSTATION_API_KEY`: Your AgentStation API key

## License

This project is licensed under the MIT License.
