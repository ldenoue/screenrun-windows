let p = window.api.platform()
if (p && p !== 'darwin')
  document.body.classList.add('square')