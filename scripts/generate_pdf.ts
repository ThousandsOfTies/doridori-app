import { jsPDF } from 'jspdf';
import fs from 'fs';
import path from 'path';

// Output directory (absolute path)
const outputDir = 'C:\\VibeCode\\ThousandsOfTies.github.io\\drills';

// Ensure directory exists
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

const doc = new jsPDF();

// Title
doc.setFontSize(24);
doc.text('Simple Addition Drill', 105, 30, { align: 'center' });

// Instructions
doc.setFontSize(12);
doc.text('Calculate the following problems.', 105, 40, { align: 'center' });

// Problems
doc.setFontSize(16);
let y = 60;
const xLeft = 40;
const xRight = 120;

for (let i = 0; i < 10; i++) {
    // Generate random numbers (1-9)
    const a1 = Math.floor(Math.random() * 9) + 1;
    const b1 = Math.floor(Math.random() * 9) + 1;
    const q1 = `${i + 1})  ${a1} + ${b1} = `;

    const a2 = Math.floor(Math.random() * 9) + 1;
    const b2 = Math.floor(Math.random() * 9) + 1;
    const q2 = `${i + 11})  ${a2} + ${b2} = `;

    doc.text(q1, xLeft, y);
    doc.text(q2, xRight, y);
    y += 15;
}

// Footer
doc.setFontSize(10);
doc.setTextColor(100);
doc.text('© 2026 HomeTeacher Sample Drill', 105, 280, { align: 'center' });

// Save
const outputPath = path.join(outputDir, 'sample_math_01.pdf');
const pdfData = doc.output('arraybuffer');
fs.writeFileSync(outputPath, Buffer.from(pdfData));

console.log(`PDF created at: ${outputPath}`);
