/**
 * AudioControl: Top-right music button and controls helper
 */
export class AudioControl {
  constructor(container, engine) {
    this.container = container;
    this.engine = engine;
    this.element = document.createElement('div');
    this.element.className = 'top-controls-bar';
    this.element.innerHTML = `
      <div class="control-tip-pill">
        <span class="icon">⌨️</span> WASD 漫游行走 · 鼠标拖拽视角
      </div>
      <button class="music-toggle-btn" title="开关展厅音乐">
        <span class="music-icon">🎵</span>
        <span class="music-wave">
          <i></i><i></i><i></i><i></i>
        </span>
      </button>
    `;
    this.container.appendChild(this.element);

    this.musicBtn = this.element.querySelector('.music-toggle-btn');
    this.wave = this.element.querySelector('.music-wave');

    this._bindEvents();
  }

  _bindEvents() {
    this.musicBtn.addEventListener('click', () => {
      this.engine.toggleAudio();
    });

    this.engine.on('audioStateChange', ({ isPlaying, isMuted }) => {
      if (isPlaying && !isMuted) {
        this.musicBtn.classList.add('playing');
      } else {
        this.musicBtn.classList.remove('playing');
      }
    });

    // Start audio on first user interaction if not already started
    const startAudioOnce = () => {
      this.engine.audio.play();
      window.removeEventListener('pointerdown', startAudioOnce);
      window.removeEventListener('keydown', startAudioOnce);
    };
    window.addEventListener('pointerdown', startAudioOnce, { once: true });
    window.addEventListener('keydown', startAudioOnce, { once: true });
  }
}
