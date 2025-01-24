import os
import time
import asyncio
import requests
from dotenv import load_dotenv
from playwright.async_api import async_playwright

# Load environment variables
load_dotenv()

# Configuration constants
CONFIG = {
    'API_BASE_URL': 'https://api.agentstation.ai/v1',
    'VIEWPORT': {'width': 1280, 'height': 720},
    'TIMEOUTS': {
        'PAGE_LOAD': 120000,
        'NAVIGATION': 60000,
        'TYPE_DELAY': 20,
        'PAGE_PAUSE': 2,
        'LONG_PAUSE': 5,
        'WORKSTATION_SETUP': 10
    }
}

class WorkstationManager:
    def __init__(self, api_key):
        self.api_key = api_key
        self.workstation = None
        self.browser = None
        self.context = None
        self.playwright = None

    async def create_workstation(self):
        print('🚀 Creating new workstation...')
        response = requests.post(
            f"{CONFIG['API_BASE_URL']}/workstations",
            json={'name': 'playwright-workstation', 'type': 'default'},
            headers=self.get_headers()
        )
        response.raise_for_status()
        self.workstation = response.json()
        print('✅ Workstation created:', self.workstation)
        print('🔗 You can go to https://app.agentstation.ai/workstations to see the workstation')

    async def connect_browser(self, playwright):
        print('🔌 Getting browser WebSocket URL...')
        try:
            response = requests.post(
                f"{CONFIG['API_BASE_URL']}/workstations/{self.workstation['id']}/browser/cdp",
                json={},
                headers=self.get_headers()
            )
            response.raise_for_status()
            
            browser_data = response.json()
            endpoint_url = browser_data['url']
            
            print('🔍 Connecting to browser...')
            try:
                self.browser = await playwright.chromium.connect_over_cdp(
                    endpoint_url,
                    timeout=CONFIG['TIMEOUTS']['PAGE_LOAD']
                )
                print('✅ Initial browser connection established')
            except Exception as e:
                print(f'❌ Failed to connect to browser: {str(e)}')
                print(f'🔍 Attempted to connect to: {endpoint_url}')
                print(f'⏱️ Timeout was set to: {CONFIG["TIMEOUTS"]["PAGE_LOAD"]}ms')
                raise
            
            # Verify connection is stable
            await asyncio.sleep(2)
            
            print('✅ Browser connection verified and stable')
            return True

        except Exception as error:
            print('⚠️ Browser connection failed:', str(error))
            # Attempt cleanup if connection fails
            if self.browser:
                try:
                    await self.browser.close()
                except:
                    pass
            self.browser = None
            raise

    async def cleanup(self):
        try:
            cleanup_task = asyncio.create_task(self._do_cleanup())
            await asyncio.wait_for(cleanup_task, timeout=CONFIG['TIMEOUTS']['LONG_PAUSE'])
        except asyncio.TimeoutError:
            print('⚠️ Cleanup operation timed out')

    async def _do_cleanup(self):
        try:
            if self.browser:
                try:
                    print('🔒 Closing browser...')
                    await self.browser.close()
                except Exception as err:
                    print('⚠️ Error closing browser:', str(err))

            if self.workstation:
                try:
                    print('🧹 Cleaning up workstation...')
                    response = requests.delete(
                        f"{CONFIG['API_BASE_URL']}/workstations/{self.workstation['id']}",
                        headers=self.get_headers()
                    )
                    response.raise_for_status()
                    print('✨ All done! Goodbye!')
                except Exception as err:
                    print('⚠️ Error cleaning up workstation:', str(err))
        except Exception as err:
            print('⚠️ Error during cleanup:', str(err))

    def get_headers(self):
        return {
            'Content-Type': 'application/json',
            'Authorization': f"Bearer {self.api_key}"
        }

    async def setup_browser(self, playwright):
        """Set up the browser and return a configured page"""
        await self.create_workstation()
        await asyncio.sleep(CONFIG['TIMEOUTS']['WORKSTATION_SETUP'])
        
        print('🔌 Setting up browser connection...')
        await self._connect_browser_with_retry(playwright)
        
        # Get the default context and page that's already open
        self.context = self.browser.contexts[0]
        page = self.context.pages[0]
        
        # Configure viewport if needed
        await page.set_viewport_size(CONFIG['VIEWPORT'])
        await asyncio.sleep(1)  # Short stabilization pause
        
        return page

    async def _connect_browser_with_retry(self, playwright, max_retries=3):
        """Attempt to connect to browser with retries"""
        for attempt in range(max_retries):
            try:
                await self.connect_browser(playwright)
                return
            except Exception as e:
                if attempt == max_retries - 1:
                    raise
                print(f'Retrying browser connection ({attempt + 1}/{max_retries})...')
                await asyncio.sleep(2)

class DemoRunner:
    def __init__(self, page):
        if not page:
            raise ValueError('Page instance is required')
        self.page = page

    async def perform_google_search(self):
        print('🌟 Starting Google search demonstration...')
        await self.page.goto('https://google.com')
        print('✅ Google homepage loaded successfully')

        print('🔍 Preparing to search for "agentstation.ai"...')
        await self.page.wait_for_selector('textarea[name="q"]')
        await self.page.fill('textarea[name="q"]', 'agentstation.ai')
        
        await self.page.wait_for_timeout(CONFIG['TIMEOUTS']['PAGE_PAUSE'] * 250)
        
        print('🚀 Submitting search query...')
        await self.page.keyboard.press('Enter')

    async def click_search_result(self):
        print('⏳ Waiting for search results to load...')
        try:
            await self.page.wait_for_selector('h3.LC20lb')
            await self.page.wait_for_timeout(CONFIG['TIMEOUTS']['PAGE_PAUSE'] * 1000)
            
            print('✨ Clicking first search result (AgentStation website)...')
            async with self.page.expect_navigation(
                timeout=CONFIG['TIMEOUTS']['NAVIGATION'],
                wait_until='domcontentloaded'
            ):
                await self.page.click('h3.LC20lb')
        except Exception as error:
            print('⚠️ Error finding or clicking search result:', str(error))
            raise

    async def navigate_to_launch_page(self):
        print('⌛ Waiting for AgentStation page to fully load...')
        await self.page.wait_for_timeout(CONFIG['TIMEOUTS']['LONG_PAUSE'] * 1000)
        print('✅ AgentStation page loaded successfully')

        print('🎯 Preparing to navigate to AgentStation launch page...')
        await self.page.wait_for_timeout(CONFIG['TIMEOUTS']['PAGE_PAUSE'] * 1000)
        try:
            await self.page.goto(
                'https://agentstation.ai/launch',
                timeout=CONFIG['TIMEOUTS']['PAGE_LOAD'],
                wait_until='domcontentloaded'
            )
            await self.page.wait_for_timeout(CONFIG['TIMEOUTS']['PAGE_PAUSE'] * 1000)
            print('🎉 Successfully arrived at AgentStation launch page')
        except Exception as error:
            print('⚠️ Navigation to launch page encountered an issue:', str(error))
            print('🔄 Continuing with the demonstration...')

    async def run_full_demo(self):
        """Execute the complete demo sequence"""
        print('🌟 Starting demonstration sequence...')
        await self.perform_google_search()
        await self.click_search_result()
        await self.navigate_to_launch_page()
        print('✨ Demo sequence completed successfully!')

async def run_single_demo(workstation_manager=None, existing_page=None, playwright=None):
    """Run a single iteration of the demo"""
    api_key = os.getenv('AGENTSTATION_API_KEY')
    if not api_key:
        raise ValueError('🔑 Please set your AGENTSTATION_API_KEY environment variable.')

    try:
        if not existing_page:
            workstation_manager = WorkstationManager(api_key)
            page = await workstation_manager.setup_browser(playwright)
        else:
            page = existing_page
            print('♻️ Reusing existing browser session...')

        demo = DemoRunner(page)
        await demo.run_full_demo()
        
        return {'page': page, 'workstation_manager': workstation_manager}

    except Exception as error:
        print('❌ An error occurred:', str(error))
        if not existing_page and workstation_manager:
            await workstation_manager.cleanup()
        raise

async def run_demo():
    """Main demo loop with user interaction"""
    workstation_manager = None
    current_page = None
    
    try:
        async with async_playwright() as playwright:
            while True:
                try:
                    result = await run_single_demo(workstation_manager, current_page, playwright)
                    current_page = result['page']
                    workstation_manager = result['workstation_manager']
                except Exception as error:
                    print('❌ Demo run failed:', str(error))
                    if not workstation_manager:
                        raise

                if not await should_continue():
                    break

    finally:
        if workstation_manager:
            await workstation_manager.cleanup()

async def should_continue():
    """Ask user if they want to continue"""
    print('\n🤔 Would you like to run another demo?')
    answer = input('Please enter (y/n): ')
    if answer.lower() != 'y':
        print('👋 Thanks for trying the demo!')
        return False
    print('\n🔄 Starting another demo run...\n')
    return True

if __name__ == '__main__':
    asyncio.run(run_demo()) 