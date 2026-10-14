/**
 * AudioSystem: Manages exhibition background music and voice guide audio
 */
export class AudioSystem {
  constructor(bgmUrl = '', eventEmitter = null) {
    this.bgmUrl = bgmUrl;
    this.events = eventEmitter;
    this.bgmAudio = new Audio();
    this.bgmAudio.loop = true;
    this.bgmAudio.volume = 0.5;

    this.voiceAudio = new Audio();
    this.voiceAudio.volume = 0.8;

    this.isPlaying = false;
    this.isMuted = false;

    if (this.bgmUrl) {
      this.bgmAudio.src = this.bgmUrl;
    }
  }

  setBgm(url) {
    this.bgmUrl = url;
    this.bgmAudio.src = url;
  }

  play() {
    this.bgmAudio.play().then(() => {
      this.isPlaying = true;
      if (this.events) this.events.emit('audioStateChange', { isPlaying: true, isMuted: this.isMuted });
    }).catch((err) => {
      console.warn('[AudioSystem] Autoplay blocked, awaiting user gesture:', err);
    });
  }

  pause() {
    this.bgmAudio.pause();
    this.isPlaying = false;
    if (this.events) this.events.emit('audioStateChange', { isPlaying: false, isMuted: this.isMuted });
  }

  toggle() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    this.bgmAudio.muted = this.isMuted;
    this.voiceAudio.muted = this.isMuted;
    if (this.events) this.events.emit('audioStateChange', { isPlaying: this.isPlaying, isMuted: this.isMuted });
  }

  playVoice(url) {
    if (!url) return;
    this.voiceAudio.src = url;
    // Lower BGM temporarily
    const prevVol = this.bgmAudio.volume;
    this.bgmAudio.volume = 0.15;

    this.voiceAudio.play().then(() => {
      this.voiceAudio.onended = () => {
        this.bgmAudio.volume = prevVol;
      };
    }).catch(console.warn);
  }

  stopVoice() {
    this.voiceAudio.pause();
    this.voiceAudio.currentTime = 0;
  }
}
