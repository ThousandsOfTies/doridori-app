import { jsPDF } from 'jspdf';
import fs from 'fs';
import path from 'path';

const OUTPUT_DIR = path.resolve('public/drills');

if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

interface Problem {
    id: number;
    question: string;
    answer: string;
    metadata?: any;
}

const generateAddition = (count: number, max: number): Problem[] => {
    const problems: Problem[] = [];
    for (let i = 0; i < count; i++) {
        const a = Math.floor(Math.random() * max) + 1;
        const b = Math.floor(Math.random() * max) + 1;
        problems.push({
            id: i + 1,
            question: `${a} + ${b} =`,
            answer: `${a + b}`,
        });
    }
    return problems;
};

const generatePerimeterAreaProblems = (): any[] => {
    const problems: any[] = [];
    const COUNT = 20;

    for (let i = 0; i < COUNT; i++) {
        const width = Math.floor(Math.random() * 8) + 2; // 2-9
        const height = Math.floor(Math.random() * 8) + 2; // 2-9

        problems.push({
            id: i + 1,
            question: `たて${height}cm、よこ${width}cmの\nちょうほうけいの めんせきは？`,
            answer: `${width * height} cm²`,
            metadata: { type: 'rectangle', width, height }
        });
    }
    return problems;
};

const generateWordProblems = (): any[] => {
    const problems: any[] = [];
    const COUNT = 10;

    const names = ['ケン', 'ハナ', 'タロウ', 'ユミ', 'レオ', 'マイ'];
    const items = [
        { name: 'りんご', unit: 'こ' },
        { name: 'えんぴつ', unit: '本' },
        { name: 'クッキー', unit: 'まい' },
        { name: 'ノート', unit: 'さつ' },
        { name: 'けしゴム', unit: 'こ' }
    ];

    const templates = [
        {
            text: '{name}さんは 1{unit} {price}円の\n{item}を {count}{unit} かいました。\nだい金は いくらでしょう？',
            calc: (c: number, p: number) => c * p,
            unit: '円'
        },
        {
            text: '1はこに {item}が {price}こ はいっています。\nこれが {count}はこ あります。\n{item}は 全部で 何こでしょう？',
            calc: (c: number, p: number) => c * p,
            unit: 'こ'
        }
    ];

    for (let i = 0; i < COUNT; i++) {
        const template = templates[Math.floor(Math.random() * templates.length)];
        const name = names[Math.floor(Math.random() * names.length)];
        const itemObj = items[Math.floor(Math.random() * items.length)];

        const count = Math.floor(Math.random() * 8) + 2; // 2-9
        const price = (Math.floor(Math.random() * 9) + 1) * 10; // 10, 20...90

        let question = template.text
            .replace('{name}', name)
            .replace('{count}', count.toString())
            .replace('{item}', itemObj.name)
            .replace('{price}', price.toString())
            .replaceAll('{unit}', itemObj.unit); // Replace all units

        const answerVal = template.calc(count, price);
        const unit = template.unit;

        problems.push({
            id: i + 1,
            question: question,
            answer: `${answerVal} ${unit}`
        });
    }
    return problems;
};

const generateDrillPDF = (title: string, filename: string, problems: any[]) => {
    try {
        const doc = new jsPDF();

        // Load Japanese Font
        const fontPath = path.resolve('scripts/assets/fonts/ipaexg.ttf');
        if (fs.existsSync(fontPath)) {
            const fontBase64 = fs.readFileSync(fontPath, { encoding: 'base64' });
            doc.addFileToVFS('ipaexg.ttf', fontBase64);
            doc.addFont('ipaexg.ttf', 'IPAexGothic', 'normal');
            doc.setFont('IPAexGothic');
        } else {
            console.warn('Font file not found, using default font (Japanese may not render).');
        }

        // PAGE 1: QUESTIONS
        doc.setFontSize(18);
        doc.text(title, 105, 20, { align: 'center' });

        doc.setFontSize(10);
        doc.text(`ID: ${filename.replace('.pdf', '')}`, 180, 10);

        doc.setFontSize(12);
        let y = 40;
        let x = 20;

        problems.forEach((p, i) => {
            // Page break
            if (y > 250) {
                doc.addPage();
                doc.setFont('IPAexGothic'); // Reset font for new page just in case
                y = 40;
            }

            // Split question by newlines for multiline support
            const lines = p.question.split('\n');
            doc.text(`(${p.id})`, x, y);

            lines.forEach((line: string, idx: number) => {
                doc.text(line, x + 10, y + (idx * 6));
            });

            // If it's a geometry problem, draw it
            if (p.metadata?.type === 'rectangle') {
                const { width, height } = p.metadata;
                const scale = 5; // Scale for visibility
                const drawY = y + (lines.length * 6); // Offset by text height

                // Draw rectangle
                doc.setDrawColor(0);
                doc.rect(x + 10, drawY + 5, width * scale, height * scale);

                // Labels
                doc.setFontSize(10);
                doc.text(`${width}cm`, x + 10 + (width * scale / 2), drawY + 4, { align: 'center' }); // Top width
                doc.text(`${height}cm`, x + 8, drawY + 5 + (height * scale / 2), { align: 'right' }); // Left height

                doc.setFontSize(12); // Reset
                y += (height * scale) + 25 + (lines.length * 6); // Extra space for drawing
            } else {
                y += 15 + ((lines.length - 1) * 6);
            }
        });

        // PAGE 2: ANSWERS
        doc.addPage();
        doc.setFont('IPAexGothic');
        doc.setFontSize(18);
        doc.text('かいとう (Answer Key)', 105, 20, { align: 'center' });

        doc.setFontSize(12);
        y = 40;
        x = 30;
        problems.forEach((p, i) => {
            if (y > 270) {
                doc.addPage();
                doc.setFont('IPAexGothic');
                y = 40;
                x = 30;
            }
            doc.text(`(${p.id})  ${p.answer}`, x, y);
            y += 10;
        });

        const buffer = doc.output('arraybuffer');
        fs.writeFileSync(path.join(OUTPUT_DIR, filename), Buffer.from(buffer));
        console.log(`Generated: ${filename}`);
    } catch (e) {
        console.error(`Error generating ${filename}:`, e);
    }
};

// Generate Math Drills
const main = () => {
    console.log('Generating Math Drills...');

    // Grade 1: Addition (up to 10)
    generateDrillPDF(
        'けいさんドリル (1ねん たしざん Lv1)',
        'math-g1-add-lv1.pdf',
        generateAddition(20, 5) // max 5+5=10
    );

    // Grade 1: Addition (up to 20)
    generateDrillPDF(
        'けいさんドリル (1ねん たしざん Lv2)',
        'math-g1-add-lv2.pdf',
        generateAddition(20, 10) // max 10+10=20
    );

    // Grade 3: Area (Rectangle)
    generateDrillPDF(
        'ずけいドリル (3ねん めんせき)',
        'math-g3-area-rect.pdf',
        generatePerimeterAreaProblems()
    );

    // Grade 2: Word Problems (Multiplication)
    generateDrillPDF(
        'ぶんしょうだい (2ねん かけざん)',
        'math-g2-word-multi.pdf',
        generateWordProblems()
    );

    console.log('All drills generated successfully!');
};

main();
