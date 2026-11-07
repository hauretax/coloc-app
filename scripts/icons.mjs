// Génère les icônes PNG (Android, iPhone, masquable, badge de notif) à partir de public/icon.svg,
// avec Chrome en mode invisible. Usage : node scripts/icons.mjs (puppeteer-core requis).
import puppeteer from 'puppeteer-core'
import { readFileSync } from 'node:fs'

const svg = readFileSync(new URL('../public/icon.svg', import.meta.url), 'utf8')
const inner = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<rect[^>]*\/>/, '')
const BG = '#E8A628'
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="${BG}"/><g transform="translate(76.8 76.8) scale(0.7)">${inner}</g></svg>`
const square = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="${BG}"/>${inner}</svg>`
// Badge Android : silhouette blanche sur fond transparent.
const badge = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${inner.replaceAll('#1B1302', '#FFFFFF')}</svg>`

const jobs = [
  ['icon-192.png', 192, svg],
  ['icon-512.png', 512, svg],
  ['icon-maskable-512.png', 512, maskable],
  ['apple-touch-icon.png', 180, square],
  ['badge-96.png', 96, badge],
]
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const page = await browser.newPage()
for (const [name, size, src] of jobs) {
  await page.setViewport({ width: size, height: size })
  await page.setContent(`<style>*{margin:0}svg{width:${size}px;height:${size}px;display:block}</style>${src}`)
  await page.screenshot({ path: new URL(`../public/${name}`, import.meta.url).pathname, omitBackground: true })
}
await browser.close()
console.log('icônes générées')
