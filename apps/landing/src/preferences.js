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
  syncLanguageMenu();
}

/*
 * shadcn-style language dropdown.
 * The landing is plain HTML, so the React shadcn <Select> cannot be used here.
 * We rebuild its look and keyboard behaviour in vanilla JS instead.
 * The native <select> stays in the page as the source of truth (it keeps the
 * existing change handler working). We only hide it from users and screen readers.
 */
const languageLabel = document.querySelector('label[for="language"]');
const languageTrigger = document.createElement('button');
const languageMenu = document.createElement('ul');
const languageItems = [...languageSelect.options].map((option, index) => {
  const item = document.createElement('li');
  item.id = `language-option-${index}`;
  item.setAttribute('role', 'option');
  item.dataset.value = option.value;
  item.lang = option.lang;
  item.innerHTML = `<span>${option.textContent}</span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return item;
});
let activeItem = 0;

function setActiveItem(index) {
  activeItem = index;
  languageItems.forEach((item, i) => item.classList.toggle('is-active', i === index));
  languageTrigger.setAttribute('aria-activedescendant', languageItems[index].id);
}
function toggleLanguageMenu(open) {
  languageMenu.hidden = !open;
  languageTrigger.setAttribute('aria-expanded', String(open));
  if (open) setActiveItem(languageSelect.selectedIndex);
  else languageTrigger.removeAttribute('aria-activedescendant');
}
function chooseLanguage(index) {
  languageSelect.value = languageItems[index].dataset.value;
  // Fire the same event a native select would, so the handler below saves the choice.
  languageSelect.dispatchEvent(new Event('change'));
  toggleLanguageMenu(false);
}
// Keeps the visible trigger and the checked item in step with the native select.
function syncLanguageMenu() {
  languageTrigger.firstChild.textContent = languageSelect.selectedOptions[0].textContent;
  languageItems.forEach((item, i) => item.setAttribute('aria-selected', String(i === languageSelect.selectedIndex)));
}

languageLabel.id = 'language-label';
languageSelect.classList.add('sr-only');
languageSelect.setAttribute('aria-hidden', 'true');
languageSelect.tabIndex = -1;
languageTrigger.type = 'button';
languageTrigger.className = 'language-trigger';
languageTrigger.setAttribute('role', 'combobox');
languageTrigger.setAttribute('aria-haspopup', 'listbox');
languageTrigger.setAttribute('aria-controls', 'language-menu');
languageTrigger.setAttribute('aria-labelledby', 'language-label');
languageTrigger.setAttribute('aria-expanded', 'false');
languageTrigger.innerHTML = '<span></span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
languageMenu.id = 'language-menu';
languageMenu.className = 'language-menu';
languageMenu.setAttribute('role', 'listbox');
languageMenu.setAttribute('aria-labelledby', 'language-label');
languageMenu.hidden = true;
languageMenu.append(...languageItems);
languageSelect.after(languageTrigger, languageMenu);

languageTrigger.addEventListener('click', () => toggleLanguageMenu(languageMenu.hidden));
languageMenu.addEventListener('click', (event) => {
  const index = languageItems.indexOf(event.target.closest('li'));
  if (index !== -1) chooseLanguage(index);
});
languageMenu.addEventListener('mousemove', (event) => {
  const index = languageItems.indexOf(event.target.closest('li'));
  if (index !== -1) setActiveItem(index);
});
// Clicking anywhere else closes the menu.
document.addEventListener('click', (event) => {
  if (!event.target.closest('.preferences > .language-trigger, .language-menu')) toggleLanguageMenu(false);
});
languageTrigger.addEventListener('keydown', (event) => {
  const isOpen = !languageMenu.hidden;
  if (event.key === 'Escape') toggleLanguageMenu(false);
  else if (event.key === 'Tab') toggleLanguageMenu(false);
  else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (!isOpen) toggleLanguageMenu(true);
    else setActiveItem((activeItem + (event.key === 'ArrowDown' ? 1 : -1) + languageItems.length) % languageItems.length);
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    if (isOpen) chooseLanguage(activeItem);
    else toggleLanguageMenu(true);
  } else if (event.key.length === 1) {
    // Typeahead, like a native select: "e" picks English.
    // The search starts after the current item (and wraps), as native selects do.
    const from = isOpen ? activeItem : languageSelect.selectedIndex;
    const ordered = languageItems.map((_, i) => (from + 1 + i) % languageItems.length);
    const match = ordered.find((i) => languageItems[i].textContent.toLowerCase().startsWith(event.key.toLowerCase()));
    if (match === undefined) return;
    if (isOpen) setActiveItem(match);
    else chooseLanguage(match);
  }
});

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
