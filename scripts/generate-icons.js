import sharp from 'sharp';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const sizes = [192, 512];
const modes = ['kids', 'discuss'];

async function generateIcons() {
  for (const mode of modes) {
    const sourceDir = join(__dirname, '..', 'public', 'icons', mode);
    const logoPath = join(sourceDir, 'logo.png');
    const appPath = join(sourceDir, 'app.png');

    console.log(`\n📱 Processing ${mode} mode icons...`);

    // Process logo.png (192x192)
    if (existsSync(logoPath)) {
      const metadata = await sharp(logoPath).metadata();
      console.log(`  logo.png: ${metadata.width}x${metadata.height}`);

      if (metadata.width !== 192 || metadata.height !== 192) {
        console.log(`  ⚠️  Resizing logo.png to 192x192...`);
        await sharp(logoPath)
          .resize(192, 192, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
          .toFile(join(sourceDir, 'logo-new.png'));
        console.log(`  ✓ Created logo-new.png`);
      } else {
        console.log(`  ✓ logo.png is already 192x192`);
      }
    }

    // Process app.png (512x512)
    if (existsSync(appPath)) {
      const metadata = await sharp(appPath).metadata();
      console.log(`  app.png: ${metadata.width}x${metadata.height}`);

      if (metadata.width !== 512 || metadata.height !== 512) {
        console.log(`  ⚠️  Resizing app.png to 512x512...`);
        await sharp(appPath)
          .resize(512, 512, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
          .toFile(join(sourceDir, 'app-new.png'));
        console.log(`  ✓ Created app-new.png`);
      } else {
        console.log(`  ✓ app.png is already 512x512`);
      }
    }
  }

  console.log('\n✅ Icon generation complete!\n');
}

generateIcons().catch(console.error);
