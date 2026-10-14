/**
 * ViewModeSwitch: UI toggle button for First-Person / Third-Person view mode
 */
export class ViewModeSwitch {
  constructor(container, engine) {
    this.container = container;
    this.engine = engine;
    this.element = document.createElement('div');
    this.element.className = 'view-mode-pill';
    this.element.title = '快捷键 V：切换第一人称 / 第三人称视角';
    this.element.innerHTML = `
      <span class="view-icon">👁️</span>
      <span class="view-label">第一人称 (按V)</span>
    `;

    this.container.appendChild(this.element);
    this._bindEvents();
  }

  _bindEvents() {
    this.element.addEventListener('click', () => {
      this.engine.toggleViewMode();
    });

    this.engine.on('viewModeChange', (mode) => {
      const isThird = (mode === 'THIRD_PERSON');
      this.element.querySelector('.view-icon').textContent = isThird ? '👤' : '👁️';
      this.element.querySelector('.view-label').textContent = isThird ? '第三人称 (按V)' : '第一人称 (按V)';
      if (isThird) {
        this.element.classList.add('third-person');
      } else {
        this.element.classList.remove('third-person');
      }
    });
  }
}
