import axios from 'axios';
import puppeteer, { Browser, Page } from 'puppeteer';
import { createInterface } from 'readline';

// Configuration constants
const CONFIG = {
  API_BASE_URL: 'https://api.agentstation.ai/v1',
  VIEWPORT: { width: 1280, height: 720 },
  TIMEOUTS: {
    PAGE_LOAD: 120000,
    NAVIGATION: 60000,
    TYPE_DELAY: 60,
    PAGE_PAUSE: 2000,
    LONG_PAUSE: 5000,
    WORKSTATION_SETUP: 10000
  }
};

class WorkstationManager {
  private apiKey: string;
  private workstation: any;
  private browser: Browser | null;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.workstation = null;
    this.browser = null;
  }

  async createWorkstation(): Promise<void> {
    console.log('🚀 Creating new workstation...');
    const response = await axios.post(
      `${CONFIG.API_BASE_URL}/workstations`,
      { name: 'puppeteer-workstation', type: 'default' },
      { headers: this.getHeaders() }
    );
    this.workstation = response.data;
    console.log('✅ Workstation created:', this.workstation);
    console.log('🔗 You can go to https://app.agentstation.ai/workstations to see the workstation');
  }

  async connectBrowser(): Promise<void> {
    console.log('🔌 Getting browser WebSocket URL...');
    try {
      const response = await axios.post(
        `${CONFIG.API_BASE_URL}/workstations/${this.workstation.id}/browser/cdp`,
        {},
        { headers: this.getHeaders() }
      );
      
      this.browser = await puppeteer.connect({
        browserURL: (response.data as {url: string}).url,
        defaultViewport: CONFIG.VIEWPORT
      });
    } catch (error) {
      console.error('⚠️ Failed to connect to browser:', error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  async cleanup(): Promise<void> {
    const cleanupTimeout = setTimeout(() => {
      console.warn('⚠️ Cleanup operation timed out');
    }, CONFIG.TIMEOUTS.LONG_PAUSE);
    
    try {
      if (this.browser) {
        try {
          console.log('🔒 Closing browser...');
          await this.browser.close();
        } catch (err) {
          console.error('⚠️ Error closing browser:', err instanceof Error ? err.message : 'Unknown error');
        }
      }

      if (this.workstation) {
        try {
          console.log('🧹 Cleaning up workstation...');
          await axios.delete(
            `${CONFIG.API_BASE_URL}/workstations/${this.workstation.id}`,
            { headers: this.getHeaders() }
          );
          console.log('✨ All done! Goodbye!');
        } catch (err) {
          console.error('⚠️ Error cleaning up workstation:', err instanceof Error ? err.message : 'Unknown error');
        }
      }
    } finally {
      clearTimeout(cleanupTimeout);
    }
  }

  getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`
    };
  }

  getBrowser(): Browser | null {
    return this.browser;
  }
}

class DemoRunner {
  private page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async performGoogleSearch(): Promise<void> {
    console.log('🌟 Starting Google search demonstration...');
    await this.page.reload({ waitUntil: 'load' });
    await this.page.goto('https://google.com');
    try {
      await this.page.waitForNavigation({ waitUntil: 'load' });
      console.log('✅ Google homepage loaded successfully');
    } catch (error) {
      console.log('⚠️ Navigation timeout, but continuing...');
    }

    console.log('🔍 Preparing to search for "agentstation.ai"...');
    await this.page.waitForSelector('textarea[name="q"]');
    await new Promise(r => setTimeout(r, CONFIG.TIMEOUTS.PAGE_PAUSE));
    await this.page.type('textarea[name="q"]', 'agentstation.ai', { delay: CONFIG.TIMEOUTS.TYPE_DELAY });
    await new Promise(r => setTimeout(r, CONFIG.TIMEOUTS.PAGE_PAUSE));
    
    console.log('🚀 Submitting search query...');
    await this.page.keyboard.press('Enter');
  }

  async clickSearchResult(): Promise<void> {
    console.log('⏳ Waiting for search results to load...');
    try {
      await this.page.waitForSelector('h3.LC20lb');
      await new Promise(r => setTimeout(r, CONFIG.TIMEOUTS.PAGE_PAUSE));
      
      console.log('✨ Clicking first search result (AgentStation website)...');
      await Promise.all([
        this.page.waitForNavigation({ 
          timeout: CONFIG.TIMEOUTS.NAVIGATION, 
          waitUntil: 'domcontentloaded',
        }),
        this.page.click('h3.LC20lb')
      ]);
    } catch (error) {
      console.error('⚠️ Error finding or clicking search result:', error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  async navigateToLaunchPage(): Promise<void> {
    console.log('⌛ Waiting for AgentStation page to fully load...');
    await new Promise(r => setTimeout(r, CONFIG.TIMEOUTS.LONG_PAUSE));
    console.log('✅ AgentStation page loaded successfully');

    console.log('🎯 Preparing to navigate to AgentStation launch page...');
    await new Promise(r => setTimeout(r, CONFIG.TIMEOUTS.PAGE_PAUSE));
    try {
      await this.page.goto('https://agentstation.ai/launch', {
        timeout: CONFIG.TIMEOUTS.PAGE_LOAD,
        waitUntil: 'domcontentloaded'
      });
      await new Promise(r => setTimeout(r, CONFIG.TIMEOUTS.PAGE_PAUSE));
      console.log('🎉 Successfully arrived at AgentStation launch page');
    } catch (error) {
      console.log('⚠️ Navigation to launch page encountered an issue:', error instanceof Error ? error.message : 'Unknown error');
      console.log('🔄 Continuing with the demonstration...');
    }
  }
}

async function main(existingWorkstation: WorkstationManager | null = null, existingPage: Page | null = null): Promise<{ page: Page; workstationManager: WorkstationManager }> {
  const apiKey = process.env.AGENTSTATION_API_KEY;
  
  if (!apiKey) {
    throw new Error('🔑 Please set your AGENTSTATION_API_KEY environment variable.');
  }

  let workstationManager = existingWorkstation || new WorkstationManager(apiKey);
  let page = existingPage;

  try {
    if (!existingPage) {
      console.log('🚀 Starting new demo session...');
      await workstationManager.createWorkstation();
      console.log('🕒 Waiting for 10 seconds...');
      await new Promise(resolve => setTimeout(resolve, 10000));
      
      await workstationManager.connectBrowser();
      console.log('📱 Opening new browser page...');
      const browser = workstationManager.getBrowser();
      if (!browser) throw new Error('Browser not initialized');
      page = await browser.newPage();
    } else {
      console.log('♻️ Reusing existing browser session...');
    }

    if (!page) throw new Error('Page not initialized');
    const demo = new DemoRunner(page);
    await demo.performGoogleSearch();
    await demo.clickSearchResult();
    await demo.navigateToLaunchPage();

    console.log('✨ Demo run completed successfully!');
    return { page, workstationManager };
  } catch (error) {
    console.error('❌ An error occurred:', error instanceof Error ? error.message : 'Unknown error');
    // If we failed during setup, clean up any partial resources
    if (!existingWorkstation) {
      console.log('🧹 Cleaning up partial resources...');
      await workstationManager?.cleanup();
    }
    throw error;
  }
}

async function runDemo(): Promise<void> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  let workstationManager: WorkstationManager | null = null;
  let currentPage: Page | null = null;

  try {
    while (true) {
      try {
        const result = await main(workstationManager, currentPage);
        currentPage = result.page;
        workstationManager = result.workstationManager;
      } catch (error) {
        console.error('❌ Demo run failed:', error instanceof Error ? error.message : 'Unknown error');
        if (!workstationManager) {
          console.error('💥 Fatal error occurred!');
          throw error;
        }
      }

      console.log('\n🤔 Would you like to run another demo?');
      const answer = await new Promise<string>(resolve => {
        readline.question('Please enter (y/n): ', resolve);
      });

      if (answer.toLowerCase() !== 'y') {
        console.log('👋 Thanks for trying the demo!');
        break;
      }
      console.log('\n🔄 Starting another demo run...\n');
    }
  } finally {
    readline.close();
    if (workstationManager) {
      console.log('🧹 Cleaning up resources...');
      await workstationManager?.cleanup();
    }
  }
}

runDemo().catch(console.error); 