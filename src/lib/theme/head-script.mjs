// Theme bootstrap shared by the page head, the theme control and the build configuration.
//
// HEAD_SCRIPT runs as the first element of <head>, before any stylesheet, so the page is
// painted in the right theme from the first frame. It must stay small, dependency free and
// written in ES5-level syntax. The build hashes this exact string into the page's
// Content-Security-Policy, so any edit here is picked up automatically.

export const THEME_STORAGE_KEY = 'rmf-theme';

/** @type {readonly ['dark', 'light', 'system']} */
export const THEME_CHOICES = ['dark', 'light', 'system'];

export const DEFAULT_THEME = 'dark';

export const HEAD_SCRIPT =
  '(function(){' +
  'var d=document.documentElement,c="dark",t;' +
  'try{var s=window.localStorage.getItem("' + THEME_STORAGE_KEY + '");' +
  'if(s==="dark"||s==="light"||s==="system")c=s}catch(e){}' +
  't=c;' +
  'if(c==="system"){t="dark";try{if(window.matchMedia("(prefers-color-scheme: light)").matches)t="light"}catch(e){}}' +
  'd.setAttribute("data-theme",t);' +
  'd.setAttribute("data-theme-choice",c);' +
  'd.classList.add("js")' +
  '})();';
