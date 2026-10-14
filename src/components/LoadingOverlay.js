/**
 * LoadingOverlay: Fullscreen loading screen with progress percentage
 */
export class LoadingOverlay {
  constructor(container) {
    this.container = container;
    this.element = document.createElement('div');
    this.element.className = 'loading-overlay';
    this.element.innerHTML = `
      <div class="loading-content">
        <div class="loading-logo">
          <div class="logo-spinner"></div>
          <h2>油画作品线上鉴赏展</h2>
          <p class="sub-title">虚拟现实 3D 展厅加载中</p>
        </div>
        <div class="progress-bar-container">
          <div class="progress-bar" id="load-progress-bar"></div>
        </div>
        <div class="progress-text" id="load-progress-text">正在解析三维空间数据... 0%</div>
      </div>
    `;
    this.container.appendChild(this.element);

    this.bar = this.element.querySelector('#load-progress-bar');
    this.text = this.element.querySelector('#load-progress-text');
  }

  update(percent, loaded, total) {
    if (this.bar) this.bar.style.width = `${percent}%`;
    if (this.text) this.text.textContent = `正在构建 3D 空间资产... ${percent}% (${loaded}/${total})`;
  }

  hide() {
    this.element.classList.add('fade-out');
    setTimeout(() => {
      if (this.element.parentNode) {
        this.element.parentNode.removeChild(this.element);
      }
    }, 600);
  }
}
