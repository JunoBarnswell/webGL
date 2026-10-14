/**
 * PanoramaToolbar: 720 Panorama free-look toggle and 720 snapshot exporter button
 */
export class PanoramaToolbar {
  constructor(container, engine) {
    this.container = container;
    this.engine = engine;
    this.element = document.createElement('div');
    this.element.className = 'panorama-toolbar-group';
    this.element.innerHTML = `
      <button class="pano-btn pano-mode-btn" title="开启 720° 全景沉浸环视模式 (滚轮可拉近/拉远)">
        <span class="icon">🔄</span> 720°全景模式
      </button>
      <button class="pano-btn pano-export-btn" title="导出当前机位 720° 全景大图 (2:1 等距柱状投影)">
        <span class="icon">📸</span> 导出全景图
      </button>
    `;

    this.container.appendChild(this.element);

    this.modeBtn = this.element.querySelector('.pano-mode-btn');
    this.exportBtn = this.element.querySelector('.pano-export-btn');

    this._bindEvents();
  }

  _bindEvents() {
    this.modeBtn.addEventListener('click', () => {
      this.engine.togglePanorama();
    });

    this.exportBtn.addEventListener('click', async () => {
      this.exportBtn.textContent = '⏳ 正在烘焙全景图...';
      this.exportBtn.disabled = true;
      try {
        await this.engine.export720Panorama(2048, 1024);
      } catch (err) {
        console.error('Export failed:', err);
      } finally {
        this.exportBtn.innerHTML = '<span class="icon">📸</span> 导出全景图';
        this.exportBtn.disabled = false;
      }
    });

    this.engine.on('panoramaModeChange', ({ enabled }) => {
      if (enabled) {
        this.modeBtn.classList.add('active');
        this.modeBtn.innerHTML = '<span class="icon">🔄</span> 退出720全景';
      } else {
        this.modeBtn.classList.remove('active');
        this.modeBtn.innerHTML = '<span class="icon">🔄</span> 720°全景模式';
      }
    });
  }
}
