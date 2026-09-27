import sharp from 'sharp'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const iconDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons', 'doridori')
const source = join(iconDir, 'mole-source.png')

async function generateIcons() {
  await sharp(source).resize(192, 192).png().toFile(join(iconDir, 'logo.png'))

  const mole = await sharp(source).resize(370, 370).png().toBuffer()
  await sharp({ create: { width: 512, height: 512, channels: 4, background: '#f8f6f1' } })
    .composite([{ input: mole, left: 71, top: 71 }])
    .png()
    .toFile(join(iconDir, 'app.png'))

  const face = await sharp(source).resize(512, 512).png().toBuffer()
  await sharp(face)
    .extract({ left: 90, top: 20, width: 332, height: 332 })
    .resize(64, 64)
    .png()
    .toFile(join(iconDir, 'favicon.png'))
  console.log('Generated DoriDori mole icons')
}

generateIcons().catch(error => {
  console.error(error)
  process.exitCode = 1
})
