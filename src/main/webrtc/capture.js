/* eslint-disable no-undef */
// Capture renderer WebRTC.
// Vit dans un BrowserWindow caché créé par le main process à
// l'ouverture d'une session avec useWebrtc=true. Gère :
//   - getUserMedia avec chromeMediaSource: 'desktop' pour capturer
//     soit la BrowserWindow container (mode 'window') soit un écran
//     entier (mode 'screen')
//   - une RTCPeerConnection par browser viewer
//   - le signaling SDP/ICE via le bridge IPC (vers la WS relay du main)
//
// Comme la WS relay broadcast à tous les browsers via fan-out, ce
// renderer reçoit aussi tous les messages signaling de N viewers. Chaque
// message inclut un peerId pour distinguer la cible.

const status = document.getElementById("status");
const selfVideo = document.getElementById("self");

function setStatus(line) {
  status.textContent = line;
  window.webrtcBridge.log("info", line);
}

function logDebug(msg) {
  window.webrtcBridge.log("debug", msg);
}

function logError(msg) {
  window.webrtcBridge.log("error", msg);
}

// Map<browserPeerId, RTCPeerConnection> — un par viewer.
const peers = new Map();
let localStream = null;
// Race condition guard : getUserMedia met 300-800ms, mais le BO peut envoyer
// `want-webrtc` avant. Sans ce gate, on créait une RTCPeerConnection sans
// track → offer vide → ontrack côté browser ne se déclenche jamais.
let captureReadyResolve;
const captureReady = new Promise((r) => {
  captureReadyResolve = r;
});
// Queue les want-webrtc reçus avant que localStream soit prêt.
const pendingPeerIds = [];
// RTC config par défaut (STUN public Google) — remplacé au boot par celui
// poussé via webrtcBridge.getInitialConfig() qui contient les credentials
// Cloudflare TURN éphémères. Sans TURN, NAT symétrique = fail garantie.
let RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

async function startCapture() {
  const cfg = await window.webrtcBridge.getInitialConfig();
  // Si le central a poussé des iceServers (Cloudflare TURN), on remplace
  // la config par défaut (STUN-only Google). Tous les peers créés à partir
  // de maintenant utilisent ces creds éphémères pour la durée de la session.
  if (Array.isArray(cfg.iceServers) && cfg.iceServers.length > 0) {
    RTC_CONFIG = { iceServers: cfg.iceServers };
    setStatus(
      `webrtc-capture: mode=${cfg.mode} screen=${cfg.screenIndex} ice=cloudflare`
    );
  } else {
    setStatus(
      `webrtc-capture: mode=${cfg.mode} screen=${cfg.screenIndex} ice=stun-only`
    );
  }
  const sourceId = await window.webrtcBridge.getCaptureSourceId();
  if (!sourceId) {
    logError("no capture source id resolved, aborting");
    return;
  }
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: sourceId,
          minWidth: 640,
          maxWidth: 1920,
          minHeight: 360,
          maxHeight: 1080,
          minFrameRate: 5,
          maxFrameRate: 25,
        },
      },
    });
    selfVideo.srcObject = localStream;
    setStatus(
      `webrtc-capture: stream OK (${localStream.getVideoTracks().length} track)`
    );
    // Signale que les tracks sont disponibles — réveille les want-webrtc
    // qui ont éventuellement été reçus avant.
    captureReadyResolve(localStream);
    // Flush des want-webrtc en attente (browsers connectés avant que
    // getUserMedia ait résolu).
    while (pendingPeerIds.length > 0) {
      const id = pendingPeerIds.shift();
      sendOfferTo(id).catch((e) =>
        logError(`flush sendOfferTo ${id}: ${e.message}`)
      );
    }
  } catch (e) {
    logError(`getUserMedia failed: ${e.message}`);
  }
}

async function createPeerFor(browserPeerId) {
  if (peers.has(browserPeerId)) return peers.get(browserPeerId);
  const pc = new RTCPeerConnection(RTC_CONFIG);
  peers.set(browserPeerId, pc);
  // Ajout des tracks (1 ou 2 — vidéo seule pour l'instant)
  if (localStream) {
    for (const track of localStream.getTracks()) {
      pc.addTrack(track, localStream);
    }
  }
  pc.onicecandidate = (ev) => {
    if (!ev.candidate) return;
    window.webrtcBridge.sendSignal({
      type: "webrtc-ice",
      to: browserPeerId,
      candidate: ev.candidate.toJSON(),
    });
  };
  pc.onconnectionstatechange = () => {
    logDebug(`pc ${browserPeerId} state=${pc.connectionState}`);
    if (
      pc.connectionState === "failed" ||
      pc.connectionState === "closed" ||
      pc.connectionState === "disconnected"
    ) {
      peers.delete(browserPeerId);
      try {
        pc.close();
      } catch {}
    }
  };
  return pc;
}

async function sendOfferTo(browserPeerId) {
  // Defensive : si on est appelé sans avoir flushé la queue (ne devrait
  // pas arriver), on attend explicitement le stream avant de procéder.
  await captureReady;
  const pc = await createPeerFor(browserPeerId);
  if (pc.getSenders().length === 0) {
    logError(
      `sendOfferTo ${browserPeerId}: pc has no senders, offer will be empty`
    );
  }
  const offer = await pc.createOffer({
    offerToReceiveAudio: false,
    offerToReceiveVideo: false,
  });
  await pc.setLocalDescription(offer);
  window.webrtcBridge.sendSignal({
    type: "webrtc-offer",
    to: browserPeerId,
    sdp: offer.sdp,
  });
}

async function handleAnswer(browserPeerId, sdp) {
  const pc = peers.get(browserPeerId);
  if (!pc) {
    logError(`answer for unknown peer ${browserPeerId}`);
    return;
  }
  try {
    await pc.setRemoteDescription({ type: "answer", sdp });
  } catch (e) {
    logError(`setRemoteDescription failed: ${e.message}`);
  }
}

async function handleRemoteIce(browserPeerId, candidate) {
  const pc = peers.get(browserPeerId);
  if (!pc) return;
  try {
    await pc.addIceCandidate(candidate);
  } catch (e) {
    logError(`addIceCandidate failed: ${e.message}`);
  }
}

function tearDownPeer(browserPeerId) {
  const pc = peers.get(browserPeerId);
  if (!pc) return;
  try {
    pc.close();
  } catch {}
  peers.delete(browserPeerId);
}

window.webrtcBridge.onSignal(async (msg) => {
  if (!msg || !msg.type) return;
  switch (msg.type) {
    case "want-webrtc":
      // Browser demande un flux ; si localStream n'est pas encore prêt
      // (getUserMedia en cours), on queue et on traitera quand le stream
      // sera disponible. Sans ça, l'offer partait sans track et le browser
      // n'avait jamais d'ontrack → rendu bloqué sur l'<img> JPEG fallback.
      if (!localStream) {
        if (!pendingPeerIds.includes(msg.from)) {
          pendingPeerIds.push(msg.from);
        }
        logDebug(`want-webrtc queued (capture not ready yet): ${msg.from}`);
        break;
      }
      await sendOfferTo(msg.from);
      break;
    case "webrtc-answer":
      await handleAnswer(msg.from, msg.sdp);
      break;
    case "webrtc-ice":
      await handleRemoteIce(msg.from, msg.candidate);
      break;
    case "webrtc-bye":
      tearDownPeer(msg.from);
      break;
    default:
      // pas pour nous
      break;
  }
});

window.webrtcBridge.onTeardown(() => {
  for (const peerId of Array.from(peers.keys())) tearDownPeer(peerId);
  if (localStream) {
    for (const t of localStream.getTracks()) t.stop();
    localStream = null;
  }
});

startCapture();
