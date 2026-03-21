import { useTranslation } from 'react-i18next'
import { GradingResponseResult } from '../../services/api'
import { SNSLinkRecord } from '../../utils/indexedDB'
import { getSNSIcon } from '../../constants/sns'
import './GradingResult.css'

interface GradingResultProps {
  result: GradingResponseResult | null
  snsLinks?: SNSLinkRecord[]
  timeLimitMinutes?: number
  modelName?: string | null
  responseTime?: number | null
  pdfId?: string
}

const GradingResult = ({ result, snsLinks = [], timeLimitMinutes = 30, modelName, responseTime, pdfId }: GradingResultProps) => {
  const { t } = useTranslation()

  const validProblems = result?.problems?.filter(problem =>
    problem.problemNumber !== null && problem.isCorrect !== null
  ) || []

  const openSNSSelectionPage = () => {
    const snsLinksJson = JSON.stringify(snsLinks.map(link => {
      const snsIcon = getSNSIcon(link.id)
      return {
        id: link.id,
        name: link.name,
        url: link.url.startsWith('http://') || link.url.startsWith('https://') ? link.url : 'https://' + link.url,
        icon: link.icon,
        svg: snsIcon?.svg || null,
        color: snsIcon?.color || '#666'
      }
    }))
    const baseUrl = `${window.location.origin}${import.meta.env.BASE_URL || '/'}`
    const returnUrl = pdfId ? `${baseUrl}?pdfId=${encodeURIComponent(pdfId)}` : baseUrl
    const manageUrl = `${baseUrl}manage.html?time=${timeLimitMinutes}&snsLinks=${encodeURIComponent(snsLinksJson)}&returnUrl=${encodeURIComponent(returnUrl)}`
    window.location.replace(manageUrl)
  }

  return (
    <div className="grading-result-content">
      <div className="result-content">
        <div className="result-inner">
          {result && validProblems.length > 0 ? (
            <div className="problems-list">
              {validProblems.map((problem, index) => (
                <div key={index} className={`problem-item ${problem.isCorrect ? 'correct' : 'incorrect'}`}>
                  <div className="problem-header">
                    <span className="result-icon">{problem.isCorrect ? '⭕' : '❌'}</span>
                    <h3>{problem.problemNumber || `${t('gradingResult.problem')} ${index + 1}`}</h3>
                  </div>

                  {problem.problemText && <div className="problem-text">{problem.problemText}</div>}

                  {problem.studentAnswer && (
                    <div className="student-answer">
                      <strong>{t('gradingResult.yourAnswer')}</strong> {problem.studentAnswer}
                    </div>
                  )}

                  {!problem.isCorrect && problem.correctAnswer && (
                    <div className="correct-answer">
                      <strong>{t('gradingResult.correctAnswer')}</strong> {problem.correctAnswer}
                    </div>
                  )}

                  {problem.feedback && (
                    <div className="feedback">
                      <strong>{t('gradingResult.feedback')}</strong>
                      <p>{problem.feedback}</p>
                    </div>
                  )}

                  {problem.explanation && (
                    <div className="explanation">
                      <strong>{t('gradingResult.explanation')}</strong>
                      <p>{problem.explanation}</p>
                      {problem.explanationSvg && (
                        <div className="explanation-svg-container" dangerouslySetInnerHTML={{ __html: problem.explanationSvg }} />
                      )}
                    </div>
                  )}

                  <div className="grading-source" style={{
                    backgroundColor: problem.gradingSource === 'db' ? '#e8f5e9' : '#fff3e0'
                  }}>
                    <strong>{t('gradingResult.gradingSource')}</strong>{' '}
                    {problem.gradingSource === 'db' ? (
                      <span style={{ color: '#2e7d32' }}>
                        {t('gradingResult.sourceDb')}
                        {problem.dbMatchedAnswer && (
                          <span style={{ display: 'block', marginTop: '4px', fontSize: '11px' }}>
                            {t('gradingResult.problemPage')}: {problem.dbMatchedAnswer.problemPageNumber ?? '不明'},
                            {t('gradingResult.registeredAnswer')}: {problem.dbMatchedAnswer.correctAnswer}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span style={{ color: '#e65100' }}>{t('gradingResult.sourceAi')}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="raw-response">
              <p>{result?.overallComment || result?.rawResponse}</p>
            </div>
          )}

          {result?.overallComment && validProblems.length > 0 && (
            <div className="overall-comment">
              <h3>{t('gradingResult.overallComment')}</h3>
              <p>{result.overallComment}</p>
            </div>
          )}

          {snsLinks.length > 0 && (
            <div className="sns-links-section">
              <h3 style={{ fontSize: '16px', fontWeight: 'bold', color: '#2c3e50', marginBottom: '12px', textAlign: 'center' }}>Enjoy!</h3>
              <button
                onClick={openSNSSelectionPage}
                style={{
                  width: '100%', padding: '20px', fontSize: '18px', fontWeight: 'bold',
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: 'white', border: 'none', borderRadius: '16px', cursor: 'pointer',
                  transition: 'all 0.2s ease', boxShadow: '0 4px 12px rgba(102, 126, 234, 0.3)'
                }}
              >
                {t('gradingResult.viewSns')}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="model-info-footer">
        <div className="model-info-text">
          {modelName && responseTime != null
            ? `${modelName} (${responseTime}s)`
            : modelName || (responseTime != null ? `${responseTime}s` : '')}
        </div>
      </div>
    </div>
  )
}

export default GradingResult
