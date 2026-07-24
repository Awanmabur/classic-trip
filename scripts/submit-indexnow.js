#!/usr/bin/env node
const path = require('path');
try { require('dotenv').config({ path: path.join(process.cwd(), '.env') }); } catch (error) {}
const { env } = require('../src/config/env');
const seoService = require('../src/services/seo/seoService');

async function main() {
  if (!env.seo.indexNowKey) {
    throw new Error('INDEXNOW_KEY is required before submitting URLs.');
  }
  if (typeof fetch !== 'function') {
    throw new Error('This script requires Node.js with global fetch support.');
  }
  const urls = (await seoService.buildSitemapUrls()).map((item) => item.loc).slice(0, 10000);
  const payload = {
    host: new URL(seoService.siteUrl()).host,
    key: env.seo.indexNowKey,
    keyLocation: seoService.absoluteUrl(`/${env.seo.indexNowKey}.txt`),
    urlList: urls,
  };
  const response = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`IndexNow submission failed with ${response.status}: ${text}`);
  }
  console.log(`Submitted ${urls.length} URLs to IndexNow for ${payload.host}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
