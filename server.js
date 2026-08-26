// ===== ИСПРАВЛЕННАЯ РЕГИСТРАЦИЯ =====
function initRegistration() {
  const saved = localStorage.getItem('r3d_name');
  if (saved && saved.length >= 2 && saved.length <= 16) {
    State.playerName = saved;
    DOM.regModal.style.display = 'none';
    return;
  }

  // Используем addEventListener вместо onclick для надежности
  DOM.regInput.addEventListener('input', () => {
    const v = DOM.regInput.value.trim();
    const isValid = v.length >= 2 && v.length <= 16;
    
    DOM.regError.textContent = isValid ? '' : 
      (v.length === 0 ? '' : (v.length < 2 ? 'Минимум 2 символа' : 'Максимум 16'));
    DOM.regBtn.disabled = !isValid;
  });

  // Надежная обработка клика
  DOM.regBtn.addEventListener('click', () => {
    const name = DOM.regInput.value.trim();
    if (name.length >= 2 && name.length <= 16) {
      State.playerName = name;
      localStorage.setItem('r3d_name', name);
      DOM.regModal.style.display = 'none';
      console.log("✅ Игрок зарегистрирован:", State.playerName);
    }
  });
  
  // Обработка Enter
  DOM.regInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !DOM.regBtn.disabled) {
      DOM.regBtn.click();
    }
  });
  
  // Фокус на поле ввода
  setTimeout(() => DOM.regInput.focus(), 100);
}
