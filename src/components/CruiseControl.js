/**
 * CruiseControl: Automated tour cruise player widget with play, pause, seek, and speed controls
 */
export class CruiseControl {
  constructor(container, engine) {
    this.container = container;
    this.engine = engine;
    this.element = document.createElement('div');
    this.element.className = 'cruise-widget';
    this.element.innerHTML = `
      <button class="cruise-main-toggle-btn" title="开启展厅自动巡航游览">
        <span class="icon">🚀</span> 自动巡航导览
      </button>

      <div class="cruise-player-panel hidden">
        <button class="cruise-play-btn" title="播放/暂停">⏸</button>
        <span class="cruise-status-text">正在自动巡航中...</span>
        <input type="range" class="cruise-slider" min="0" max="1000" value="0" />
        <button class="cruise-speed-btn" title="调节巡航倍速">1.0x</button>
        <button class="cruise-exit-btn" title="退出巡航">✕</button>
      </div>
    `;

    this.container.appendChild(this.element);

    this.mainToggleBtn = this.element.querySelector('.cruise-main-toggle-btn');
    this.playerPanel = this.element.querySelector('.cruise-player-panel');
    this.playBtn = this.element.querySelector('.cruise-play-btn');
    this.slider = this.element.querySelector('.cruise-slider');
    this.speedBtn = this.element.querySelector('.cruise-speed-btn');
    this.exitBtn = this.element.querySelector('.cruise-exit-btn');
    this.statusText = this.element.querySelector('.cruise-status-text');

    this.speeds = [1.0, 1.5, 2.0];
    this.speedIdx = 0;
    this.isDraggingSlider = false;

    this._bindEvents();
  }

  _bindEvents() {
    this.mainToggleBtn.addEventListener('click', () => {
      this.engine.startCruise();
    });

    this.playBtn.addEventListener('click', () => {
      this.engine.toggleCruise();
    });

    this.speedBtn.addEventListener('click', () => {
      this.speedIdx = (this.speedIdx + 1) % this.speeds.length;
      const speed = this.speeds[this.speedIdx];
      this.speedBtn.textContent = `${speed.toFixed(1)}x`;
      this.engine.setCruiseSpeed(speed);
    });

    this.exitBtn.addEventListener('click', () => {
      this.engine.cruise.stop();
    });

    this.slider.addEventListener('input', () => {
      this.isDraggingSlider = true;
      const progress = parseInt(this.slider.value, 10) / 1000;
      this.engine.seekCruise(progress);
    });

    this.slider.addEventListener('change', () => {
      this.isDraggingSlider = false;
    });

    // Engine event subscriptions
    this.engine.on('cruiseStateChange', ({ isPlaying, progress, speed }) => {
      if (isPlaying) {
        this.element.classList.add('cruise-active');
        this.mainToggleBtn.classList.add('hidden');
        this.playerPanel.classList.remove('hidden');
        this.playBtn.textContent = '⏸';
        this.statusText.textContent = '正在自动巡航中...';
      } else {
        if (progress === 0) {
          // Stopped
          this.element.classList.remove('cruise-active');
          this.mainToggleBtn.classList.remove('hidden');
          this.playerPanel.classList.add('hidden');
        } else {
          // Paused
          this.element.classList.add('cruise-active');
          this.playBtn.textContent = '▶';
          this.statusText.textContent = '巡航已暂停 (按键或继续)';
        }
      }
    });

    this.engine.on('cruiseProgress', ({ progress }) => {
      if (!this.isDraggingSlider) {
        this.slider.value = Math.round(progress * 1000);
      }
    });

    this.engine.on('cruiseDwell', (stop) => {
      this.statusText.textContent = `📍 正在停驻导览: ${stop.name}`;
    });
  }
}
