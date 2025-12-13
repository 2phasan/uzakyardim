// client/src/RemoteHelp.tsx
import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

type SignalData =
  | { type: "offer"; sdp: string }
  | { type: "answer"; sdp: string }
  | { type: "candidate"; candidate: RTCIceCandidateInit };

type ChatMessage = {
  id: string;
  from: "Destek alan" | "Destek veren" | "Sistem";
  text: string;
  ts: number;
};

const SIGNAL_SERVER_URL =
  import.meta.env.VITE_SIGNAL_SERVER_URL ||
  "https://uzakyardim.onrender.com";

const isMobileBrowser = () => {
  const ua = navigator.userAgent.toLowerCase();
  return /iphone|ipad|android/i.test(ua);
};

function generateRoomId() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function RemoteHelp() {
  // Video + WebRTC referansları
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  // State
  const [roomId, setRoomId] = useState(generateRoomId);
  const [isHost, setIsHost] = useState<boolean | null>(null); // true = destek alan
  const [sharing, setSharing] = useState(false);
  const [status, setStatus] = useState<string>(
    "Hazır. Rol seçip başlayabilirsiniz."
  );
  const [error, setError] = useState<string | null>(null);
  const [localFull, setLocalFull] = useState(false);
  const [remoteFull, setRemoteFull] = useState(false);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");

  // Kırmızı imleç için state
  const [remotePointer, setRemotePointer] = useState<{
    x: number;
    y: number;
    visible: boolean;
  }>({
    x: 50,
    y: 50,
    visible: false
  });
  const remotePointerTimeoutRef = useRef<number | null>(null);

  const mobile = isMobileBrowser();

  // fresh değerler için ref
  const roomIdRef = useRef(roomId);
  const isHostRef = useRef(false);

  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);

  useEffect(() => {
    isHostRef.current = !!isHost;
  }, [isHost]);

  // Socket.io bağlantısı + eventler
  useEffect(() => {
    const socket = io(SIGNAL_SERVER_URL, {
      transports: ["websocket"]
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setStatus("Sinyal sunucusuna bağlanıldı.");
      setError(null);
    });

    socket.on("disconnect", () => {
      setStatus("Sunucu bağlantısı koptu.");
    });

    socket.on("user-joined", async () => {
      // Odaya yeni kullanıcı katıldı → host isek offer gönder
      if (isHostRef.current && pcRef.current && localStreamRef.current) {
        await sendOffer();
      }
    });

    // Geçersiz / aktif olmayan oda ID
    socket.on("room-not-found", () => {
      setStatus("Oda bulunamadı.");
      setError(
        "Bu ID ile aktif bir oturum bulunamadı. ID'yi kontrol edin veya müşteriden yeni ID göndermesini isteyin."
      );
    });

    // WebRTC sinyalleşme
    socket.on(
      "signal",
      async ({ data }: { from: string; data: SignalData }) => {
        const pc = pcRef.current;
        if (!pc) return;

        try {
          if (data.type === "offer" && !isHostRef.current) {
            await pc.setRemoteDescription(
              new RTCSessionDescription({ type: "offer", sdp: data.sdp })
            );
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            const answerData: SignalData = {
              type: "answer",
              sdp: answer.sdp || ""
            };

            socket.emit("signal", {
              roomId: roomIdRef.current,
              data: answerData
            });

            setStatus("Bağlantı kuruluyor, ekran bekleniyor…");
          } else if (data.type === "answer" && isHostRef.current) {
            await pc.setRemoteDescription(
              new RTCSessionDescription({ type: "answer", sdp: data.sdp })
            );
            setStatus("Bağlantı kuruldu.");
          } else if (data.type === "candidate" && data.candidate) {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
          }
        } catch (e) {
          console.error("Signal işlenirken hata:", e);
        }
      }
    );

    // Chat mesajları
    socket.on("chat-message", (message: ChatMessage) => {
      setChatMessages((prev) => [...prev, message]);
    });

    // Uzak imleç: socket'ten geldiğinde göster
    socket.on("remote-pointer", ({ x, y }: { x: number; y: number }) => {
      triggerPointer(x, y);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // RTCPeerConnection
  const createPeerConnection = () => {
    if (pcRef.current) return pcRef.current;

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current && roomIdRef.current) {
        const data: SignalData = {
          type: "candidate",
          candidate: event.candidate.toJSON()
        };
        socketRef.current.emit("signal", {
          roomId: roomIdRef.current,
          data
        });
      }
    };

    pc.ontrack = (event) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    pcRef.current = pc;
    return pc;
  };

  const sendOffer = async () => {
    if (!socketRef.current || !pcRef.current || !roomIdRef.current) return;
    const pc = pcRef.current;

    setStatus("Bağlantı başlatılıyor…");

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const data: SignalData = { type: "offer", sdp: offer.sdp || "" };
    socketRef.current.emit("signal", { roomId: roomIdRef.current, data });

    setStatus("Karşı tarafın cevap vermesi bekleniyor…");
  };

  // Host (destek alan) başlat
  const startHost = async () => {
    setError(null);

    if (mobile) {
      setError(
        "Ekran paylaşımı mobil tarayıcılarda desteklenmiyor. Destek alan cihaz masaüstü olmalı."
      );
      return;
    }

    if (!roomIdRef.current.trim()) {
      setError("Önce geçerli bir Oda ID olmalı.");
      return;
    }
    if (!socketRef.current) {
      setError("Sinyal sunucusuna bağlanılamadı.");
      return;
    }

    setIsHost(true);
    setStatus("Oda oluşturuluyor ve ekran paylaşımı hazırlanıyor…");

    socketRef.current.emit("join-room", {
      roomId: roomIdRef.current,
      role: "host"
    });

    const pc = createPeerConnection();

    try {
      if (
        !navigator.mediaDevices ||
        !(navigator.mediaDevices as any).getDisplayMedia
      ) {
        setError(
          "Bu tarayıcı ekran paylaşımını desteklemiyor (getDisplayMedia yok)."
        );
        setStatus("Hata oluştu.");
        return;
      }

      const stream = await (navigator.mediaDevices as any).getDisplayMedia({
        video: true,
        audio: false
      });

      localStreamRef.current = stream;

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream as MediaStream;
        await localVideoRef.current.play();
      }

      stream.getTracks().forEach((track: MediaStreamTrack) => {
        pc.addTrack(track, stream);
      });

      setSharing(true);
      setStatus(
        "Ekran paylaşımı başladı. Destek veren bağlantıyı bekleyebilirsiniz."
      );

      const [videoTrack] = stream.getVideoTracks();
      videoTrack.addEventListener("ended", () => {
        setSharing(false);
        setStatus("Ekran paylaşımı durdu.");
        localStreamRef.current = null;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = null;
        }
      });

      await sendOffer();
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Ekran paylaşımı başlatılamadı.");
      setStatus("Hata oluştu.");
    }
  };

  // Viewer (destek veren) başlat
  const startViewer = () => {
    setError(null);

    if (!roomIdRef.current.trim()) {
      setError("Önce Oda ID gir.");
      return;
    }
    if (!socketRef.current) {
      setError("Sinyal sunucusuna bağlanılamadı.");
      return;
    }

    setIsHost(false);
    setStatus("Odaya katılmaya çalışılıyor… Bu cihaz: DESTEK VEREN");

    createPeerConnection();

    socketRef.current.emit("join-room", {
      roomId: roomIdRef.current,
      role: "viewer"
    });
  };

  // Yeni ID üret
  const handleNewId = () => {
    const id = generateRoomId();
    setRoomId(id);
    setError(null);
    setStatus("Yeni ID oluşturuldu. Bu ID'yi müşterinle paylaş.");
  };

  const handleCopyId = async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      setStatus("Oda ID panoya kopyalandı.");
    } catch {
      setError("ID kopyalanamadı, elle seçip kopyalayın.");
    }
  };

  // Chat gönder
  const sendChatMessage = () => {
    if (!socketRef.current || !roomIdRef.current || !chatInput.trim()) return;

    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      from: isHostRef.current ? "Destek alan" : "Destek veren",
      text: chatInput.trim(),
      ts: Date.now()
    };

    socketRef.current.emit("chat-message", {
      roomId: roomIdRef.current,
      message: msg
    });

    setChatInput("");
  };

  const handleChatKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendChatMessage();
    }
  };

  // Uzak imleç: tek yerden yönetilen helper
  const triggerPointer = (x: number, y: number) => {
    setRemotePointer({ x, y, visible: true });

    if (remotePointerTimeoutRef.current !== null) {
      window.clearTimeout(remotePointerTimeoutRef.current);
    }

    remotePointerTimeoutRef.current = window.setTimeout(() => {
      setRemotePointer((prev) => ({ ...prev, visible: false }));
    }, 1200); // 1.2 sn sonra kaybolsun
  };

  const handleRemoteScreenClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!socketRef.current || !roomIdRef.current) return;
    if (isHostRef.current) return; // sadece DESTEK VEREN tıklayabilir

    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    socketRef.current.emit("remote-pointer", {
      roomId: roomIdRef.current,
      x,
      y
    });

    triggerPointer(x, y);
  };

  return (
    <div className="app-root">
      <header className="app-header">
        <div className="brand">
          <div className="brand-logo">U</div>
          <div className="brand-text">
            <div className="brand-name">UZAKYARDIM</div>
            <div className="brand-sub">Kurumsal Ekran Destek Platformu</div>
          </div>
        </div>
        <div className="header-badge">BETA</div>
      </header>

      <main className="app-main">
        <section className="info-column">
          <div className="card">
            <h2 className="card-title">Nasıl Çalışır?</h2>
            <ol className="steps">
              <li>
                <strong>Destek alan</strong>, masaüstü cihazdan bu sayfayı açar
                ve <strong>Destek alan</strong> butonuna basıp ekranını
                paylaşır.
              </li>
              <li>
                <strong>Destek veren</strong>, aynı Oda ID ile{" "}
                <strong>Bu cihaz sadece izlesin</strong> butonuna basar.
              </li>
              <li>
                Ekran otomatik olarak bağlanır; chat ve kırmızı imleç ile
                yönlendirme yapılabilir.
              </li>
            </ol>
          </div>

          <div className="card">
            <h2 className="card-title">Rol Bilgisi</h2>
            <p className="role-line">
              <span className="role-label">Destek alan:</span> Ekranını paylaşan
              kullanıcı (müşteri).
            </p>
            <p className="role-line">
              <span className="role-label">Destek veren:</span> Ekranı izleyip
              kullanıcıya adım adım yol gösteren uzman.
            </p>
            <p className="role-note">
              Mobil tarayıcılar ekran paylaşımını desteklemez; bu nedenle{" "}
              <strong>destek alan cihazın masaüstü</strong> olması gerekir.
            </p>
          </div>

          <div className="card small">
            <h2 className="card-title">Oda Bilgisi</h2>
            <div className="room-meta">
              <div className="room-meta-item">
                <span className="room-meta-label">Oda ID</span>
                <span className="room-meta-value">#{roomId}</span>
              </div>
              <div className="room-meta-item">
                <span className="room-meta-label">Cihaz Rolü</span>
                <span className="room-meta-value">
                  {isHost === null
                    ? "ROL SEÇİLMEDİ"
                    : isHost
                    ? "Bu cihaz: DESTEK ALAN"
                    : "Bu cihaz: DESTEK VEREN"}
                </span>
              </div>
            </div>
            <p className="room-tip">
              Müşterinle aynı ID'yi kullanmanız gerekir. İstersen{" "}
              <strong>Yeni ID</strong> ile her oturumda farklı kod üret.
            </p>
          </div>
        </section>

        <section className="main-column">
          <div className="card">
            <div className="room-controls">
              <div className="room-id-group">
                <label className="field-label">Oda ID</label>
                <input
                  className="room-input"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                />
              </div>
              <div className="room-actions">
                <button className="btn ghost" onClick={handleNewId}>
                  Yeni ID
                </button>
                <button className="btn ghost" onClick={handleCopyId}>
                  ID&apos;yi kopyala
                </button>
              </div>
            </div>

            <div className="role-buttons">
              <button
                className={`btn primary ${isHost === true ? "active" : ""}`}
                onClick={startHost}
                disabled={sharing || mobile}
              >
                Destek alan (masaüstü)
              </button>
              <button
                className={`btn secondary ${isHost === false ? "active" : ""}`}
                onClick={startViewer}
              >
                Bu cihaz sadece izlesin (destek veren)
              </button>
            </div>

            <div className="status-line">
              <span className="status-label">Durum:</span>
              <span className="status-text">{status}</span>
            </div>

            {error && (
              <div className="error-banner">
                <span className="error-label">Hata:</span> {error}
              </div>
            )}
          </div>

          <div className="card">
            <div className="screen-header">
              <div>
                <h3>Bu cihazın ekranı</h3>
                <p className="screen-sub">
                  Host olduğunuzda ekranınız burada görünür.
                </p>
              </div>
              <button
                className="link-button"
                onClick={() => setLocalFull((v) => !v)}
              >
                {localFull ? "Normal" : "Büyüt"}
              </button>
            </div>
            <div className={`screen-wrapper ${localFull ? "full" : ""}`}>
              <video
                ref={localVideoRef}
                className="screen-video"
                autoPlay
                muted
                playsInline
              />
            </div>
          </div>

          <div className="card">
            <div className="screen-header">
              <div>
                <h3>Karşı tarafın ekranı</h3>
                <p className="screen-sub">
                  Destek veren olarak bu alan üzerine tıklayıp kırmızı imleç ile
                  yönlendirme yapabilirsiniz.
                </p>
              </div>
              <button
                className="link-button"
                onClick={() => setRemoteFull((v) => !v)}
              >
                {remoteFull ? "Normal" : "Büyüt"}
              </button>
            </div>
            <div
              className={`screen-wrapper ${remoteFull ? "full" : ""}`}
              onClick={handleRemoteScreenClick}
            >
              <video
                ref={remoteVideoRef}
                className="screen-video"
                autoPlay
                muted
                playsInline
              />
              {remotePointer.visible && (
                <div
                  className="remote-pointer"
                  style={{
                    left: `${remotePointer.x}%`,
                    top: `${remotePointer.y}%`
                  }}
                />
              )}
            </div>
          </div>

          <div className="card chat-card">
            <h3>Canlı Chat</h3>
            <div className="chat-box">
              <div className="chat-messages">
                {chatMessages.length === 0 && (
                  <div className="chat-placeholder">
                    İlk mesajı siz yazın. Örneğin:{" "}
                    <em>“Merhaba, ekranınızı görebiliyorum.”</em>
                  </div>
                )}
                {chatMessages.map((m) => (
                  <div
                    key={m.id}
                    className={`chat-message ${
                      m.from === "Destek veren"
                        ? "from-support"
                        : "from-client"
                    }`}
                  >
                    <div className="chat-meta">
                      <span className="chat-from">{m.from}</span>
                      <span className="chat-time">
                        {new Date(m.ts).toLocaleTimeString("tr-TR", {
                          hour: "2-digit",
                          minute: "2-digit"
                        })}
                      </span>
                    </div>
                    <div className="chat-text">{m.text}</div>
                  </div>
                ))}
              </div>
              <div className="chat-input-row">
                <input
                  className="chat-input"
                  placeholder="Mesaj yazın ve Enter'a basın…"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={handleChatKeyDown}
                />
                <button className="btn primary small" onClick={sendChatMessage}>
                  Gönder
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="app-footer">
        <span>
          © {new Date().getFullYear()} Uzakyardım. Sadece test ve demo
          amaçlıdır.
        </span>
      </footer>
    </div>
  );
}

export default RemoteHelp;