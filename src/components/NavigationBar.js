/**
 * NavigationBar: Bottom floating bar for switching exhibition zones
 */
export class NavigationBar {
  constructor(container, engine) {
    this.container = container;
    this.engine = engine;
    this.element = document.createElement('div');
    this.element.className = 'navigation-bar';
    this.buttons = new Map();

    this._render();
    this.container.appendChild(this.element);

    // Sync active state when zone changes from engine
    this.engine.on('zoneChange', (zone) => {
      this.setActive(zone.key);
    });

    // Smoothly fade out navigation bar during cruise tour, restore when cruise stops/exits
    this.engine.on('cruiseStateChange', ({ isPlaying, progress }) => {
      if (isPlaying) {
        this.element.classList.add('nav-fade-out');
      } else {
        if (progress === 0) {
          this.element.classList.remove('nav-fade-out');
        }
      }
    });
  }

  _render() {
    const zones = this.engine.getAllZones();
    this.element.innerHTML = '';

    for (const zone of zones) {
      const btn = document.createElement('button');
      btn.className = 'nav-zone-btn';
      btn.dataset.key = zone.key;
      btn.innerHTML = `
        <span class="zone-badge">${zone.key.toUpperCase()}</span>
        <span class="zone-label">${zone.name}</span>
      `;

      btn.addEventListener('click', () => {
        this.engine.flyToZone(zone.key);
        this.setActive(zone.key);
      });

      this.buttons.set(zone.key, btn);
      this.element.appendChild(btn);
    }

    // Default entrance active
    this.setActive('entrance');
  }

  setActive(key) {
    for (const [k, btn] of this.buttons) {
      if (k === key) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    }
  }
}
