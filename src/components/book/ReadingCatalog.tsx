import { FiDownload, FiExternalLink } from 'react-icons/fi'
import { useDoriTranslation } from '../../i18n'
import './ReadingCatalog.css'

interface ReadingSite {
  name: string
  description: string
  url: string
  pdfHint: string
}

export default function ReadingCatalog() {
  const { t } = useDoriTranslation()
  const catalogKey = 'readingCatalog'
  const sites = t(`${catalogKey}.sites`, { returnObjects: true }) as ReadingSite[]

  return (
    <section className="reading-catalog">
      <h2>{t('readingCatalog.title')}</h2>
      <p className="reading-catalog-intro">{t('readingCatalog.description')}</p>
      <ul className="reading-catalog-sites">
        {sites.map(site => (
          <li key={site.url} className="reading-catalog-site">
            <h3>{site.name}</h3>
            <p>{site.description}</p>
            <p className="reading-catalog-pdf-hint">
              <FiDownload aria-hidden="true" />
              <span>{site.pdfHint}</span>
            </p>
            <a
              href={site.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t('readingCatalog.openSiteLabel', { name: site.name })}
            >
              {t('readingCatalog.openSite')}
              <FiExternalLink aria-hidden="true" />
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
