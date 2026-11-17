#!/usr/bin/env node
// The sideload APK must carry the repository's 180 px Gym visual media, and the page inside
// it must ask for those files (exercise detail uses lib/exercises.js imgSrc / gifSrc).
//
//   node scripts/android/check-apk-media.mjs path/to/app.apk
//
// Lists names, reads one still header and one clip header, and scans the JS for the media
// paths. It does not decode a picture and it does not print file bytes. A key-shaped string
// in the bundle fails the check without being printed.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const apk = process.argv[2]
if (!apk) {
  console.error('usage: check-apk-media.mjs <apk>')
  process.exit(2)
}

const names = execFileSync('unzip', ['-Z1', apk], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .split('\n').filter(Boolean)
const stills = names.filter(n => /^assets\/public\/exercise-media\/still\/[^/]+\.webp$/.test(n))
const clips = names.filter(n => /^assets\/public\/exercise-media\/clip\/[^/]+\.(mp4|webp)$/.test(n))
const problems = []
if (stills.length < 6000) problems.push(`only ${stills.length} stills in the APK (the catalogue has more than 6000)`)
if (clips.length < 6000) problems.push(`only ${clips.length} animations in the APK (the catalogue has more than 6000)`)
if (!names.includes('assets/public/exercise-media/NOTICE.md')) problems.push('exercise-media/NOTICE.md is missing from the APK')

const dir = mkdtempSync(join(tmpdir(), 'apk-media-'))
try {
  const sampleStill = stills.slice().sort()[0]
  const sampleClip = clips.slice().sort()[0]
  const wanted = ['assets/public/index.html', 'assets/public/exercise-media/NOTICE.md', 'assets/public/assets/*.js']
  if (sampleStill) wanted.push(sampleStill)
  if (sampleClip) wanted.push(sampleClip)
  try {
    execFileSync('unzip', ['-o', '-q', '-d', dir, apk, ...wanted], { stdio: 'pipe' })
  } catch {
    problems.push('could not read the app page or the exercise media inside the APK')
  }

  const htmlPath = join(dir, 'assets/public/index.html')
  try {
    const html = readFileSync(htmlPath, 'utf8')
    if (!/<meta\s+name="opengym-flavor"\s+content="mobile"/.test(html))
      problems.push('index.html is not the mobile build (no opengym-flavor meta)')
  } catch {
    problems.push('index.html is missing from the APK')
  }

  const jsDir = join(dir, 'assets/public/assets')
  let js = ''
  try {
    for (const f of readdirSync(jsDir)) {
      if (f.endsWith('.js')) js += readFileSync(join(jsDir, f), 'utf8')
    }
  } catch { /* reported below */ }
  if (!js.includes('exercise-media/clip/') || !js.includes('exercise-media/still/'))
    problems.push('the bundled page does not name exercise-media/clip/ and exercise-media/still/')
  if (/sk-[A-Za-z0-9]{20,}/.test(js))
    problems.push('the app bundle contains a key-shaped string')

  if (sampleStill) {
    try {
      const w = webpSide(readFileSync(join(dir, sampleStill)))
      if (w == null) problems.push(`${sampleStill}: could not read a WebP canvas size`)
      else if (w > 180) problems.push(`${sampleStill}: ${w} px, larger than the 180 px media this build may carry`)
    } catch {
      problems.push(`${sampleStill}: missing from the extracted APK`)
    }
  }
  if (sampleClip) {
    try {
      const side = mp4Side(readFileSync(join(dir, sampleClip)))
      if (side == null) problems.push(`${sampleClip}: could not read a video size`)
      else if (side > 180) problems.push(`${sampleClip}: ${side} px, larger than the 180 px media this build may carry`)
    } catch {
      problems.push(`${sampleClip}: missing from the extracted APK`)
    }
  }

  try {
    const notice = readFileSync(join(dir, 'assets/public/exercise-media/NOTICE.md'), 'utf8')
    if (!/Gym visual/.test(notice)) problems.push('NOTICE.md in the APK does not name Gym visual')
  } catch {
    if (names.includes('assets/public/exercise-media/NOTICE.md'))
      problems.push('NOTICE.md is listed but could not be read')
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}

const apkBytes = statSync(apk).size
console.log(`apk: ${(apkBytes / 1024 / 1024).toFixed(1)} MB`)
console.log(`media: ${stills.length} stills, ${clips.length} animations, NOTICE.md ${names.includes('assets/public/exercise-media/NOTICE.md') ? 'present' : 'MISSING'}`)
if (problems.length) {
  for (const p of problems) console.error('✗ ' + p)
  process.exit(1)
}
console.log('APK media OK')

/** Canvas width of a WebP (VP8X or VP8L), or null. */
function webpSide(buf) {
  if (!buf || buf.length < 25) return null
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') return null
  const kind = buf.toString('latin1', 12, 16)
  if (kind === 'VP8X' && buf.length >= 30) return buf.readUIntLE(24, 3) + 1
  if (kind === 'VP8L' && buf[20] === 0x2f) return (buf.readUInt32LE(21) & 0x3fff) + 1
  return null
}

/** The larger track dimension of an MP4, from tkhd, or null. */
function mp4Side(buf) {
  let best = 0
  let from = 0
  while (from < buf.length) {
    const i = buf.indexOf('tkhd', from)
    if (i < 0) break
    const ver = buf[i + 4]
    let width = 0
    if (ver === 0 && i + 88 <= buf.length) width = buf.readUInt32BE(i + 80) >>> 16
    else if (ver === 1 && i + 100 <= buf.length) width = buf.readUInt32BE(i + 92) >>> 16
    if (width > best && width < 10000) best = width
    from = i + 4
  }
  return best || null
}
