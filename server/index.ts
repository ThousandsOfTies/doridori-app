import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { GoogleGenAI } from '@google/genai'

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const result = dotenv.config({ path: path.resolve(__dirname, '../.env') })
if (result.error) {
  console.log('Dotenv error:', result.error)
}
console.log('CWD:', process.cwd())
console.log('__dirname:', __dirname)

import Stripe from 'stripe'
import admin from 'firebase-admin'

// Initialize Stripe
const stripeSecretKey = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy';
if (stripeSecretKey === 'sk_test_dummy') {
  console.warn('⚠️ STRIPE_SECRET_KEY not set. Using dummy key. Stripe features will fail.');
}
const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-04-10' as any });

import fs from 'fs';

// Initialize Firebase Admin
if (!admin.apps.length) {
  try {
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (serviceAccountPath) {
      // ローカル開発: サービスアカウントキーファイルを使用
      const fullPath = path.resolve(__dirname, `../${serviceAccountPath}`);
      const serviceAccountJson = fs.readFileSync(fullPath, 'utf8');
      const serviceAccount = JSON.parse(serviceAccountJson);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      console.log('Firebase Admin initialized with service account.');
    } else {
      // Cloud Run本番: Application Default Credentials (ADC) を使用
      admin.initializeApp();
      console.log('Firebase Admin initialized with Application Default Credentials.');
    }
  } catch (error) {
    console.error('Failed to initialize Firebase Admin:', error);
  }
}

// Authentication Middleware
const authenticateUser = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    (req as any).user = decodedToken;
    next();
  } catch (error) {
    console.error('Error verifying auth token:', error);
    res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

// 文字列の正規化と一致判定を行う関数
function validateAndOverrideGrading(student: string, correct: string): boolean {
  if (!student || !correct) return false;

  const normalize = (str: string) => {
    return str
      .trim()
      // 全角英数字を半角に
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
      // 不要な空白を削除
      .replace(/\s+/g, '')
      // 文末の句読点や「です」「ます」を削除（簡易的）
      .replace(/[、。\.．]$/, '')
      .replace(/(です|ます|だ)$/, '')
      // 単位の揺れを吸収（一旦削除して数値のみ比較する戦略もアリだが、ここでは簡易正規化）
      .toLowerCase();
  };

  const normStudent = normalize(student);
  const normCorrect = normalize(correct);

  // 完全一致
  if (normStudent === normCorrect) return true;

  // 数値としての比較（"40" と "40.0" など）
  const numStudent = parseFloat(normStudent);
  const numCorrect = parseFloat(normCorrect);
  if (!isNaN(numStudent) && !isNaN(numCorrect) && Math.abs(numStudent - numCorrect) < 0.0001) {
    return true;
  }

  // "40" と "40度" のような包含関係（正解が短い数字で、生徒が単位をつけている場合など）
  // ただし逆（正解"40度"、生徒"40"）は文脈によるため慎重に。
  // ここでは「正解」が「生徒の解答」に含まれている、またはその逆で、かつ数値が含まれている場合を救済
  if ((normStudent.includes(normCorrect) || normCorrect.includes(normStudent)) && !isNaN(numCorrect)) {
    // 数字が含まれていて、かつ包含関係にあるならOKとする（危険かもしれないが40と40度は救いたい）
    // いや、 "140" と "40" がマッチしてしまうのを防ぐ必要がある。
    // ここはシンプルに「単位を除去して一致するか」を見る
    const removeUnit = (s: string) => s.replace(/[^0-9\.]/g, '');
    if (removeUnit(normStudent) === removeUnit(normCorrect) && removeUnit(normStudent).length > 0) {
      return true;
    }
  }

  return false;
}

const app = express()
const port = process.env.PORT || 3003

// Increase payload size limit for base64 images, but skip for Stripe webhooks
app.use((req, res, next) => {
  if (req.originalUrl === '/api/webhooks/stripe') {
    next();
  } else {
    express.json({ limit: '50mb' })(req, res, next);
  }
});
app.use(cors())

// Log API Key status (do not log the actual key)
console.log(`API Key status: ${process.env.GEMINI_API_KEY ? 'Present' : 'Missing'}`)

if (!process.env.GEMINI_API_KEY) {
  console.warn('⚠️ GEMINI_API_KEY is not set in environment variables.')
}

// Google GenAI クライアント初期化
// gemini-2.5-flash を使用（速度と精度のバランス重視）
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
console.log(`Using Gemini Model: ${MODEL_NAME}`)

// Initialize the Google Gen AI client (@google/genai)
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' })

// デフォルトモデルID
const DEFAULT_MODEL_ID = 'gemini-2.5-flash'

// 利用可能なモデル一覧（GA済みモデル優先、Previewは最新のみ）
const AVAILABLE_MODELS = [
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro (Preview)', description: '最新世代・最高精度モデル（プレビュー版）' },
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash (Preview)', description: '次世代の高速・高精度モデル（プレビュー版）' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: '複雑な論理推論に強いハイエンドモデル（GA）' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: '速度と精度のバランスが良いモデル（推奨・GA）' },
  { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', description: '超高速・低コストモデル（GA）' },
]

app.get('/api/models', (req, res) => {
  res.json({
    models: AVAILABLE_MODELS,
    default: DEFAULT_MODEL_ID
  })
})

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', model: MODEL_NAME })
})

// PDF Proxy endpoint to bypass CORS for external URLs
app.get('/api/proxy-pdf', async (req, res) => {
  try {
    const url = req.query.url as string

    if (!url) {
      return res.status(400).json({ error: 'URL parameter is required' })
    }

    // Basic URL validation
    try {
      new URL(url)
    } catch {
      return res.status(400).json({ error: 'Invalid URL format' })
    }

    // Only allow PDF files
    if (!url.toLowerCase().endsWith('.pdf')) {
      return res.status(400).json({ error: 'Only PDF files are allowed' })
    }

    console.log(`📥 Proxying PDF from: ${url}`)

    const response = await fetch(url)

    if (!response.ok) {
      return res.status(response.status).json({
        error: `Failed to fetch: ${response.statusText}`
      })
    }

    const buffer = await response.arrayBuffer()

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${url.split('/').pop()}"`)
    res.send(Buffer.from(buffer))

    console.log(`✅ PDF proxied successfully: ${url}`)
  } catch (error) {
    console.error('❌ Proxy error:', error)
    res.status(500).json({ error: 'Failed to proxy PDF' })
  }
})

// ==========================================
// Subject Management
// ==========================================

// Define available subjects with multi-language support
const SUBJECTS = [
  { id: 'math', labels: { ja: '算数・数学', en: 'Math' }, icon: '📐', description: 'Mathematics and Arithmetic' },
  { id: 'japanese', labels: { ja: '国語', en: 'Japanese' }, icon: '\u{1F1EF}\u{1F1F5}', description: 'Japanese Language' },
  { id: 'english', labels: { ja: '英語', en: 'English' }, icon: '\u{1F1EC}\u{1F1E7}', description: 'English Language' },
  { id: 'science', labels: { ja: '理科', en: 'Science' }, icon: '🔬', description: 'Science' },
  { id: 'social', labels: { ja: '社会', en: 'Social Studies' }, icon: '🌍', description: 'Social Studies' },
  { id: 'other', labels: { ja: 'その他', en: 'Other' }, icon: '📝', description: 'Other subjects' }
]

// GET /api/subjects - Return available subjects
app.get('/api/subjects', (req, res) => {
  res.json({
    subjects: SUBJECTS,
    default: 'math'
  })
})

// POST /api/detect-subject - Detect subject from cover page image
app.post('/api/detect-subject', async (req, res) => {
  try {
    const { image } = req.body

    if (!image) {
      return res.status(400).json({ error: 'image (base64) is required' })
    }

    console.log('🔍 Detecting subject from cover page...')

    // Extract mime type and clean base64
    const imageMatch = image.match(/^data:(image\/(png|jpeg));base64,(.+)$/)
    const imageData = imageMatch ? imageMatch[3] : image.replace(/^data:image\/\w+;base64,/, '')
    const imageMime = imageMatch ? imageMatch[1] : 'image/jpeg'

    // Use Gemini to detect subject
    const detectionPrompt = `この画像はドリルや問題集の表紙です。
この教材がどの教科のものか判定してください。

選択肢:
- math (算数・数学)
- japanese (国語)
- english (英語)
- science (理科)
- social (社会)
- other (その他)

【重要】以下のJSON形式のみを出力してください：
{
  "subjectId": "判定した教科のID（上記の選択肢から1つ）",
  "confidence": 0.0〜1.0の数値（確信度）,
  "reasoning": "判定理由（簡潔に）"
}

JSONのみを出力してください。`

    const result = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: imageMime, data: imageData } },
            { text: detectionPrompt }
          ]
        }
      ],
      config: { thinkingConfig: { thinkingBudget: 0 } }
    })

    const responseText = result.text

    if (!responseText) {
      throw new Error('Empty response from Gemini')
    }

    // Parse JSON response
    let jsonStr = responseText.replace(/```\w *\s * /g, '').replace(/```/g, '').trim()
    const jsonStart = jsonStr.indexOf('{')
    const jsonEnd = jsonStr.lastIndexOf('}')

    if (jsonStart !== -1 && jsonEnd > jsonStart) {
      jsonStr = jsonStr.substring(jsonStart, jsonEnd + 1)
    }

    let detectionData
    try {
      detectionData = JSON.parse(jsonStr)
    } catch (e) {
      console.error('JSON Parse Error:', e)
      console.log('Raw Response:', responseText)
      // Fallback to math if parsing fails
      return res.json({
        success: true,
        subjectId: 'math',
        confidence: 0.5,
        reasoning: 'Failed to parse AI response, defaulting to math'
      })
    }

    console.log(`✅ Subject detected: ${detectionData.subjectId} (confidence: ${detectionData.confidence})`)

    res.json({
      success: true,
      subjectId: detectionData.subjectId || 'math',
      confidence: detectionData.confidence || 0.5,
      reasoning: detectionData.reasoning
    })

  } catch (error) {
    console.error('Error in /api/detect-subject:', error)
    res.status(500).json({
      success: false,
      subjectId: 'math', // fallback
      confidence: 0,
      error: error instanceof Error ? error.message : 'Internal Server Error'
    })
  }
})

// 簡素化された採点API（切り抜き画像のみ）
app.post('/api/grade-work', async (req, res) => {
  try {
    const { croppedImageData, model: requestModel, language, subjectId } = req.body

    if (!croppedImageData) {
      return res.status(400).json({ error: 'croppedImageData is required' })
    }

    const startTime = Date.now()
    console.log(`Grading work (subject: ${subjectId || 'default'})...`)

    // Use requested model or default
    const currentModelName = requestModel || MODEL_NAME

    // 言語設定の確認
    const isJapanese = !language || language.startsWith('ja');

    // 教科別のprompt補足説明
    const getSubjectSpecificGuidance = (subject: string | undefined) => {
      if (!subject) return '';

      const guidance: Record<string, { ja: string; en: string }> = {
        japanese: {
          ja: `\n\n【国語の採点について】
・記述問題では、生徒の表現が模範解答と異なっていても、意味が正しく伝わっていれば正解としてください。
・漢字の書き取りでは、とめ・はね・はらいを厳密にチェックしてください。
・文章の読解では、本文の内容と照らし合わせて判定してください。`,
          en: `\n\n【Japanese Language Grading】
・For written answers, accept answers that convey the correct meaning even if the expression differs from the model answer.
・For kanji writing, check the strokes strictly.
・For reading comprehension, verify against the text.`
        },
        math: {
          ja: `\n\n【算数・数学の採点について】
・計算過程が正しければ、最終的な答えが少し違っても部分点を考慮してください。
・単位の記入漏れは減点対象ですが、計算自体が正しければ大きく減点しないでください。
・図形問題では、補助線や考え方のプロセスも評価してください。`,
          en: `\n\n【Math Grading】
・If the calculation process is correct, consider partial credit even if the final answer is slightly different.
・Missing units should be noted but not heavily penalized if the calculation is correct.
・For geometry, evaluate the use of auxiliary lines and thought process.`
        },
        science: {
          ja: `\n\n【理科の採点について】
・専門用語の表記揺れ（ひらがな・カタカナ）は許容してください。
・実験の観察結果は、要点が合っていれば表現が違っても正解としてください。
・理由を問う問題では、科学的な根拠が含まれているか確認してください。`,
          en: `\n\n【Science Grading】
・Allow variations in technical term notation (hiragana/katakana).
・For experimental observations, accept if the key points are correct.
・For reasoning questions, verify scientific basis is included.`
        },
        social: {
          ja: `\n\n【社会の採点について】
・歴史的事項や地名の表記揺れは許容してください（例：「えどばくふ」「江戸幕府」）。
・記述問題では、重要なキーワードが含まれていれば、文章構成が違っても正解としてください。
・年号の前後数年のズレは大きく減点しないでください。`,
          en: `\n\n【Social Studies Grading】
・Allow variations in historical terms and place names.
・For written answers, accept if key terms are included.
・Minor errors in dates (within a few years) should not be heavily penalized.`
        },
        english: {
          ja: `\n\n【英語の採点について】
・スペルミスは減点対象ですが、意味が通じれば大きく減点しないでください。
・文法問題では、文法の理解を重視してください。
・英作文では、文法・語彙・内容の3つの観点で評価してください。`,
          en: `\n\n【English Grading】
・Spelling errors should be noted but not heavily penalized if meaning is clear.
・For grammar questions, focus on grammatical understanding.
・For composition, evaluate grammar, vocabulary, and content.`
        }
      };

      const subjectGuidance = guidance[subject];
      if (!subjectGuidance) return '';

      return isJapanese ? subjectGuidance.ja : subjectGuidance.en;
    };

    let simplePrompt = '';

    if (isJapanese) {
      simplePrompt = `あなたは小中学生の家庭教師です。以下の画像には生徒の解答が写っています。
${getSubjectSpecificGuidance(subjectId)}

この画像を見て以下のステップで処理してください：
1. 画像内に含まれる【すべての解答済みの問題】をもれなく特定してください（1問だけではありません）。
2. 各問題について、問題の形式（記述式、記号選択、穴埋めなど）を視覚的なレイアウトから正確に把握してください。
3. 生徒の手書き解答を読み取ってください。穴埋め形式の場合は、生徒が書き込んだ言葉が前後の印字されたテキストと合わさって正しい意味を成しているかを確認してください。
4. 正誤判定をしてください。
5. 正解とフィードバックを簡潔に提供してください。

【重要】複数の問題がある場合は、必ず以下の形式のJSONの「配列（Array）」を出力してください。前置きや説明文（jsonコードブロック指定など）は絶対に含めないでください：
[
  {
    "problemNumber": "問題番号（例: '1(1)', '2(3)'）",
    "studentAnswer": "生徒の解答",
    "isCorrect": true または false,
    "correctAnswer": "正解",
    "feedback": "1〜2文の簡潔なフィードバック（正解なら褒める、不正解なら要点のみ指摘）",
    "explanation": "3〜5文以内の簡潔な解説。要点のみ。長くしない。",
    "explanationSvg": "図解SVGコード（図形・グラフ問題のみ。不要ならnull）"
  }
]

【簡潔さの原則】
・feedbackは1〜2文以内。正解時は「正解です！〇〇を正しく使えています。」程度。
・explanationは3〜5文以内。核心的な考え方のみ述べる。詳細な場合分けや複数の解法は不要。
・SVGは図形・グラフ・数直線など視覚的補助が明確に必要な場合のみ生成。文章で十分な場合はnull。

【SVG生成ルール】（必要な場合のみ）
・SVGタグのみ（xmlコードブロック指定不要）。width/height属性なし、viewBoxのみ。
・色は #333 (黒), #e74c3c (赤/強調), #3498db (青/補助) を使い分け。

JSONのみを出力してください。「はい」「承知しました」などの前置きは不要です。`;
    } else {
      // 英語プロンプト
      simplePrompt = `You are a helpful tutor for students. The image shows a student's answer(s).
${getSubjectSpecificGuidance(subjectId)}

Please analyze this image by following these steps:
1. Identify ALL answered problems in the image (do not stop at just one).
2. Understand the format of each question from the visual layout (fill-in-the-blank, multiple choice, free text, etc.).
3. Recognize the student's handwritten answer. For fill-in-the-blank, check if the handwritten word correctly completes the printed sentence.
4. Determine if the answer is correct.
5. Provide concise feedback and explanation.

【IMPORTANT】Output ONLY a JSON ARRAY. No introductory text or markdown:
[
  {
    "problemNumber": "Problem Number (e.g., '1(1)', '2(3)')",
    "studentAnswer": "Student's Answer",
    "isCorrect": true or false,
    "correctAnswer": "Correct Answer",
    "feedback": "1-2 sentences max. Praise if correct, briefly note the key point if wrong.",
    "explanation": "3-5 sentences max. Key concept only. Do not list multiple approaches.",
    "explanationSvg": "SVG code only if a diagram genuinely helps (geometry/graphs). null otherwise."
  }
]

【Brevity Rules】
- feedback: 1-2 sentences. For correct answers: "Great job! You correctly applied [concept]."
- explanation: 3-5 sentences. Core idea only. No exhaustive case analysis.
- SVG: only for geometry, graphs, or number lines. null if text suffices.

【SVG Rules】SVG tag only (no xml block). No width/height, use viewBox. Colors: #333, #e74c3c, #3498db.

Output ONLY JSON. No introductory text.`;
    }

    // Extract mime type and clean base64
    const cropMatch = croppedImageData.match(/^data:(image\/(png|jpeg));base64,(.+)$/)
    const cropData = cropMatch ? cropMatch[3] : croppedImageData.replace(/^data:image\/\w+;base64,/, '')
    const cropMime = cropMatch ? cropMatch[1] : 'image/jpeg'

    const result = await ai.models.generateContent({
      model: currentModelName,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: cropMime, data: cropData } },
            { text: simplePrompt }
          ]
        }
      ],
      config: {
        // Disable thinking mode for faster responses (2.5-flash thinks by default)
        thinkingConfig: { thinkingBudget: 0 }
      }
    })

    const responseText = result.text

    if (!responseText) {
      throw new Error('Empty response from Gemini')
    }

    // JSONを抽出（マークダウンコードブロック除去 + JSON部分を探す）
    // 開始タグ (```json など) と終了タグ(```) の両方を削除
    let jsonStr = responseText.replace(/```\w *\s * /g, '').replace(/```/g, '').trim()

    // JSON部分を抽出（オブジェクト {} または 配列 [] を検出）
    const firstBrace = jsonStr.indexOf('{')
    const firstBracket = jsonStr.indexOf('[')

    let jsonStart: number
    let jsonEnd: number

    if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
      // 配列が先に見つかった場合
      jsonStart = firstBracket
      jsonEnd = jsonStr.lastIndexOf(']')
    } else if (firstBrace !== -1) {
      // オブジェクトが先に見つかった場合
      jsonStart = firstBrace
      jsonEnd = jsonStr.lastIndexOf('}')
    } else {
      jsonStart = -1
      jsonEnd = -1
    }

    if (jsonStart !== -1 && jsonEnd > jsonStart) {
      jsonStr = jsonStr.substring(jsonStart, jsonEnd + 1)
    }

    let gradingData
    try {
      gradingData = JSON.parse(jsonStr)
    } catch (e) {
      console.error("JSON Parse Error:", e)
      console.log("Raw Response:", responseText)
      throw new Error("Failed to parse AI response")
    }

    const elapsedTime = parseFloat(((Date.now() - startTime) / 1000).toFixed(2))

    // Normalize gradingData to always be an array of problems
    let problems: any[] = []
    if (Array.isArray(gradingData)) {
      // AI returned an array of problems
      problems = gradingData.map((p: any) => ({ ...p, gradingSource: 'ai-simple' }))
    } else if (gradingData.problemNumber !== undefined) {
      // AI returned a single problem object
      problems = [{ ...gradingData, gradingSource: 'ai-simple' }]
    } else {
      // AI returned an object with numeric keys (e.g., {"0": {...}, "1": {...}})
      const numericKeys = Object.keys(gradingData).filter(k => /^\d+$/.test(k))
      if (numericKeys.length > 0) {
        problems = numericKeys.map(k => ({ ...gradingData[k], gradingSource: 'ai-simple' }))
      } else {
        // Fallback: treat as single problem
        problems = [{ ...gradingData, gradingSource: 'ai-simple' }]
      }
    }

    // AIの判定結果をサーバーサイドで検証・オーバーライド
    problems = problems.map(problem => {
      const { studentAnswer, correctAnswer, isCorrect } = problem

      // もしAIが不正解と判定していても、文字列として一致していれば正解に強制変更
      if (!isCorrect && studentAnswer && correctAnswer) {
        if (validateAndOverrideGrading(studentAnswer, correctAnswer)) {
          console.log(`[Override] AI judged incorrect, but server validation matched.Force CORRECT.Answer: "${studentAnswer}"`)
          return { ...problem, isCorrect: true, gradingSource: 'server-override' }
        }
      }
      return problem
    })

    const responseData = {
      success: true,
      modelName: currentModelName,
      responseTime: elapsedTime,
      result: {
        problems,
        overallComment: gradingData.feedback || (problems[0] && problems[0].feedback)
      }
    }

    console.log(`Grading complete.Problem: ${gradingData.problemNumber}, Correct: ${gradingData.isCorrect}`)
    res.json(responseData)

  } catch (error) {
    console.error('Error in /api/grade-work:', error)
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal Server Error',
      details: String(error)
    })
  }
})

// ==========================================
// Stripe Subscriptions
// ==========================================

app.post('/api/create-checkout-session', authenticateUser, async (req, res) => {
  try {
    const user = (req as any).user;
    const priceId = process.env.STRIPE_PRICE_ID || 'price_1234567890';
    const baseUrl = req.body?.baseUrl || req.headers.origin || 'http://localhost:5173';

    // 既存のStripe顧客IDをFirebaseから取得
    let customerId: string | undefined;
    if (admin.apps.length) {
      const userDoc = await admin.firestore().collection('users').doc(user.uid).get();
      customerId = userDoc.data()?.stripeCustomerId;
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${baseUrl}/settings?success=true`,
      cancel_url: `${baseUrl}/settings?canceled=true`,
      client_reference_id: user.uid,
      ...(customerId ? { customer: customerId } : { customer_email: user.email }),
    });

    res.json({ url: session.url });
  } catch (error: any) {
    console.error('Error creating checkout session:', error);
    res.status(500).json({ error: error.message });
  }
});

// Configure Express to parse raw body for Stripe Webhook Verification
app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }));

app.post('/api/webhooks/stripe', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    if (!sig || !endpointSecret) throw new Error('Missing stripe signature or webhok secret');
    // Important: req.body MUST be raw buffer here, so express.raw() is used above
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err: any) {
    console.error(`⚠️  Webhook signature verification failed.`, err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const uid = session.client_reference_id;

      if (uid && admin.apps.length) {
        console.log(`💰 Checkout completed for user ${uid}. Marking as premium.`);
        // Update Firestore
        await admin.firestore().collection('users').doc(uid).update({
          isPremium: true,
          stripeCustomerId: session.customer,
          stripeSubscriptionId: session.subscription,
        });
      }
    } else if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;

      if (admin.apps.length) {
        console.log(`🔴 Subscription deleted for customer ${customerId}. Removing premium status.`);
        // Note: You need to query the user by stripeCustomerId
        const usersRef = admin.firestore().collection('users');
        const snapshot = await usersRef.where('stripeCustomerId', '==', customerId).get();

        if (!snapshot.empty) {
          const docId = snapshot.docs[0].id;
          await usersRef.doc(docId).update({
            isPremium: false,
            snsRewardMinutes: 60, // Reset to free tier default
            stripeSubscriptionId: admin.firestore.FieldValue.delete(),
          });
          console.log(`User ${docId} downgraded successfully.`);
        }
      }
    }
    // Return a 200 response to acknowledge receipt of the event
    res.send();
  } catch (error) {
    console.error('Error handling webhook event:', error);
    res.status(500).send('Internal Server Error');
  }
});

app.post('/api/update-sns-time', authenticateUser, async (req, res) => {
  try {
    const user = (req as any).user;
    const { snsRewardMinutes } = req.body;

    if (typeof snsRewardMinutes !== 'number' || snsRewardMinutes < 0) {
      return res.status(400).json({ error: 'Invalid snsRewardMinutes value' });
    }

    if (!admin.apps.length) {
      return res.status(500).json({ error: 'Firebase Admin not initialized' });
    }

    // Check if the user is premium
    const userDoc = await admin.firestore().collection('users').doc(user.uid).get();
    if (!userDoc.exists || !userDoc.data()?.isPremium) {
      return res.status(403).json({ error: 'Forbidden: Only premium users can update SNS time' });
    }

    // Update the value
    await admin.firestore().collection('users').doc(user.uid).update({
      snsRewardMinutes
    });

    res.json({ success: true, snsRewardMinutes });
  } catch (error: any) {
    console.error('Error updating SNS time:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/create-portal-session', authenticateUser, async (req, res) => {
  try {
    const user = (req as any).user;
    const userDoc = await admin.firestore().collection('users').doc(user.uid).get();
    const customerId = userDoc.data()?.stripeCustomerId;

    if (!customerId) {
      return res.status(400).json({ error: 'No Stripe customer found for this user' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${req.headers.origin || 'http://localhost:5173'}/settings`,
    });

    res.json({ url: session.url });
  } catch (error: any) {
    console.error('Error creating portal session:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`)
})
