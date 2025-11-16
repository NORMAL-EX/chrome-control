#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import puppeteer from "puppeteer-core";
import sharp from "sharp";
import { z } from "zod";
import { findChrome } from "./utils.js";

const LaunchBrowserSchema = z.object({
  headless: z.boolean().optional().default(false).describe("Run browser in headless mode"),
  width: z.number().int().min(100).max(7680).optional().default(1280).describe("Browser window width"),
  height: z.number().int().min(100).max(4320).optional().default(720).describe("Browser window height")
});

const NavigateSchema = z.object({
  url: z.string().url().describe("URL to navigate to"),
  wait_until: z.enum(["load", "domcontentloaded", "networkidle0", "networkidle2"]).optional().default("load").describe("When to consider navigation finished")
});

const ClickSchema = z.object({
  selector: z.string().min(1).describe("CSS selector of element to click"),
  wait_for_selector: z.boolean().optional().default(true).describe("Wait for selector before clicking"),
  timeout: z.number().int().min(0).max(120000).optional().default(30000).describe("Timeout in milliseconds")
});

const TypeTextSchema = z.object({
  selector: z.string().min(1).describe("CSS selector of input element"),
  text: z.string().describe("Text to type"),
  clear_first: z.boolean().optional().default(false).describe("Clear existing text before typing"),
  delay: z.number().int().min(0).max(1000).optional().default(0).describe("Delay between key presses in milliseconds")
});

const GetContentSchema = z.object({
  selector: z.string().optional().describe("CSS selector to get content from (if not provided, gets full page text)"),
  attribute: z.string().optional().describe("Get attribute value instead of text content")
});

const ScreenshotSchema = z.object({
  full_page: z.boolean().optional().default(false).describe("Capture full scrollable page"),
  selector: z.string().optional().describe("CSS selector to screenshot specific element"),
  format: z.enum(["png", "jpeg"]).optional().default("jpeg").describe("Image format"),
  quality: z.number().int().min(1).max(100).optional().default(60).describe("JPEG quality (1-100, lower = smaller file)"),
  max_width: z.number().int().min(100).max(2560).optional().default(1280).describe("Maximum image width in pixels"),
  max_height: z.number().int().min(100).max(1440).optional().default(1440).describe("Maximum image height in pixels")
});

const ExecuteScriptSchema = z.object({
  script: z.string().min(1).describe("JavaScript code to execute in page context"),
  args: z.array(z.any()).optional().default([]).describe("Arguments to pass to the script")
});

const WaitForSelectorSchema = z.object({
  selector: z.string().min(1).describe("CSS selector to wait for"),
  visible: z.boolean().optional().default(false).describe("Wait for element to be visible"),
  timeout: z.number().int().min(0).max(120000).optional().default(30000).describe("Timeout in milliseconds")
});

const GetElementsSchema = z.object({
  selector: z.string().min(1).describe("CSS selector to query elements"),
  attributes: z.array(z.string()).optional().describe("Attributes to extract from elements")
});

const ScrollSchema = z.object({
  x: z.number().int().optional().default(0).describe("Horizontal scroll position"),
  y: z.number().int().optional().default(0).describe("Vertical scroll position"),
  selector: z.string().optional().describe("Scroll to specific element")
});

const PressKeySchema = z.object({
  key: z.string().min(1).describe("Key to press (e.g., 'Enter', 'Tab', 'Escape')"),
  delay: z.number().int().min(0).max(1000).optional().default(0).describe("Delay before releasing key in milliseconds")
});

const GoBackSchema = z.object({
  wait_until: z.enum(["load", "domcontentloaded", "networkidle0", "networkidle2"]).optional().default("load").describe("When to consider navigation finished")
});

const GoForwardSchema = z.object({
  wait_until: z.enum(["load", "domcontentloaded", "networkidle0", "networkidle2"]).optional().default("load").describe("When to consider navigation finished")
});

const ReloadSchema = z.object({
  wait_until: z.enum(["load", "domcontentloaded", "networkidle0", "networkidle2"]).optional().default("load").describe("When to consider navigation finished")
});

const SetViewportSchema = z.object({
  width: z.number().int().min(100).max(7680).describe("Viewport width"),
  height: z.number().int().min(100).max(4320).describe("Viewport height"),
  device_scale_factor: z.number().min(0.1).max(10).optional().default(1).describe("Device scale factor")
});

const GetCookiesSchema = z.object({
  urls: z.array(z.string().url()).optional().describe("URLs to get cookies for (all if not specified)")
});

const SetCookieSchema = z.object({
  name: z.string().min(1).describe("Cookie name"),
  value: z.string().describe("Cookie value"),
  url: z.string().url().optional().describe("Cookie URL"),
  domain: z.string().optional().describe("Cookie domain"),
  path: z.string().optional().describe("Cookie path"),
  expires: z.number().optional().describe("Cookie expiration timestamp"),
  http_only: z.boolean().optional().describe("HTTP only flag"),
  secure: z.boolean().optional().describe("Secure flag"),
  same_site: z.enum(["Strict", "Lax", "None"]).optional().describe("SameSite attribute")
});

const WaitForNavigationSchema = z.object({
  timeout: z.number().int().min(0).max(120000).optional().default(30000).describe("Timeout in milliseconds"),
  wait_until: z.enum(["load", "domcontentloaded", "networkidle0", "networkidle2"]).optional().default("load").describe("When to consider navigation finished")
});

async function compressImageToFit(base64Data, format, quality, maxWidth, maxHeight, maxSizeBytes = 950000) {
  const imgBuffer = Buffer.from(base64Data, 'base64');
  
  let image = sharp(imgBuffer);
  const metadata = await image.metadata();
  
  let currentWidth = metadata.width;
  let currentHeight = metadata.height;
  
  if (currentWidth > maxWidth || currentHeight > maxHeight) {
    const aspectRatio = currentWidth / currentHeight;
    if (currentWidth > maxWidth) {
      currentWidth = maxWidth;
      currentHeight = Math.round(maxWidth / aspectRatio);
    }
    if (currentHeight > maxHeight) {
      currentHeight = maxHeight;
      currentWidth = Math.round(maxHeight * aspectRatio);
    }
    image = image.resize(currentWidth, currentHeight, { fit: 'inside' });
  }
  
  let currentQuality = quality;
  let compressedBuffer;
  let iterations = 0;
  const maxIterations = 10;
  
  while (iterations < maxIterations) {
    if (format === 'jpeg') {
      compressedBuffer = await image.jpeg({ quality: currentQuality }).toBuffer();
    } else {
      compressedBuffer = await image.png({ compressionLevel: 9 }).toBuffer();
    }
    
    if (compressedBuffer.length <= maxSizeBytes || currentQuality <= 10) {
      break;
    }
    
    if (format === 'jpeg') {
      currentQuality = Math.max(10, Math.floor(currentQuality * 0.8));
      image = sharp(imgBuffer).resize(currentWidth, currentHeight, { fit: 'inside' });
    } else {
      currentWidth = Math.floor(currentWidth * 0.9);
      currentHeight = Math.floor(currentHeight * 0.9);
      image = sharp(imgBuffer).resize(currentWidth, currentHeight, { fit: 'inside' });
    }
    
    iterations++;
  }
  
  return {
    buffer: compressedBuffer,
    base64: compressedBuffer.toString('base64'),
    size: compressedBuffer.length,
    width: currentWidth,
    height: currentHeight,
    finalQuality: currentQuality
  };
}

class BrowserManager {
  constructor() {
    this.browser = null;
    this.page = null;
    this.chromePath = null;
  }

  async initialize() {
    if (!this.chromePath) {
      this.chromePath = await findChrome();
    }
  }

  async ensureBrowser(headless = false, width = 1280, height = 720) {
    if (!this.browser || !this.browser.isConnected()) {
      await this.initialize();
      this.browser = await puppeteer.launch({
        executablePath: this.chromePath,
        headless: headless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process',
          `--window-size=${width},${height}`
        ],
        defaultViewport: {
          width: width,
          height: height
        }
      });
      
      // 拦截新标签页和弹窗
      this.browser.on('targetcreated', async (target) => {
        if (target.type() === 'page') {
          const newPage = await target.page();
          if (newPage && newPage !== this.page) {
            const url = newPage.url();
            // 如果新标签页有URL，在当前页面打开它
            if (url && url !== 'about:blank') {
              await this.page.goto(url);
            }
            // 关闭新标签页
            await newPage.close();
          }
        }
      });
    }
    
    if (!this.page || this.page.isClosed()) {
      const pages = await this.browser.pages();
      if (pages.length > 0) {
        this.page = pages[0];
      } else {
        this.page = await this.browser.newPage();
      }
      await this.page.setViewport({ width: width, height: height });
      
      // 在页面上下文中拦截window.open
      await this.page.evaluateOnNewDocument(() => {
        window.open = function(url, target, features) {
          if (url) {
            window.location.href = url;
          }
          return window;
        };
      });
    }
    
    return { browser: this.browser, page: this.page };
  }

  async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }

  getBrowser() {
    return this.browser;
  }

  getPage() {
    return this.page;
  }
}

const browserManager = new BrowserManager();

const server = new Server({
  name: "chrome-control-mcp",
  version: "1.0.0"
}, {
  capabilities: {
    tools: {}
  }
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "chrome_launch",
        description: "Launch Chrome browser. This must be called before any other browser operations.",
        inputSchema: {
          type: "object",
          properties: {
            headless: {
              type: "boolean",
              description: "Run browser in headless mode",
              default: false
            },
            width: {
              type: "integer",
              description: "Browser window width",
              minimum: 100,
              maximum: 7680,
              default: 1280
            },
            height: {
              type: "integer",
              description: "Browser window height",
              minimum: 100,
              maximum: 4320,
              default: 720
            }
          }
        }
      },
      {
        name: "chrome_navigate",
        description: "Navigate to a URL in the browser",
        inputSchema: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "URL to navigate to"
            },
            wait_until: {
              type: "string",
              enum: ["load", "domcontentloaded", "networkidle0", "networkidle2"],
              description: "When to consider navigation finished",
              default: "load"
            }
          },
          required: ["url"]
        }
      },
      {
        name: "chrome_click",
        description: "Click an element on the page",
        inputSchema: {
          type: "object",
          properties: {
            selector: {
              type: "string",
              description: "CSS selector of element to click"
            },
            wait_for_selector: {
              type: "boolean",
              description: "Wait for selector before clicking",
              default: true
            },
            timeout: {
              type: "integer",
              description: "Timeout in milliseconds",
              minimum: 0,
              maximum: 120000,
              default: 30000
            }
          },
          required: ["selector"]
        }
      },
      {
        name: "chrome_type",
        description: "Type text into an input element",
        inputSchema: {
          type: "object",
          properties: {
            selector: {
              type: "string",
              description: "CSS selector of input element"
            },
            text: {
              type: "string",
              description: "Text to type"
            },
            clear_first: {
              type: "boolean",
              description: "Clear existing text before typing",
              default: false
            },
            delay: {
              type: "integer",
              description: "Delay between key presses in milliseconds",
              minimum: 0,
              maximum: 1000,
              default: 0
            }
          },
          required: ["selector", "text"]
        }
      },
      {
        name: "chrome_get_content",
        description: "Get text content or attributes from the page",
        inputSchema: {
          type: "object",
          properties: {
            selector: {
              type: "string",
              description: "CSS selector to get content from (if not provided, gets full page text)"
            },
            attribute: {
              type: "string",
              description: "Get attribute value instead of text content"
            }
          }
        }
      },
      {
        name: "chrome_screenshot",
        description: "Take a screenshot of the page or element",
        inputSchema: {
          type: "object",
          properties: {
            full_page: {
              type: "boolean",
              description: "Capture full scrollable page",
              default: false
            },
            selector: {
              type: "string",
              description: "CSS selector to screenshot specific element"
            },
            format: {
              type: "string",
              enum: ["png", "jpeg"],
              description: "Image format",
              default: "jpeg"
            },
            quality: {
              type: "integer",
              description: "JPEG quality (1-100, lower = smaller file)",
              minimum: 1,
              maximum: 100,
              default: 60
            },
            max_width: {
              type: "integer",
              description: "Maximum image width in pixels",
              minimum: 100,
              maximum: 2560,
              default: 1280
            },
            max_height: {
              type: "integer",
              description: "Maximum image height in pixels",
              minimum: 100,
              maximum: 1440,
              default: 1440
            }
          }
        }
      },
      {
        name: "chrome_execute_script",
        description: "Execute JavaScript code in the page context",
        inputSchema: {
          type: "object",
          properties: {
            script: {
              type: "string",
              description: "JavaScript code to execute in page context"
            },
            args: {
              type: "array",
              description: "Arguments to pass to the script",
              items: {},
              default: []
            }
          },
          required: ["script"]
        }
      },
      {
        name: "chrome_get_title",
        description: "Get the current page title",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "chrome_get_url",
        description: "Get the current page URL",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "chrome_wait_for_selector",
        description: "Wait for an element to appear on the page",
        inputSchema: {
          type: "object",
          properties: {
            selector: {
              type: "string",
              description: "CSS selector to wait for"
            },
            visible: {
              type: "boolean",
              description: "Wait for element to be visible",
              default: false
            },
            timeout: {
              type: "integer",
              description: "Timeout in milliseconds",
              minimum: 0,
              maximum: 120000,
              default: 30000
            }
          },
          required: ["selector"]
        }
      },
      {
        name: "chrome_get_elements",
        description: "Query multiple elements and get their properties",
        inputSchema: {
          type: "object",
          properties: {
            selector: {
              type: "string",
              description: "CSS selector to query elements"
            },
            attributes: {
              type: "array",
              description: "Attributes to extract from elements",
              items: {
                type: "string"
              }
            }
          },
          required: ["selector"]
        }
      },
      {
        name: "chrome_scroll",
        description: "Scroll the page or to a specific element",
        inputSchema: {
          type: "object",
          properties: {
            x: {
              type: "integer",
              description: "Horizontal scroll position",
              default: 0
            },
            y: {
              type: "integer",
              description: "Vertical scroll position",
              default: 0
            },
            selector: {
              type: "string",
              description: "Scroll to specific element"
            }
          }
        }
      },
      {
        name: "chrome_press_key",
        description: "Press a keyboard key",
        inputSchema: {
          type: "object",
          properties: {
            key: {
              type: "string",
              description: "Key to press (e.g., 'Enter', 'Tab', 'Escape')"
            },
            delay: {
              type: "integer",
              description: "Delay before releasing key in milliseconds",
              minimum: 0,
              maximum: 1000,
              default: 0
            }
          },
          required: ["key"]
        }
      },
      {
        name: "chrome_go_back",
        description: "Navigate back in browser history",
        inputSchema: {
          type: "object",
          properties: {
            wait_until: {
              type: "string",
              enum: ["load", "domcontentloaded", "networkidle0", "networkidle2"],
              description: "When to consider navigation finished",
              default: "load"
            }
          }
        }
      },
      {
        name: "chrome_go_forward",
        description: "Navigate forward in browser history",
        inputSchema: {
          type: "object",
          properties: {
            wait_until: {
              type: "string",
              enum: ["load", "domcontentloaded", "networkidle0", "networkidle2"],
              description: "When to consider navigation finished",
              default: "load"
            }
          }
        }
      },
      {
        name: "chrome_reload",
        description: "Reload the current page",
        inputSchema: {
          type: "object",
          properties: {
            wait_until: {
              type: "string",
              enum: ["load", "domcontentloaded", "networkidle0", "networkidle2"],
              description: "When to consider navigation finished",
              default: "load"
            }
          }
        }
      },
      {
        name: "chrome_set_viewport",
        description: "Set the viewport size",
        inputSchema: {
          type: "object",
          properties: {
            width: {
              type: "integer",
              description: "Viewport width",
              minimum: 100,
              maximum: 7680
            },
            height: {
              type: "integer",
              description: "Viewport height",
              minimum: 100,
              maximum: 4320
            },
            device_scale_factor: {
              type: "number",
              description: "Device scale factor",
              minimum: 0.1,
              maximum: 10,
              default: 1
            }
          },
          required: ["width", "height"]
        }
      },
      {
        name: "chrome_get_cookies",
        description: "Get browser cookies",
        inputSchema: {
          type: "object",
          properties: {
            urls: {
              type: "array",
              description: "URLs to get cookies for (all if not specified)",
              items: {
                type: "string"
              }
            }
          }
        }
      },
      {
        name: "chrome_set_cookie",
        description: "Set a browser cookie",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Cookie name"
            },
            value: {
              type: "string",
              description: "Cookie value"
            },
            url: {
              type: "string",
              description: "Cookie URL"
            },
            domain: {
              type: "string",
              description: "Cookie domain"
            },
            path: {
              type: "string",
              description: "Cookie path"
            },
            expires: {
              type: "number",
              description: "Cookie expiration timestamp"
            },
            http_only: {
              type: "boolean",
              description: "HTTP only flag"
            },
            secure: {
              type: "boolean",
              description: "Secure flag"
            },
            same_site: {
              type: "string",
              enum: ["Strict", "Lax", "None"],
              description: "SameSite attribute"
            }
          },
          required: ["name", "value"]
        }
      },
      {
        name: "chrome_wait_for_navigation",
        description: "Wait for page navigation to complete",
        inputSchema: {
          type: "object",
          properties: {
            timeout: {
              type: "integer",
              description: "Timeout in milliseconds",
              minimum: 0,
              maximum: 120000,
              default: 30000
            },
            wait_until: {
              type: "string",
              enum: ["load", "domcontentloaded", "networkidle0", "networkidle2"],
              description: "When to consider navigation finished",
              default: "load"
            }
          }
        }
      },
      {
        name: "chrome_close",
        description: "Close the browser",
        inputSchema: {
          type: "object",
          properties: {}
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    switch (name) {
      case "chrome_launch": {
        const params = LaunchBrowserSchema.parse(args || {});
        await browserManager.ensureBrowser(params.headless, params.width, params.height);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                message: "Browser launched successfully",
                headless: params.headless,
                viewport: { width: params.width, height: params.height }
              }, null, 2)
            }
          ]
        };
      }

      case "chrome_navigate": {
        const params = NavigateSchema.parse(args);
        const { page } = await browserManager.ensureBrowser();
        await page.goto(params.url, { waitUntil: params.wait_until });
        const title = await page.title();
        const url = page.url();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                url: url,
                title: title
              }, null, 2)
            }
          ]
        };
      }

      case "chrome_click": {
        const params = ClickSchema.parse(args);
        const { page } = await browserManager.ensureBrowser();
        if (params.wait_for_selector) {
          await page.waitForSelector(params.selector, { timeout: params.timeout });
        }
        await page.click(params.selector);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                message: `Clicked element: ${params.selector}`
              }, null, 2)
            }
          ]
        };
      }

      case "chrome_type": {
        const params = TypeTextSchema.parse(args);
        const { page } = await browserManager.ensureBrowser();
        await page.waitForSelector(params.selector);
        if (params.clear_first) {
          await page.click(params.selector, { clickCount: 3 });
          await page.keyboard.press('Backspace');
        }
        await page.type(params.selector, params.text, { delay: params.delay });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                message: `Typed text into: ${params.selector}`
              }, null, 2)
            }
          ]
        };
      }

      case "chrome_get_content": {
        const params = GetContentSchema.parse(args || {});
        const { page } = await browserManager.ensureBrowser();
        
        let content;
        if (params.selector) {
          if (params.attribute) {
            content = await page.$eval(params.selector, (el, attr) => el.getAttribute(attr), params.attribute);
          } else {
            content = await page.$eval(params.selector, el => el.textContent);
          }
        } else {
          content = await page.evaluate(() => document.body.innerText);
        }
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                content: content
              }, null, 2)
            }
          ]
        };
      }

      case "chrome_screenshot": {
        const params = ScreenshotSchema.parse(args || {});
        const { page } = await browserManager.ensureBrowser();
        
        let screenshotOptions = {
          type: params.format,
          encoding: 'base64'
        };

        if (params.format === 'jpeg') {
          screenshotOptions.quality = params.quality;
        }

        let screenshot;
        if (params.selector) {
          const element = await page.$(params.selector);
          if (!element) {
            throw new Error(`Element not found: ${params.selector}`);
          }
          screenshot = await element.screenshot(screenshotOptions);
        } else {
          screenshotOptions.fullPage = params.full_page;
          screenshot = await page.screenshot(screenshotOptions);
        }
        
        const compressed = await compressImageToFit(
          screenshot,
          params.format,
          params.quality,
          params.max_width,
          params.max_height
        );
        
        const mimeType = params.format === 'jpeg' ? 'image/jpeg' : 'image/png';
        
        return {
          content: [
            {
              type: "image",
              data: compressed.base64,
              mimeType: mimeType
            },
            {
              type: "text",
              text: `Screenshot captured: ${compressed.width}x${compressed.height}px, ${Math.round(compressed.size / 1024)}KB`
            }
          ]
        };
      }

      case "chrome_execute_script": {
        const params = ExecuteScriptSchema.parse(args);
        const { page } = await browserManager.ensureBrowser();
        const result = await page.evaluate(new Function('...args', `return (${params.script})(...args)`), ...params.args);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                result: result
              }, null, 2)
            }
          ]
        };
      }

      case "chrome_get_title": {
        const { page } = await browserManager.ensureBrowser();
        const title = await page.title();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                title: title
              }, null, 2)
            }
          ]
        };
      }

      case "chrome_get_url": {
        const { page } = await browserManager.ensureBrowser();
        const url = page.url();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                url: url
              }, null, 2)
            }
          ]
        };
      }

      case "chrome_wait_for_selector": {
        const params = WaitForSelectorSchema.parse(args);
        const { page } = await browserManager.ensureBrowser();
        await page.waitForSelector(params.selector, {
          visible: params.visible,
          timeout: params.timeout
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                message: `Element found: ${params.selector}`
              }, null, 2)
            }
          ]
        };
      }

      case "chrome_get_elements": {
        const params = GetElementsSchema.parse(args);
        const { page } = await browserManager.ensureBrowser();
        
        const elements = await page.evaluate((selector, attrs) => {
          const els = Array.from(document.querySelectorAll(selector));
          return els.map(el => {
            const data = { text: el.textContent.trim() };
            if (attrs && attrs.length > 0) {
              attrs.forEach(attr => {
                data[attr] = el.getAttribute(attr);
              });
            }
            return data;
          });
        }, params.selector, params.attributes || []);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                count: elements.length,
                elements: elements
              }, null, 2)
            }
          ]
        };
      }

      case "chrome_scroll": {
        const params = ScrollSchema.parse(args || {});
        const { page } = await browserManager.ensureBrowser();
        
        if (params.selector) {
          await page.evaluate((sel) => {
            const element = document.querySelector(sel);
            if (element) {
              element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }, params.selector);
        } else {
          await page.evaluate((x, y) => {
            window.scrollTo(x, y);
          }, params.x, params.y);
        }
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                message: params.selector ? `Scrolled to element: ${params.selector}` : `Scrolled to position: (${params.x}, ${params.y})`
              }, null, 2)
            }
          ]
        };
      }

      case "chrome_press_key": {
        const params = PressKeySchema.parse(args);
        const { page } = await browserManager.ensureBrowser();
        await page.keyboard.press(params.key, { delay: params.delay });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                message: `Pressed key: ${params.key}`
              }, null, 2)
            }
          ]
        };
      }

      case "chrome_go_back": {
        const params = GoBackSchema.parse(args || {});
        const { page } = await browserManager.ensureBrowser();
        await page.goBack({ waitUntil: params.wait_until });
        const url = page.url();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                url: url
              }, null, 2)
            }
          ]
        };
      }

      case "chrome_go_forward": {
        const params = GoForwardSchema.parse(args || {});
        const { page } = await browserManager.ensureBrowser();
        await page.goForward({ waitUntil: params.wait_until });
        const url = page.url();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                url: url
              }, null, 2)
            }
          ]
        };
      }

      case "chrome_reload": {
        const params = ReloadSchema.parse(args || {});
        const { page } = await browserManager.ensureBrowser();
        await page.reload({ waitUntil: params.wait_until });
        const url = page.url();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                url: url
              }, null, 2)
            }
          ]
        };
      }

      case "chrome_set_viewport": {
        const params = SetViewportSchema.parse(args);
        const { page } = await browserManager.ensureBrowser();
        await page.setViewport({
          width: params.width,
          height: params.height,
          deviceScaleFactor: params.device_scale_factor
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                viewport: {
                  width: params.width,
                  height: params.height,
                  deviceScaleFactor: params.device_scale_factor
                }
              }, null, 2)
            }
          ]
        };
      }

      case "chrome_get_cookies": {
        const params = GetCookiesSchema.parse(args || {});
        const { page } = await browserManager.ensureBrowser();
        const cookies = params.urls ? await page.cookies(...params.urls) : await page.cookies();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                cookies: cookies
              }, null, 2)
            }
          ]
        };
      }

      case "chrome_set_cookie": {
        const params = SetCookieSchema.parse(args);
        const { page } = await browserManager.ensureBrowser();
        const cookieData = {
          name: params.name,
          value: params.value
        };
        if (params.url) cookieData.url = params.url;
        if (params.domain) cookieData.domain = params.domain;
        if (params.path) cookieData.path = params.path;
        if (params.expires) cookieData.expires = params.expires;
        if (params.http_only !== undefined) cookieData.httpOnly = params.http_only;
        if (params.secure !== undefined) cookieData.secure = params.secure;
        if (params.same_site) cookieData.sameSite = params.same_site;
        
        await page.setCookie(cookieData);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                message: `Cookie set: ${params.name}`
              }, null, 2)
            }
          ]
        };
      }

      case "chrome_wait_for_navigation": {
        const params = WaitForNavigationSchema.parse(args || {});
        const { page } = await browserManager.ensureBrowser();
        await page.waitForNavigation({
          timeout: params.timeout,
          waitUntil: params.wait_until
        });
        const url = page.url();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                url: url
              }, null, 2)
            }
          ]
        };
      }

      case "chrome_close": {
        await browserManager.closeBrowser();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                message: "Browser closed"
              }, null, 2)
            }
          ]
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: error.message,
            stack: error.stack
          }, null, 2)
        }
      ],
      isError: true
    };
  }
});

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  console.error("Chrome Control MCP Server running on stdio");
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});