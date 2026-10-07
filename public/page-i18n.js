export function createPageTranslator(resources) {
  return (key, values = {}) => {
    const message = key.split('.').reduce((value, part) => value?.[part], resources);
    if (typeof message !== 'string') throw new Error(`Missing page translation: ${key}`);
    return message.replace(/{{(\w+)}}/g, (_, name) => String(values[name] ?? `{{${name}}}`));
  };
}

// The JSON files are copied from src/i18n/locales for both development and publication.
export async function loadPageTranslations() {
  const saved = localStorage.getItem('language');
  const language = (saved || navigator.language).startsWith('ja') ? 'ja' : 'en';
  const response = await fetch(new URL(`./locales/${language}/translation.json`, import.meta.url));
  if (!response.ok) throw new Error(`Could not load page translations: ${response.status}`);
  const t = createPageTranslator(await response.json());
  document.documentElement.lang = language;
  document.querySelectorAll('[data-i18n]').forEach(element => {
    element.textContent = t(element.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-lines]').forEach(element => {
    const lines = t(element.getAttribute('data-i18n-lines')).split('\n');
    element.replaceChildren();
    lines.forEach((line, index) => {
      if (index) element.append(document.createElement('br'));
      element.append(document.createTextNode(line));
    });
  });
  return t;
}
