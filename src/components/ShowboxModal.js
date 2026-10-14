/**
 * ShowboxModal: High-resolution artwork detail dialog triggered by raycast clicks
 */
export class ShowboxModal {
  constructor(container) {
    this.container = container;
    this.element = document.createElement('div');
    this.element.className = 'showbox-modal hidden';
    this.element.innerHTML = `
      <div class="showbox-backdrop"></div>
      <div class="showbox-dialog">
        <button class="showbox-close-btn" title="关闭">&times;</button>
        <div class="showbox-body">
          <div class="showbox-image-wrap">
            <img class="showbox-img" src="" alt="作品大图" />
          </div>
          <div class="showbox-info">
            <h3 class="showbox-title">油画作品鉴赏</h3>
            <div class="showbox-tags">
              <span class="tag">油画原作</span>
              <span class="tag">沉浸式鉴赏</span>
            </div>
            <p class="showbox-desc">本幅油画作品运用了层次丰富的笔触与光影对比，展现了艺术家的深刻情感表达与独特的视觉张力。</p>
            <div class="showbox-actions">
              <button class="action-btn zoom-btn">🔍 查看原图</button>
            </div>
          </div>
        </div>
      </div>
    `;
    this.container.appendChild(this.element);

    this.backdrop = this.element.querySelector('.showbox-backdrop');
    this.closeBtn = this.element.querySelector('.showbox-close-btn');
    this.imgEl = this.element.querySelector('.showbox-img');
    this.titleEl = this.element.querySelector('.showbox-title');
    this.zoomBtn = this.element.querySelector('.zoom-btn');

    this._currentUrl = '';
    this._bindEvents();
  }

  _bindEvents() {
    this.backdrop.addEventListener('click', () => this.hide());
    this.closeBtn.addEventListener('click', () => this.hide());
    this.zoomBtn.addEventListener('click', () => {
      if (this._currentUrl) {
        window.open(this._currentUrl, '_blank');
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.element.classList.contains('hidden')) {
        this.hide();
      }
    });
  }

  show(artwork) {
    if (!artwork) return;
    this._currentUrl = artwork.url || artwork.preview || '';
    this.imgEl.src = this._currentUrl;
    this.titleEl.textContent = artwork.name || '油画作品鉴赏';

    this.element.classList.remove('hidden');
    this.element.classList.add('visible');
  }

  hide() {
    this.element.classList.remove('visible');
    setTimeout(() => {
      this.element.classList.add('hidden');
    }, 200);
  }
}
