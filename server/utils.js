import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { platform } from 'os';

export async function findChrome() {
  const os = platform();
  let chromePaths = [];

  if (os === 'win32') {
    chromePaths = [
      process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
      process.env.PROGRAMFILES + '\\Google\\Chrome\\Application\\chrome.exe',
      process.env['PROGRAMFILES(X86)'] + '\\Google\\Chrome\\Application\\chrome.exe',
      process.env.LOCALAPPDATA + '\\Chromium\\Application\\chrome.exe',
      process.env.PROGRAMFILES + '\\Chromium\\Application\\chrome.exe',
      process.env['PROGRAMFILES(X86)'] + '\\Chromium\\Application\\chrome.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
    ];
  } else if (os === 'darwin') {
    chromePaths = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      process.env.HOME + '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      process.env.HOME + '/Applications/Chromium.app/Contents/MacOS/Chromium'
    ];
  } else {
    chromePaths = [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
      '/usr/local/bin/chrome',
      '/usr/local/bin/chromium'
    ];
    
    try {
      const whichChrome = execSync('which google-chrome-stable 2>/dev/null || which google-chrome 2>/dev/null || which chromium-browser 2>/dev/null || which chromium 2>/dev/null', { encoding: 'utf8' }).trim();
      if (whichChrome) {
        chromePaths.unshift(whichChrome);
      }
    } catch (e) {
      // ignore
    }
  }

  for (const path of chromePaths) {
    if (path && existsSync(path)) {
      return path;
    }
  }

  throw new Error(`Chrome not found. Please install Google Chrome or Chromium browser. Searched paths: ${chromePaths.join(', ')}`);
}
