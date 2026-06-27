const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

async function run() {
  console.log('🐾 Starting Playwright to render SVG icons...');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  const svgContent = fs.readFileSync(path.join(__dirname, '..', 'public', 'favicon.svg'), 'utf8');
  
  // Wrapper template to center the SVG
  const htmlTemplate = (bgColor) => `
    <html>
      <head>
        <style>
          body {
            margin: 0;
            padding: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            background: ${bgColor};
            width: 100vw;
            height: 100vh;
            overflow: hidden;
          }
          svg {
            width: 80%;
            height: 80%;
          }
        </style>
      </head>
      <body>
        ${svgContent}
      </body>
    </html>
  `;
  
  // Set transparent page content
  await page.setContent(htmlTemplate('transparent'));
  
  // Generate 192x192 icon (transparent for Android/Chrome PWA adaptiveness)
  await page.setViewportSize({ width: 192, height: 192 });
  await page.screenshot({
    path: path.join(__dirname, '..', 'public', 'icon-192.png'),
    omitBackground: true
  });
  console.log('✅ Generated public/icon-192.png');
  
  // Generate 512x512 icon (transparent)
  await page.setViewportSize({ width: 512, height: 512 });
  await page.screenshot({
    path: path.join(__dirname, '..', 'public', 'icon-512.png'),
    omitBackground: true
  });
  console.log('✅ Generated public/icon-512.png');

  // Set solid dark background for iOS touch icon (iOS requires solid background)
  await page.setContent(htmlTemplate('#0b0f19'));

  // Generate 180x180 apple-touch-icon
  await page.setViewportSize({ width: 180, height: 180 });
  await page.screenshot({
    path: path.join(__dirname, '..', 'public', 'apple-touch-icon.png'),
    omitBackground: false
  });
  console.log('✅ Generated public/apple-touch-icon.png');
  
  await browser.close();
  console.log('🐾 Icon generation completed successfully.');
}

run().catch(err => {
  console.error('❌ Error generating icons:', err);
  process.exit(1);
});
