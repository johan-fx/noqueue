const languageSelect = document.querySelector('#language');
const themeToggle = document.querySelector('.theme-toggle');
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
const translations = [...document.querySelectorAll('[data-en], [data-en-aria-label], [data-en-content]')].map((element) => ({
  element,
  spanishHTML: element.innerHTML,
  spanishLabel: element.getAttribute('aria-label'),
  spanishContent: element.getAttribute('content'),
}));

function readPreference(key) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function savePreference(key, value) {
  try { window.localStorage.setItem(key, value); } catch { /* Controls still work without persistence. */ }
}

function setLanguage(language) {
  document.documentElement.lang = language;
  languageSelect.value = language;
  for (const { element, spanishHTML, spanishLabel, spanishContent } of translations) {
    // Both translations are trusted, authored HTML; no user or remote content is accepted.
    if (element.hasAttribute('data-en')) element.innerHTML = language === 'en' ? element.dataset.en : spanishHTML;
    if (spanishLabel !== null) element.setAttribute('aria-label', language === 'en' ? element.dataset.enAriaLabel : spanishLabel);
    if (spanishContent !== null) element.setAttribute('content', language === 'en' ? element.dataset.enContent : spanishContent);
  }
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeToggle.setAttribute('aria-checked', String(theme === 'dark'));
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#111318' : '#ffffff');
}

const savedTheme = readPreference('noqueue.theme');
let explicitTheme = savedTheme === 'dark' || savedTheme === 'light' ? savedTheme : null;
setLanguage(readPreference('noqueue.language') === 'en' ? 'en' : 'es');
setTheme(explicitTheme ?? (systemTheme.matches ? 'dark' : 'light'));
document.querySelector('.preferences').hidden = false;

languageSelect.addEventListener('change', () => {
  const language = languageSelect.value === 'en' ? 'en' : 'es';
  setLanguage(language);
  savePreference('noqueue.language', language);
});
themeToggle.addEventListener('click', () => {
  explicitTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  setTheme(explicitTheme);
  savePreference('noqueue.theme', explicitTheme);
});
systemTheme.addEventListener('change', (event) => {
  if (explicitTheme === null) setTheme(event.matches ? 'dark' : 'light');
});
