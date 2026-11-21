/**
 * Gestionnaire audio et vidéo WebRTC en maillage direct (aucun serveur STUN/TURN externe).
 *
 * - Les permissions micro/caméra ne sont demandées qu'à la demande explicite du joueur.
 * - En contexte non sécurisé (ex. HTTP sur IP LAN), signale l'indisponibilité sans échouer en silence.
 * - Utilise le patron « Perfect Negotiation » (pair poli si `myId > peerId`) pour éviter toute collision.
 */
import type { Settings } from '../world/Storage';
import type { MultiplayerClient } from './Client';
import type { RemotePlayerState } from './Protocol';

export const INSECURE_MEDIA_MESSAGE =
  'Audio et vidéo indisponibles ici : utilisez l’application Android ou le lien Tailscale';

export interface VoicePeerView {
  id: number;
  name: string;
  micOn: boolean;
  camOn: boolean;
  speaking: boolean;
  mutedByMe: boolean;
  volume: number;
  videoStream: MediaStream | null;
  hasRemoteAudio: boolean;
  connected: boolean;
}

interface PeerState {
  id: number;
  name: string;
  pc: RTCPeerConnection;
  remoteStream: MediaStream;
  audioEl: HTMLAudioElement;
  audioSender: RTCRtpSender | null;
  videoSender: RTCRtpSender | null;
  makingOffer: boolean;
  ignoreOffer: boolean;
  isSettingRemoteAnswerPending: boolean;
  mutedByMe: boolean;
  remoteMic: boolean;
  remoteCam: boolean;
  remoteSpeaking: boolean;
  localSpeaking: boolean;
  hasRemoteAudio: boolean;
  hasRemoteVideo: boolean;
  analyser: AnalyserNode | null;
  analyserData: Uint8Array<ArrayBuffer> | null;
  connected: boolean;
}

export class VoiceVideoManager {
  private readonly peers = new Map<number, PeerState>();
  private localAudioTrack: MediaStreamTrack | null = null;
  private localVideoTrack: MediaStreamTrack | null = null;
  private localStream = new MediaStream();
  private audioCtx: AudioContext | null = null;
  private selfAnalyser: AnalyserNode | null = null;
  private selfAnalyserData: Uint8Array<ArrayBuffer> | null = null;

  micEnabled = false;
  camEnabled = false;
  pttActive = false;
  selfSpeaking = false;
  videosHidden = false;
  lastError = '';

  private pollTimer: number | null = null;

  constructor(
    private readonly myId: number,
    private readonly client: MultiplayerClient,
    private readonly settings: Settings,
    private readonly onChange: () => void,
  ) {
    if (typeof window !== 'undefined') {
      this.pollTimer = window.setInterval(() => this.pollSpeaking(), 120);
    }
  }

  isSecureContextAvailable(): boolean {
    if (typeof window === 'undefined') return false;
    if (!window.isSecureContext) return false;
    return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
  }

  private formatMediaError(err: unknown, kind: 'micro' | 'caméra'): string {
    const name = err instanceof Error ? err.name : '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
      return `Permission ${kind} refusée. Autorisez l’accès dans les réglages du navigateur ou de l’application.`;
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return `Aucun(e) ${kind} détecté(e) sur cet appareil.`;
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      return `Le ${kind} est déjà utilisé par une autre application.`;
    }
    return `Impossible d’activer le ${kind} : ${err instanceof Error ? err.message : String(err)}`;
  }

  private isAudioTransmitting(): boolean {
    if (!this.micEnabled || !this.localAudioTrack) return false;
    if (this.settings.pushToTalk) return this.pttActive;
    return true;
  }

  private applyMicTrackState(): void {
    const active = this.isAudioTransmitting();
    if (this.localAudioTrack) {
      this.localAudioTrack.enabled = active;
    }
    if (!active && this.selfSpeaking) {
      this.selfSpeaking = false;
    }
    this.broadcastLocalState();
    this.onChange();
  }

  private broadcastLocalState(): void {
    this.client.sendRtcState(this.isAudioTransmitting(), this.camEnabled, this.selfSpeaking && this.isAudioTransmitting());
  }

  async toggleMic(): Promise<boolean> {
    if (!this.isSecureContextAvailable()) {
      this.lastError = INSECURE_MEDIA_MESSAGE;
      this.onChange();
      return false;
    }
    this.lastError = '';

    if (this.micEnabled) {
      this.micEnabled = false;
      this.applyMicTrackState();
      return false;
    }

    if (!this.localAudioTrack || this.localAudioTrack.readyState === 'ended') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        const track = stream.getAudioTracks()[0];
        if (!track) {
          this.lastError = 'Aucune piste audio disponible.';
          this.onChange();
          return false;
        }
        this.localAudioTrack = track;
        this.localStream.addTrack(track);
        this.setupSelfAnalyser(stream);
        for (const peer of this.peers.values()) {
          if (peer.audioSender) {
            await peer.audioSender.replaceTrack(track);
          } else {
            peer.audioSender = peer.pc.addTrack(track, this.localStream);
          }
        }
      } catch (err) {
        this.lastError = this.formatMediaError(err, 'micro');
        this.onChange();
        return false;
      }
    }

    this.micEnabled = true;
    this.applyMicTrackState();
    return true;
  }

  async setPushToTalkActive(active: boolean): Promise<void> {
    if (this.pttActive === active) return;
    this.pttActive = active;
    if (active && this.settings.pushToTalk && !this.micEnabled) {
      await this.toggleMic();
      return;
    }
    this.applyMicTrackState();
  }

  async toggleCam(): Promise<boolean> {
    if (!this.isSecureContextAvailable()) {
      this.lastError = INSECURE_MEDIA_MESSAGE;
      this.onChange();
      return false;
    }
    this.lastError = '';

    if (this.camEnabled) {
      this.camEnabled = false;
      if (this.localVideoTrack) {
        this.localVideoTrack.enabled = false;
        this.localVideoTrack.stop();
        this.localStream.removeTrack(this.localVideoTrack);
        this.localVideoTrack = null;
      }
      for (const peer of this.peers.values()) {
        if (peer.videoSender) {
          peer.videoSender.replaceTrack(null).catch(() => undefined);
        }
      }
      this.broadcastLocalState();
      this.onChange();
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 15 } },
        audio: false,
      });
      const track = stream.getVideoTracks()[0];
      if (!track) {
        this.lastError = 'Aucune piste vidéo disponible.';
        this.onChange();
        return false;
      }
      this.localVideoTrack = track;
      this.localStream.addTrack(track);
      for (const peer of this.peers.values()) {
        if (peer.videoSender) {
          await peer.videoSender.replaceTrack(track);
        } else {
          peer.videoSender = peer.pc.addTrack(track, this.localStream);
        }
      }
      this.camEnabled = true;
      this.broadcastLocalState();
      this.onChange();
      return true;
    } catch (err) {
      this.lastError = this.formatMediaError(err, 'caméra');
      this.onChange();
      return false;
    }
  }

  toggleVideosHidden(): boolean {
    this.videosHidden = !this.videosHidden;
    this.onChange();
    return this.videosHidden;
  }

  setPeerMuted(id: number, muted: boolean): void {
    const peer = this.peers.get(id);
    if (!peer) return;
    peer.mutedByMe = muted;
    peer.audioEl.muted = muted;
    peer.audioEl.volume = muted ? 0 : this.settings.voiceVolume;
    this.onChange();
  }

  applySettings(): void {
    for (const peer of this.peers.values()) {
      peer.audioEl.muted = peer.mutedByMe;
      peer.audioEl.volume = peer.mutedByMe ? 0 : this.settings.voiceVolume;
    }
    this.applyMicTrackState();
  }

  getPeerViews(): VoicePeerView[] {
    const out: VoicePeerView[] = [];
    for (const peer of this.peers.values()) {
      out.push({
        id: peer.id,
        name: peer.name,
        micOn: peer.remoteMic,
        camOn: peer.remoteCam && peer.hasRemoteVideo,
        speaking: !peer.mutedByMe && (peer.localSpeaking || peer.remoteSpeaking),
        mutedByMe: peer.mutedByMe,
        volume: peer.mutedByMe ? 0 : this.settings.voiceVolume,
        videoStream: peer.hasRemoteVideo && peer.remoteCam ? peer.remoteStream : null,
        hasRemoteAudio: peer.hasRemoteAudio,
        connected: peer.connected,
      });
    }
    return out;
  }

  syncPeers(list: RemotePlayerState[]): void {
    const activeIds = new Set<number>();
    let changed = false;

    for (const p of list) {
      if (p.id === this.myId) continue;
      activeIds.add(p.id);
      const existing = this.peers.get(p.id);
      if (existing) {
        if (existing.name !== p.name) {
          existing.name = p.name;
          changed = true;
        }
        continue;
      }
      this.createPeer(p.id, p.name);
      changed = true;
    }

    for (const id of [...this.peers.keys()]) {
      if (!activeIds.has(id)) {
        this.removePeer(id);
        changed = true;
      }
    }

    if (changed) this.onChange();
  }

  private createPeer(id: number, name: string): void {
    // Aucun serveur STUN/TURN externe : réseau local Wi-Fi et Tailscale directs uniquement
    const pc = new RTCPeerConnection({ iceServers: [] });
    const remoteStream = new MediaStream();
    const audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    audioEl.setAttribute('playsinline', '');
    audioEl.volume = this.settings.voiceVolume;
    audioEl.srcObject = remoteStream;
    audioEl.style.display = 'none';
    if (typeof document !== 'undefined' && document.body) {
      document.body.appendChild(audioEl);
    }

    const peer: PeerState = {
      id,
      name,
      pc,
      remoteStream,
      audioEl,
      audioSender: null,
      videoSender: null,
      makingOffer: false,
      ignoreOffer: false,
      isSettingRemoteAnswerPending: false,
      mutedByMe: false,
      remoteMic: false,
      remoteCam: false,
      remoteSpeaking: false,
      localSpeaking: false,
      hasRemoteAudio: false,
      hasRemoteVideo: false,
      analyser: null,
      analyserData: null,
      connected: false,
    };
    this.peers.set(id, peer);

    if (this.localAudioTrack) {
      peer.audioSender = pc.addTrack(this.localAudioTrack, this.localStream);
    }
    if (this.localVideoTrack) {
      peer.videoSender = pc.addTrack(this.localVideoTrack, this.localStream);
    }

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this.client.sendRtcSignal(id, 'ice', ev.candidate.toJSON());
      }
    };

    pc.onconnectionstatechange = () => {
      peer.connected = pc.connectionState === 'connected';
      this.onChange();
    };

    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        if (pc.localDescription) {
          this.client.sendRtcSignal(id, 'offer', pc.localDescription.toJSON());
        }
      } catch {
        // ignorer les erreurs transitoires de négociation
      } finally {
        peer.makingOffer = false;
      }
    };

    pc.ontrack = (ev) => {
      const track = ev.track;
      if (!remoteStream.getTracks().some((t) => t.id === track.id)) {
        remoteStream.addTrack(track);
      }
      if (track.kind === 'audio') {
        peer.hasRemoteAudio = true;
        audioEl.srcObject = remoteStream;
        audioEl.play().catch(() => undefined);
        this.setupPeerAnalyser(peer, remoteStream);
      } else if (track.kind === 'video') {
        peer.hasRemoteVideo = true;
      }
      track.addEventListener('mute', () => this.onChange());
      track.addEventListener('unmute', () => this.onChange());
      track.addEventListener('ended', () => {
        if (track.kind === 'video') peer.hasRemoteVideo = false;
        this.onChange();
      });
      this.onChange();
    };
  }

  removePeer(id: number): void {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id);
    try {
      peer.pc.close();
    } catch {
      // ignore
    }
    peer.audioEl.srcObject = null;
    peer.audioEl.remove();
  }

  async handleSignal(from: number, kind: 'offer' | 'answer' | 'ice', payload: unknown): Promise<void> {
    const peer = this.peers.get(from);
    if (!peer || !payload || typeof payload !== 'object') return;
    const polite = this.myId > from;
    const pc = peer.pc;

    try {
      if (kind === 'offer' || kind === 'answer') {
        const desc = payload as RTCSessionDescriptionInit;
        const readyForOffer =
          !peer.makingOffer && (pc.signalingState === 'stable' || peer.isSettingRemoteAnswerPending);
        const offerCollision = desc.type === 'offer' && !readyForOffer;
        peer.ignoreOffer = !polite && offerCollision;
        if (peer.ignoreOffer) return;

        peer.isSettingRemoteAnswerPending = desc.type === 'answer';
        await pc.setRemoteDescription(desc);
        peer.isSettingRemoteAnswerPending = false;
        if (desc.type === 'offer') {
          await pc.setLocalDescription();
          if (pc.localDescription) {
            this.client.sendRtcSignal(from, 'answer', pc.localDescription.toJSON());
          }
        }
      } else if (kind === 'ice') {
        try {
          await pc.addIceCandidate(payload as RTCIceCandidateInit);
        } catch (err) {
          if (!peer.ignoreOffer) throw err;
        }
      }
    } catch {
      // ignorer les signaux invalides ou obsolètes
    }
  }

  handleRemoteState(id: number, mic: boolean, cam: boolean, speaking: boolean): void {
    const peer = this.peers.get(id);
    if (!peer) return;
    peer.remoteMic = mic;
    peer.remoteCam = cam;
    peer.remoteSpeaking = speaking;
    this.onChange();
  }

  private ensureAudioContext(): AudioContext | null {
    if (this.audioCtx) return this.audioCtx;
    const Ctor = typeof window !== 'undefined' ? window.AudioContext : undefined;
    if (!Ctor) return null;
    try {
      this.audioCtx = new Ctor();
      return this.audioCtx;
    } catch {
      return null;
    }
  }

  private setupSelfAnalyser(stream: MediaStream): void {
    const ctx = this.ensureAudioContext();
    if (!ctx) return;
    try {
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      this.selfAnalyser = analyser;
      this.selfAnalyserData = new Uint8Array(analyser.frequencyBinCount);
    } catch {
      // ignore
    }
  }

  private setupPeerAnalyser(peer: PeerState, stream: MediaStream): void {
    const ctx = this.ensureAudioContext();
    if (!ctx) return;
    try {
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      peer.analyser = analyser;
      peer.analyserData = new Uint8Array(analyser.frequencyBinCount);
    } catch {
      // ignore
    }
  }

  private measureLevel(analyser: AnalyserNode | null, data: Uint8Array<ArrayBuffer> | null): boolean {
    if (!analyser || !data) return false;
    analyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    return sum / data.length > 8;
  }

  private pollSpeaking(): void {
    let changed = false;
    const transmitting = this.isAudioTransmitting();
    const nextSelf = transmitting && this.measureLevel(this.selfAnalyser, this.selfAnalyserData);
    if (nextSelf !== this.selfSpeaking) {
      this.selfSpeaking = nextSelf;
      this.broadcastLocalState();
      changed = true;
    }
    for (const peer of this.peers.values()) {
      const next = !peer.mutedByMe && peer.hasRemoteAudio && this.measureLevel(peer.analyser, peer.analyserData);
      if (next !== peer.localSpeaking) {
        peer.localSpeaking = next;
        changed = true;
      }
    }
    if (changed) this.onChange();
  }

  dispose(): void {
    if (this.pollTimer !== null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    for (const id of [...this.peers.keys()]) {
      this.removePeer(id);
    }
    if (this.localAudioTrack) {
      this.localAudioTrack.stop();
      this.localAudioTrack = null;
    }
    if (this.localVideoTrack) {
      this.localVideoTrack.stop();
      this.localVideoTrack = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => undefined);
      this.audioCtx = null;
    }
  }
}
