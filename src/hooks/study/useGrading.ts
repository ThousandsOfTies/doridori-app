import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GradingResponseResult, gradeWork } from '../../services/api';
import { saveGradingHistory, generateGradingHistoryId } from '../../utils/indexedDB';

export const useGrading = (
    pdfId: string,
    addStatusMessage: (msg: string) => void,
    pageNumber: number = 1,
    fileName: string = 'Unknown',
    subjectId?: string  // Add subjectId parameter
) => {
    const { t, i18n } = useTranslation();
    const [isGrading, setIsGrading] = useState(false);
    const [gradingResult, setGradingResult] = useState<GradingResponseResult | null>(null);
    const [selectionPreview, setSelectionPreview] = useState<string | null>(null);

    // 採点実行
    const executeGrading = async (
        croppedImageData: string,
        selectedModel?: string
    ) => {
        setIsGrading(true);
        setGradingResult(null); // 前回の結果をクリア
        addStatusMessage('🤖 AI採点中... (10〜30秒ほどかかります)');

        try {
            // API呼び出し（教科IDを含める）
            const response: any = await gradeWork(
                croppedImageData,
                selectedModel !== 'default' ? selectedModel : undefined,
                i18n.language,
                subjectId  // Pass subject ID for subject-specific grading
            );

            if (!response.success && response.error) {
                throw new Error(response.error);
            }

            // 結果の抽出
            // API returns { success: true, result: GradingResponseResult, modelName: ... }
            const result: GradingResponseResult = response.result || response;

            setGradingResult(result);

            // 履歴に保存
            // Flatten problems for history
            const problems = result.problems || [];

            for (const problem of problems) {
                const historyId = generateGradingHistoryId();
                await saveGradingHistory({
                    id: historyId,
                    pdfId: pdfId,
                    pdfFileName: fileName,
                    pageNumber: pageNumber,
                    problemNumber: problem.problemNumber || '?',
                    studentAnswer: problem.studentAnswer || '',
                    isCorrect: problem.isCorrect || false,
                    correctAnswer: problem.correctAnswer || '',
                    feedback: problem.feedback || '',
                    explanation: problem.explanation || '',
                    timestamp: Date.now(),
                    imageData: croppedImageData,
                    matchingMetadata: {
                        method: 'ai',
                        reasoning: problem.positionReasoning
                    }
                });
            }

            addStatusMessage(`✨ 採点完了 (${problems.length}問)`);
            return true;

        } catch (error) {
            console.error('Grading failed:', error);
            addStatusMessage('❌ 採点エラー: ' + (error instanceof Error ? error.message : '不明なエラー'));
            return false;
        } finally {
            setIsGrading(false);
        }
    };

    const clearGradingResult = () => {
        setGradingResult(null);
        setSelectionPreview(null);
    };

    return {
        isGrading,
        setIsGrading, // Expose setter
        gradingResult,
        setGradingResult,
        selectionPreview,
        setSelectionPreview,
        executeGrading,
        clearGradingResult
    };
};
